import { MODULE_ID } from "./settings.js";
import { isReportingGm, postInbound } from "./equip-sync.js";
import { MOEDAS, decidirMoedas, mesmasMoedas, moedasValidas, mudouMoedas, sincronizadoValido } from "./moedas.js";

/**
 * MOEDAS Companion ⇄ Foundry (v1.9.0). As regras estão em moedas.js.
 *
 * IDA: o envio do Companion (actor.update) traz
 * `flags["companion-foundry-bridge"].moedas = { pp, gp, ep, sp, cp, versao }`;
 * o bridge-client chama `aplicarMoedasDoCompanion`. O módulo 1.8.0 não
 * conhecia a chave e só a gravava como flag do ator — nunca aplicava.
 *
 * VOLTA: a mudança de `system.currency` feita AQUI (ficha, item comprado no
 * Foundry, /award…) vai à foundry-inbound como `op: "actor.moedas"`. A edge
 * grava a carteira e devolve a versão nova, que fica na flag `moedas_sync`.
 * Operações do bridge (`companionBridge: true`) não voltam: o eco morre aqui.
 *
 * Ao abrir o mundo, todo personagem sem `moedas_sync`, ou com moedas diferentes
 * dela, manda as dele (o Foundry vence o primeiro contato).
 */

const FLAG = "moedas_sync";
const ESPERA_MS = 800;
const ESPERA_429_MS = 5_000;
const RETENTATIVAS = 3;
const AO_ABRIR_MS = 8_000;

const timers = new Map(); // actorId -> timeout
const emVoo = new Set();
const deNovo = new Set(); // mudou enquanto o POST estava em voo

function personagem(actor) {
  return actor instanceof Actor && actor.type === "character" ? actor : null;
}
const atuais = (actor) => moedasValidas(actor?.system?.currency);
const sincronizado = (actor) => sincronizadoValido(actor?.getFlag?.(MODULE_ID, FLAG));

/**
 * IDA — as moedas do envio do Companion. Devolve a decisão (moedas.js), que
 * volta na resposta do actor.update para a edge registrar.
 */
export async function aplicarMoedasDoCompanion(actor, recebido) {
  const decisao = decidirMoedas({ atual: atuais(actor), sincronizado: sincronizado(actor), recebido });
  if (decisao === "aplicar" || decisao === "igual") {
    const mudanca = { [`flags.${MODULE_ID}.${FLAG}`]: { ...moedasValidas(recebido), versao: recebido.versao } };
    if (decisao === "aplicar") for (const k of MOEDAS) mudanca[`system.currency.${k}`] = recebido[k];
    await actor.update(mudanca, { companionBridge: true });
  } else if (decisao === "foundry_vence") {
    agendarMoedas(actor);
  }
  console.log(`${MODULE_ID} | moedas do Companion para "${actor.name}": ${decisao}`);
  return decisao;
}

/** VOLTA — agenda o envio das moedas deste ator (agrupado, 800 ms). */
export function agendarMoedas(actor, ms = ESPERA_MS, tentativa = 0) {
  const a = personagem(actor);
  if (!a || !isReportingGm()) return;
  clearTimeout(timers.get(a.id));
  timers.set(
    a.id,
    setTimeout(() => {
      timers.delete(a.id);
      void enviarMoedas(a.id, tentativa);
    }, ms),
  );
}

async function enviarMoedas(actorId, tentativa) {
  if (emVoo.has(actorId)) {
    deNovo.add(actorId);
    return;
  }
  const actor = game.actors.get(actorId);
  if (!actor) return;
  const moedas = atuais(actor);
  if (!moedas) {
    console.warn(`${MODULE_ID} | moedas de "${actor.name}" fora do formato do dnd5e — não enviadas`, actor.system?.currency);
    return;
  }

  emVoo.add(actorId);
  let res;
  try {
    res = await postInbound({ op: "actor.moedas", actor_id: actorId, moedas }, { silencioso404: true });
  } finally {
    emVoo.delete(actorId);
  }

  if (res?.ok && Number.isInteger(res.versao)) {
    // O acordo só vale para as moedas que foram. Se mudaram durante o envio,
    // outra rodada leva as novas.
    if (mesmasMoedas(atuais(actor), moedas)) {
      await actor.update({ [`flags.${MODULE_ID}.${FLAG}`]: { ...moedas, versao: res.versao } }, { companionBridge: true });
      console.log(`${MODULE_ID} | moedas → Companion: "${actor.name}" (versão ${res.versao})`);
    } else {
      deNovo.add(actorId);
    }
  } else if (res?.code === "actor_nao_vinculado") {
    deNovo.delete(actorId);
    return;
  } else if ((res === null || res?.status === 429 || res?.status >= 500) && tentativa < RETENTATIVAS) {
    agendarMoedas(actor, ESPERA_429_MS * (tentativa + 1), tentativa + 1);
    return;
  }
  if (deNovo.delete(actorId)) agendarMoedas(actor);
}

export function registerMoedasSync() {
  Hooks.on("updateActor", (actor, changes, options) => {
    if (options?.companionBridge) return; // veio do Companion
    if (!personagem(actor) || !mudouMoedas(changes)) return;
    agendarMoedas(actor);
  });

  setTimeout(() => {
    for (const actor of game.actors.filter((a) => a.type === "character")) {
      const s = sincronizado(actor);
      if (!s || !mesmasMoedas(atuais(actor), s)) agendarMoedas(actor);
    }
  }, AO_ABRIR_MS);

  console.log(`${MODULE_ID} | moedas Companion ⇄ Foundry registradas`);
}
