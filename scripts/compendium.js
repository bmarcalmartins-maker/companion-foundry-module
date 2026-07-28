import { MODULE_ID } from "./settings.js";

/**
 * LEITURA do compêndio do Foundry (FASE 1 — canal de leitura).
 *
 * Até aqui o protocolo da ponte só EMPURRAVA (actor.create/update/delete). Este
 * arquivo é o outro sentido: o Companion pergunta o que existe nos compêndios e
 * o Foundry responde. Serve ao espelho local do compêndio no Supabase — o
 * Companion NÃO consulta o Foundry a cada busca; importa uma vez, sob demanda
 * do DM, e busca no espelho.
 *
 * DUAS OPERAÇÕES:
 *   listPacks()  → que compêndios de Item existem (o DM escolhe quais importar)
 *   listItems()  → os itens de packs escolhidos, paginado
 *
 * ── `effects` VIAJA CRU ──
 * O array de ActiveEffects sai daqui EXATAMENTE como o Foundry o guarda. Nada
 * de normalizar, traduzir ou achatar: quem interpreta é o Companion, e ele só
 * consegue interpretar direito se receber o shape nativo do dnd5e. Traduzir
 * aqui criaria um segundo formato de efeito no mundo — que é justamente o que a
 * arquitetura decidiu NÃO fazer.
 *
 * ── POR QUE NÃO TEM THROTTLE DE 7s ──
 * O `INITIAL_SYNC_DELAY_MS` do equip-sync.js existe por causa do rate-limit da
 * edge `foundry-inbound` (10 upserts/60s) — é throttle de SAÍDA HTTP. Aqui a
 * leitura é LOCAL (o pack já está no disco/IndexedDB do Foundry), sem
 * rate-limit nenhum. Aplicar 7s por item faria 3000 itens levarem ~6h. O que
 * protege aqui é outra coisa: página pequena (o Worker tem teto de resposta) e
 * `yield` no event loop a cada lote, pra não congelar a UI do Foundry enquanto
 * lê. Ver YIELD_EVERY.
 */

/** Teto de itens por página. Acima disso a resposta fica grande demais pro Worker. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

/** Devolve o controle ao browser a cada N documentos lidos (UI não congela). */
const YIELD_EVERY = 25;

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

/* -------------------------------------------- */
/*  Packs                                       */
/* -------------------------------------------- */

/**
 * Compêndios de ITEM disponíveis neste mundo, com contagem real.
 *
 * A contagem sai de `getIndex()` (não de `pack.index`, que fica vazio até o
 * índice ser carregado pela primeira vez — pack recém-instalado reportaria 0).
 * Só packs de Item: Actor/JournalEntry/Scene não interessam ao inventário.
 */
export async function listPacks() {
  const packs = game.packs.filter((p) => p.documentName === "Item");
  const out = [];

  for (const pack of packs) {
    let count = null;
    try {
      count = (await pack.getIndex()).size;
    } catch (err) {
      // Pack quebrado não derruba a listagem inteira — vai com count null e o
      // DM vê que aquele ali não deu pra ler.
      console.error(`${MODULE_ID} | falha ao indexar ${pack.collection}:`, err);
    }
    out.push({
      id: pack.collection,                       // "dnd5e.items" — chave estável
      label: pack.metadata?.label ?? pack.title ?? pack.collection,
      document_type: pack.documentName,
      origin: pack.metadata?.packageType ?? null, // "system" | "module" | "world"
      package_name: pack.metadata?.packageName ?? null,
      count,
    });
  }

  return { packs: out };
}

/* -------------------------------------------- */
/*  Extração de campos                          */
/* -------------------------------------------- */

/*
 * NOTA DE DUPLICAÇÃO (deliberada, não descuido): a leitura de
 * dano/CA/alcance abaixo repete a de `combatStats` em equip-sync.js:141-160.
 * Não unifiquei porque isso seria refatorar um caminho que já está em produção
 * no meio de uma implementação nova. Aqui o extrator precisa de MAIS campos
 * (raridade, peso, preço, propriedades), então nem seria a mesma função.
 * Candidato a faxina depois que a FASE 1 estiver validada em prod.
 *
 * ⚠️ O shape de `system.range` está marcado como HIPÓTESE no equip-sync.js e
 * continua HIPÓTESE aqui — nenhum item real do compêndio foi lido ainda. A
 * ETAPA 1.4 (Foundry ligado) é o que valida ou derruba isto.
 */

/** "2d6+1" a partir de system.damage.base { number, denomination, bonus }. */
function damageDice(sys) {
  const d = sys?.damage?.base;
  if (!d?.number || !d?.denomination) return null;
  return `${d.number}d${d.denomination}${d.bonus ? `+${d.bonus}` : ""}`;
}

function damageType(sys) {
  const types = sys?.damage?.base?.types;
  return Array.isArray(types) && types.length ? String(types[0]) : null;
}

function acBase(sys) {
  const v = sys?.armor?.value;
  return typeof v === "number" && v > 0 ? v : null;
}

function rangeText(sys) {
  const r = sys?.range;
  if (!r) return null;
  const units = r.units || "ft";
  if (r.value) return `${r.value}${r.long ? `/${r.long}` : ""} ${units}`.trim();
  if (r.reach) return `reach ${r.reach} ${units}`.trim();
  return null;
}

/**
 * Propriedades ("Versátil, Leve") a partir de system.properties, que no dnd5e
 * v5 é um Set de chaves curtas ("ver", "lgt") — `toObject()` entrega array.
 *
 * Tenta o rótulo legível via CONFIG.DND5E.itemProperties; chave que não resolve
 * vai CRUA em vez de sumir. [HIPÓTESE: o shape de CONFIG.DND5E.itemProperties
 * (objeto { chave: { label } }) não foi verificado contra um dnd5e rodando.]
 */
function propertiesText(sys) {
  const raw = sys?.properties;
  const list = Array.isArray(raw) ? raw : raw instanceof Set ? [...raw] : [];
  if (!list.length) return null;
  const cfg = globalThis.CONFIG?.DND5E?.itemProperties ?? {};
  const labels = list.map((key) => {
    const entry = cfg[key];
    const label = typeof entry === "string" ? entry : entry?.label;
    return label || String(key); // chave crua > sumir em silêncio
  });
  return labels.join(", ");
}

/**
 * Um item do compêndio no formato que o espelho do Companion consome.
 *
 * Devolve os campos ACHATADOS (pras colunas e pra busca) E os crus
 * (`system_raw`, `effects`) — o espelho guarda os dois: o achatado é o que a
 * tela lê rápido, o cru é a verdade que sobrevive a qualquer mudança de UI.
 */
function itemPayload(doc, packId) {
  const data = doc.toObject();
  const sys = data.system ?? {};

  return {
    // Identidade estável entre reimportações.
    foundry_uuid: doc.uuid ?? `Compendium.${packId}.Item.${data._id}`,
    foundry_id: data._id ?? null,
    pack_id: packId,

    name: data.name ?? null,
    type: data.type ?? null,
    img: data.img ?? null,

    rarity: sys.rarity || null,
    weight: typeof sys.weight?.value === "number" ? sys.weight.value : null,
    cost_value: typeof sys.price?.value === "number" ? sys.price.value : null,
    cost_unit: sys.price?.denomination || null,

    damage_dice: damageDice(sys),
    damage_type: damageType(sys),
    ac_base: acBase(sys),
    range: rangeText(sys),
    properties: propertiesText(sys),

    // Crus, intocados.
    system_raw: sys,
    effects: Array.isArray(data.effects) ? data.effects : [],
  };
}

/* -------------------------------------------- */
/*  Items (paginado)                            */
/* -------------------------------------------- */

/**
 * Itens dos packs pedidos, uma página por vez.
 *
 * PAGINAÇÃO ESTÁVEL: monta a lista completa de candidatos pelos ÍNDICES (que
 * são baratos — nome e id, sem carregar o documento), ordena de forma
 * determinística (pack, nome, id) e só então recorta a página. Só os documentos
 * DA PÁGINA são carregados de verdade. Sem a ordenação determinística, duas
 * chamadas com offsets diferentes poderiam repetir ou pular itens.
 *
 * `packs` vazio ou ausente = erro explícito, não "todos". Importar 3000 itens
 * por engano é exatamente o que a arquitetura decidiu evitar.
 */
export async function listItems({ packs, offset = 0, limit = DEFAULT_LIMIT } = {}) {
  const wanted = Array.isArray(packs) ? packs.filter(Boolean) : [];
  if (!wanted.length) throw new Error("compendium.items: 'packs' obrigatório (lista de ids de pack)");

  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));

  // 1) Candidatos (barato — só índice).
  const candidates = [];
  const missing = [];
  for (const packId of wanted) {
    const pack = game.packs.get(packId);
    if (!pack || pack.documentName !== "Item") {
      missing.push(packId);
      continue;
    }
    try {
      for (const entry of await pack.getIndex()) {
        candidates.push({ pack, packId, id: entry._id, name: entry.name ?? "" });
      }
    } catch (err) {
      console.error(`${MODULE_ID} | falha ao indexar ${packId}:`, err);
      missing.push(packId);
    }
  }

  // 2) Ordem determinística — o que torna a paginação confiável.
  candidates.sort(
    (a, b) =>
      a.packId.localeCompare(b.packId) ||
      a.name.localeCompare(b.name) ||
      String(a.id).localeCompare(String(b.id)),
  );

  const total = candidates.length;
  const page = candidates.slice(start, start + size);

  // 3) Só a página vira documento de verdade.
  const items = [];
  const failed = [];
  let lidos = 0;
  for (const c of page) {
    try {
      const doc = await c.pack.getDocument(c.id);
      if (doc) items.push(itemPayload(doc, c.packId));
      else failed.push({ pack_id: c.packId, id: c.id, error: "documento não encontrado" });
    } catch (err) {
      // Um item ruim não derruba a página — vai na lista de falhas e o
      // importador do Companion mostra. Nunca falha em silêncio.
      failed.push({ pack_id: c.packId, id: c.id, error: err?.message ?? String(err) });
    }
    if (++lidos % YIELD_EVERY === 0) await yieldToUi();
  }

  return {
    items,
    total,
    offset: start,
    limit: size,
    has_more: start + page.length < total,
    /** Packs pedidos que não existem ou não deram pra ler — visibilidade, não silêncio. */
    missing_packs: missing,
    /** Itens da página que falharam individualmente. */
    failed,
  };
}
