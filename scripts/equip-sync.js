import { MODULE_ID } from "./settings.js";

/**
 * Mão de volta Foundry→Companion (edge function foundry-inbound).
 *
 * Dois eventos saem daqui:
 *  - EQUIPAR/DESEQUIPAR item com crachá do Companion → POST { actor_id,
 *    item_id, equipped } (rota original da foundry-inbound).
 *  - ITEM NOVO no actor (createItem, ou updateItem de item sem crachá) →
 *    POST { op: "item.upsert", ... } com o item completo; a resposta traz o
 *    items.id do Companion, gravado no item como crachá — o item nativo do
 *    Foundry ganha identidade do Companion e os equips seguintes sincronizam.
 *  - SYNC INICIAL: syncActorInventory(actor) envia todo o inventário de uma
 *    vez (itens que existiam antes da ponte), no ritmo do rate-limit da edge.
 *
 * ══ TRAVA DO LOOP DE ECO — três camadas independentes ══
 * O perigo: Companion manda item → Foundry cria → createItem dispara → módulo
 * manda de volta → Companion cria de novo → duplicação infinita. Não acontece
 * porque:
 *  1. TOKEN DE ORIGEM: toda operação de documento do bridge-client passa
 *     { companionBridge: true } nas options; TODO hook daqui descarta
 *     operações com essa marca na primeira linha.
 *  2. IDENTIDADE: item que veio do Companion carrega flags[MODULE_ID].synced
 *     e o crachá item_id. createItem/upsert descartam itens synced ou já
 *     com crachá — só item genuinamente novo do Foundry viaja.
 *  3. ESTRUTURAL: o sync Companion→Foundry é DELETE+CREATE de itens synced
 *     (bridge-client.js #updateActor) — nunca dispara updateItem; e o único
 *     write que o Companion faz na volta é equipped no banco, que NÃO gera
 *     push automático pro Foundry (push-to-foundry é botão manual).
 * Mesmo num cenário futuro de push automático, o ciclo converge em 1 volta:
 * as camadas 1 e 2 barram o reenvio.
 */

/** Tipos dnd5e físicos que fazem sentido no inventário do Companion. */
const PHYSICAL_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "container", "loot"]);

/**
 * Habilidade/ataque NATIVO do dnd5e (Unarmed Strike, garras, mordidas…) — NÃO
 * é item de inventário: não é loot, não vende, e todo PC/monstro tem. Critério
 * REAL (não o nome): armas de subtipo "natural" (DND5E.weaponTypes.natural,
 * confirmado no config.mjs do dnd5e 5.3.3). Filtrar aqui pega qualquer idioma
 * e também garras/mordidas que porventura entrem, não só o Unarmed Strike.
 */
function isNativeWeapon(item) {
  return item?.type === "weapon" && item?.system?.type?.value === "natural";
}

/** Item elegível pra viajar pro Companion: físico e NÃO nativo. */
function isSyncableItem(item) {
  return PHYSICAL_TYPES.has(item?.type) && !isNativeWeapon(item);
}

/** Pausa entre POSTs do sync inicial — a edge limita upsert a 10/60s por actor. */
const INITIAL_SYNC_DELAY_MS = 7_000;

/* -------------------------------------------- */
/*  Crachá e filtros                            */
/* -------------------------------------------- */

/**
 * Crachá (items.id do Companion) do item. Escopo VÁLIDO primeiro — getFlag
 * exige escopo de módulo instalado. O legado flags.companion NUNCA via
 * getFlag ("companion" não é módulo instalado → lançaria erro); acesso
 * direto ao objeto é seguro nos dois cenários.
 */
function getCompanionItemId(item) {
  const own = item?.getFlag?.(MODULE_ID, "item_id");
  if (typeof own === "string" && own) return own;
  const legacy = item?.flags?.companion?.item_id;
  return typeof legacy === "string" && legacy ? legacy : null;
}

/** Item criado/gerenciado pelo bridge (veio do Companion). */
function isBridgeManaged(item) {
  return !!item?.getFlag?.(MODULE_ID, "synced");
}

/** Dois GMs logados → só o activeGM reporta (sem evento duplicado). */
function isReportingGm() {
  return !(game.users.activeGM && game.users.activeGM.id !== game.user.id);
}

/* -------------------------------------------- */
/*  HTTP → foundry-inbound                      */
/* -------------------------------------------- */

/**
 * POST autenticado pra foundry-inbound. Retorna o body em sucesso, null em
 * qualquer falha — com log claro por status pra debug sem a sessão:
 *  401 chave errada · 404 actor/item não vinculado · 413 payload grande ·
 *  429 rate limit · 503 porta trancada (secret não criado no Supabase).
 */
async function postInbound(payload) {
  const url = game.settings.get(MODULE_ID, "inboundUrl");
  const key = game.settings.get(MODULE_ID, "inboundKey");
  if (!url || !key) {
    console.warn(`${MODULE_ID} | inbound não configurado (URL/key nas settings) — evento descartado`);
    return null;
  }

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-foundry-inbound-key": key },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`${MODULE_ID} | inbound inacessível: ${err?.message ?? err}`);
    return null;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = {
      401: "chave errada — inboundKey ≠ FOUNDRY_INBOUND_KEY do Supabase",
      404: "actor não vinculado a PC (foundry_actor_id) ou item fora do inventário",
      413: "payload grande demais (limite 32 KiB da edge)",
      429: "rate limit da edge — reduza o ritmo",
      503: "porta trancada — secret FOUNDRY_INBOUND_KEY não criado no Supabase",
    }[res.status] ?? (body?.error ?? "erro desconhecido");
    console.error(`${MODULE_ID} | inbound ${res.status}: ${why}`, payload);
    return null;
  }
  return body;
}

/* -------------------------------------------- */
/*  Payload de item completo                    */
/* -------------------------------------------- */

/**
 * Stats de combate ESTRUTURADOS (Bloco 3) — espelham as colunas planas de
 * items no Companion (damage_dice/damage_type/ac_base/range). Campo ausente
 * vira null (a edge grava null sem sobrescrever com lixo).
 *  - dano: system.damage.base { number, denomination, bonus, types }
 *  - CA:   system.armor.value (só armadura)
 *  - alcance: system.range { value, long, reach, units } — ranged usa value/long,
 *    corpo-a-corpo usa reach. [HIPÓTESE só-teste: shape exato do range no dnd5e.]
 */
function combatStats(item) {
  const sys = item?.system ?? {};
  const d = sys.damage?.base;
  const damage_dice = d?.number && d?.denomination
    ? `${d.number}d${d.denomination}${d.bonus ? `+${d.bonus}` : ""}`
    : null;
  const damage_type = Array.isArray(d?.types) && d.types.length ? String(d.types[0]) : null;

  const acVal = sys.armor?.value;
  const ac_base = typeof acVal === "number" && acVal > 0 ? acVal : null;

  let range = null;
  const r = sys.range;
  if (r) {
    const units = r.units || "ft";
    if (r.value) range = `${r.value}${r.long ? `/${r.long}` : ""} ${units}`.trim();
    else if (r.reach) range = `reach ${r.reach} ${units}`.trim();
  }
  return { damage_dice, damage_type, ac_base, range };
}

/** Resumo curto de stats pro campo properties do Companion (texto, p/ ItensTab). */
function statsSummary(item) {
  const s = combatStats(item);
  const parts = [];
  if (s.damage_dice) parts.push(`${s.damage_dice}${s.damage_type ? ` ${s.damage_type}` : ""}`);
  if (s.ac_base != null) parts.push(`CA ${s.ac_base}`);
  if (s.range) parts.push(s.range);
  return parts.join(" · ");
}

function buildUpsertPayload(item, actor) {
  return {
    op: "item.upsert",
    actor_id: actor.id,
    foundry_item_id: item.id,
    name: item.name ?? "Item",
    type: item.type ?? "",
    // Subtipo dnd5e (system.type.value): pra armadura é "light"/"medium"/
    // "heavy"/"shield"; pra equipamento genérico é "trinket"/"clothing"/etc.
    // A edge usa isso pra separar armadura de verdade de tralha (Bloco 2).
    subtype: item.system?.type?.value ?? "",
    description: item.system?.description?.value ?? "",
    stats: statsSummary(item),
    ...combatStats(item), // Bloco 3: damage_dice/damage_type/ac_base/range estruturados
    img: item.img ?? "",
    qty: item.system?.quantity ?? 1,
    equipped: item.system?.equipped === true,
  };
}

/**
 * Envia um item nativo do Foundry pro Companion e grava o crachá devolvido.
 * O update do crachá leva o token companionBridge (camada 1 do anti-eco) e,
 * por só mexer em flags, nunca casa com o filtro de equipped do updateItem.
 */
async function upsertItem(item, actor) {
  const res = await postInbound(buildUpsertPayload(item, actor));
  if (res?.ok && typeof res.item_id === "string") {
    await item.update({ [`flags.${MODULE_ID}.item_id`]: res.item_id }, { companionBridge: true });
    console.log(`${MODULE_ID} | item enviado pro Companion: "${item.name}" → ${res.item_id} (${res.created ? "criado" : "atualizado"})`);
    return true;
  }
  return false;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/** Elegível pra mão de volta: item físico embutido num PC (actor "character"). */
function eligibleActor(item) {
  const actor = item?.parent;
  if (!(actor instanceof Actor) || actor.type !== "character") return null;
  if (!isSyncableItem(item)) return null; // exclui não-físicos E nativos (Unarmed Strike)
  return actor;
}

export function registerEquipWatcher() {
  // EQUIPAR/DESEQUIPAR — updateItem com changes.system.equipped.
  Hooks.on("updateItem", async (item, changes, options, _userId) => {
    if (options?.companionBridge) return; // camada 1: veio do Companion
    const equipped = changes?.system?.equipped;
    if (typeof equipped !== "boolean") return; // só toggles de equip
    if (!isReportingGm()) return;

    const actor = eligibleActor(item);
    if (!actor) return;

    const companionItemId = getCompanionItemId(item);
    if (companionItemId) {
      const res = await postInbound({ actor_id: actor.id, item_id: companionItemId, equipped });
      if (res?.ok) console.log(`${MODULE_ID} | equip → Companion: "${item.name}" equipped=${equipped}`);
      return;
    }
    // Sem crachá = item nativo que ainda não viajou — o upsert leva o estado
    // de equipped junto e devolve o crachá (equips futuros vão pela rota leve).
    if (!isBridgeManaged(item)) await upsertItem(item, actor);
  });

  // ITEM NOVO no actor — manda completo pro Companion.
  Hooks.on("createItem", async (item, options, _userId) => {
    if (options?.companionBridge) return;                       // camada 1
    if (isBridgeManaged(item) || getCompanionItemId(item)) return; // camada 2
    if (!isReportingGm()) return;

    const actor = eligibleActor(item);
    if (!actor) return;

    await upsertItem(item, actor);
  });

  console.log(`${MODULE_ID} | equip watcher registrado (updateItem + createItem)`);
}

/* -------------------------------------------- */
/*  Sync inicial (macro/console)                */
/* -------------------------------------------- */

/**
 * Envia TODO o inventário físico de um actor pro Companion (itens que já
 * existiam no Foundry antes da ponte). Itens synced/com crachá são pulados.
 * Ritmo de 1 item a cada 7s por causa do rate-limit da edge (10/60s).
 * Uso (macro ou console, como GM):
 *   game.modules.get("companion-foundry-bridge").api.syncInventory(actor)
 *   // actor = canvas.tokens.controlled[0]?.actor ?? game.actors.getName("Nome")
 */
export async function syncActorInventory(actor) {
  if (!(actor instanceof Actor)) {
    ui.notifications.error("Companion: passe um Actor (ex.: game.actors.getName(\"Nome\")).");
    return null;
  }
  const pending = actor.items.filter(
    (i) => isSyncableItem(i) && !isBridgeManaged(i) && !getCompanionItemId(i)
  );
  ui.notifications.info(`Companion: enviando ${pending.length} itens de "${actor.name}"…`);

  let sent = 0;
  let failed = 0;
  for (const item of pending) {
    const ok = await upsertItem(item, actor);
    ok ? sent++ : failed++;
    if (item !== pending[pending.length - 1]) {
      await new Promise((r) => setTimeout(r, INITIAL_SYNC_DELAY_MS));
    }
  }

  const summary = `sync inicial de "${actor.name}": ${sent} enviados, ${failed} falhas, ${pending.length} elegíveis`;
  console.log(`${MODULE_ID} | ${summary}`);
  ui.notifications[failed ? "warn" : "info"](`Companion: ${summary}`);
  return { sent, failed, total: pending.length };
}

/**
 * Desfaz o vínculo deste actor com o Companion, deixando o inventário do
 * Foundry pronto para ser enviado do zero.
 *
 * Existe porque o `syncActorInventory` PULA item que já tem crachá. Se o
 * Companion for zerado do outro lado (apagar as linhas de character_items), os
 * itens daqui continuam carimbados com ids que não existem mais — e o sync
 * inicial não mandaria nada. Este passo tira os carimbos.
 *
 * Faz duas coisas:
 *  - APAGA os itens criados pelo bridge (`synced`): eles são cópias do que o
 *    Companion mandou um dia, não itens do Foundry.
 *  - LIMPA o crachá dos itens NATIVOS, que ficam intactos no resto.
 *
 * Uso (macro ou console, como GM), na ordem:
 *   const api = game.modules.get("companion-foundry-bridge").api;
 *   await api.resetLink(actor);      // 1. solta o vínculo aqui
 *   // 2. apagar as linhas do PC no Companion
 *   await api.syncInventory(actor);  // 3. manda tudo de novo (~7s por item)
 */
export async function resetActorLink(actor) {
  if (!(actor instanceof Actor)) {
    ui.notifications.error("Companion: passe um Actor (ex.: game.actors.getName(\"Nome\")).");
    return null;
  }

  const doBridge = actor.items.filter((i) => isBridgeManaged(i)).map((i) => i.id);
  if (doBridge.length) {
    await actor.deleteEmbeddedDocuments("Item", doBridge, { companionBridge: true });
  }

  // Os dois escopos: o válido e o legado "companion" (itens pré-B1).
  const limpar = actor.items
    .filter((i) => getCompanionItemId(i))
    .map((i) => ({
      _id: i.id,
      [`flags.${MODULE_ID}.-=item_id`]: null,
      "flags.companion.-=item_id": null,
    }));
  if (limpar.length) {
    await actor.updateEmbeddedDocuments("Item", limpar, { companionBridge: true });
  }

  const resumo = `vínculo solto em "${actor.name}": ${doBridge.length} cópia(s) do bridge apagada(s), ${limpar.length} crachá(s) limpo(s)`;
  console.log(`${MODULE_ID} | ${resumo}`);
  ui.notifications.info(`Companion: ${resumo}`);
  return { removidos: doBridge.length, limpos: limpar.length };
}
