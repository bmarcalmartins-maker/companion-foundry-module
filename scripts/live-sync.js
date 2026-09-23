import { MODULE_ID } from "./settings.js";
import { readActor } from "./actor-read.js";
import { getCompanionItemId, isReportingGm, postInbound, reportItemEffects } from "./equip-sync.js";

/**
 * TEMPO REAL Foundry → Companion (IMPL-47, v1.7.0).
 *
 * O Foundry é a fonte da verdade da ficha. Até a v1.6.0 o Companion só relia a
 * ficha quando ELE mudava alguma coisa (equipar pelo Companion) ou quando o
 * jogador abria a tela. Mudança feita AQUI — dano, cura, subir de nível,
 * editar um atributo, ligar um efeito — só aparecia lá na próxima leitura.
 *
 * Agora este arquivo EMPURRA:
 *  1. a ficha calculada (`readActor`) do personagem, sempre que o actor, um
 *     item dele ou um ActiveEffect dele muda — `op: "actor.snapshot"` na edge
 *     foundry-inbound, que grava `character_foundry_snapshot` e o Companion
 *     recebe pelo realtime;
 *  2. os efeitos de um item com crachá do Companion, quando um ActiveEffect
 *     desse item é criado, alterado ou apagado — `op: "item.effects"`.
 *
 * Três cuidados:
 *  - DEBOUNCE por actor: uma troca de inventário do bridge apaga e recria
 *    vários itens de uma vez; um envio só, depois que tudo assentou;
 *  - só personagens (`type === "character"`). Actor que o Companion não
 *    conhece responde 404: fica marcado como "não vinculado" por 10 minutos
 *    em vez de insistir a cada mudança;
 *  - só o GM que reporta (`isReportingGm`), como o resto da volta.
 *
 * Mudanças feitas PELO bridge (`companionBridge: true`) também disparam o
 * envio da ficha: o equipar veio do Companion, mas a ficha que resultou disso
 * é do Foundry e precisa voltar. Não vira laço — `actor.snapshot` só grava a
 * tabela do espelho, que não dispara nada.
 */

const DEBOUNCE_MS = 800;
const NAO_VINCULADO_MS = 10 * 60 * 1000;
/**
 * A edge corta o body em 128 KiB. Com os efeitos enxutos (`effect-shape.js`) a
 * ficha de um personagem fica em poucos KB; o teto aqui é só a rede de
 * segurança, e passar dele é AVISADO no console — nunca corte em silêncio.
 */
const MAX_SNAPSHOT_JSON = 120_000;

/**
 * Intervalo mínimo entre duas fichas do MESMO actor. A edge aceita 30 por
 * minuto por actor; com o debounce de 800 ms sozinho, mudanças espaçadas de
 * pouco mais de 800 ms (PV clicado em combate) passavam disso e o 429 perdia a
 * ficha final. 2,5 s dá no máximo 24 por minuto.
 */
const INTERVALO_MIN_MS = 2_500;
const ESPERA_429_MS = 5_000;

const timers = new Map(); // actorId -> timeout
const naoVinculado = new Map(); // actorId -> até quando ignorar
const ultimoEnvio = new Map(); // actorId -> Date.now() do último POST
const emVoo = new Set(); // actorIds com POST em andamento
const deNovo = new Set(); // mudou enquanto o POST estava em voo
const segurados = new Map(); // actorId -> quantas operações do bridge em curso

function personagem(doc) {
  const actor = doc instanceof Actor ? doc : doc?.parent instanceof Actor ? doc.parent : doc?.parent?.parent;
  return actor instanceof Actor && actor.type === "character" ? actor : null;
}

/** Devolve o status HTTP do envio (ou null se não enviou). */
async function enviarFicha(actorId) {
  const actor = game.actors.get(actorId);
  if (!actor) return null;
  const ate = naoVinculado.get(actor.id) ?? 0;
  if (Date.now() < ate) return null;

  let snapshot;
  try {
    snapshot = readActor(actor.id, MODULE_ID);
  } catch (err) {
    console.warn(`${MODULE_ID} | não consegui ler a ficha de "${actor.name}":`, err);
    return null;
  }
  // Rede de segurança: grande demais, vai sem os efeitos dos equipados (os
  // números calculados, que são o que o painel mostra, continuam inteiros).
  // Se nem assim couber, não manda — ficha cortada seria ficha errada.
  let tamanho = JSON.stringify(snapshot).length;
  if (tamanho > MAX_SNAPSHOT_JSON) {
    console.warn(
      `${MODULE_ID} | ficha de "${actor.name}" com ${tamanho} caracteres (teto ${MAX_SNAPSHOT_JSON}) — enviando sem os efeitos dos itens equipados`,
    );
    snapshot = { ...snapshot, equipped: (snapshot.equipped ?? []).map(({ effects, ...resto }) => resto) };
    tamanho = JSON.stringify(snapshot).length;
    if (tamanho > MAX_SNAPSHOT_JSON) {
      console.warn(`${MODULE_ID} | ficha de "${actor.name}" ainda com ${tamanho} caracteres — não enviada`);
      return null;
    }
  }

  ultimoEnvio.set(actor.id, Date.now());
  const res = await postInbound({ op: "actor.snapshot", actor_id: actor.id, snapshot }, { silencioso404: true });
  // Só o 404 "actor não vinculado" pausa. Outro erro (banco fora, dois PCs no
  // mesmo actor) aparece no console e NÃO silencia o personagem por 10 min.
  if (res?.code === "actor_nao_vinculado") {
    naoVinculado.set(actor.id, Date.now() + NAO_VINCULADO_MS);
    return 404;
  }
  if (res?.ok) naoVinculado.delete(actor.id);
  return res?.ok ? 200 : (res?.status ?? null);
}

/*
 * Um POST por actor por vez. Sem isto, um POST lento e uma mudança nova
 * mandavam dois ao mesmo tempo, e o mais velho podia chegar por último e
 * deixar gravada a ficha antiga. Mudança durante o voo vira um envio a mais,
 * DEPOIS — com a ficha lida na hora, logo a final.
 */
async function disparar(actorId) {
  if (emVoo.has(actorId)) {
    deNovo.add(actorId);
    return;
  }
  const espera = (ultimoEnvio.get(actorId) ?? 0) + INTERVALO_MIN_MS - Date.now();
  if (espera > 0) {
    armar(actorId, espera);
    return;
  }
  emVoo.add(actorId);
  let status = null;
  try {
    status = await enviarFicha(actorId);
  } finally {
    emVoo.delete(actorId);
  }
  if (status === 429) {
    armar(actorId, ESPERA_429_MS);
  } else if (deNovo.delete(actorId)) {
    armar(actorId, DEBOUNCE_MS);
  }
}

function armar(actorId, ms) {
  clearTimeout(timers.get(actorId));
  timers.set(
    actorId,
    setTimeout(() => {
      timers.delete(actorId);
      void disparar(actorId);
    }, ms),
  );
}

/** Agenda o envio da ficha deste actor (debounce). */
export function agendarFicha(actor) {
  if (!actor || !isReportingGm()) return;
  // Bridge no meio de uma troca de inventário: a ficha de agora está pela
  // metade (itens velhos já apagados, novos ainda não criados). Vai quando ele
  // soltar.
  if (segurados.get(actor.id)) return;
  armar(actor.id, DEBOUNCE_MS);
}

/**
 * O bridge avisa que vai mexer no actor (actor.update) e depois que terminou.
 * Enquanto segurado, nenhuma ficha sai; ao soltar, sai UMA, com o estado final.
 */
export function segurarFicha(actorId) {
  segurados.set(actorId, (segurados.get(actorId) ?? 0) + 1);
  clearTimeout(timers.get(actorId));
  timers.delete(actorId);
}

export function soltarFicha(actorId) {
  const n = (segurados.get(actorId) ?? 1) - 1;
  if (n > 0) {
    segurados.set(actorId, n);
    return;
  }
  segurados.delete(actorId);
  const actor = game.actors.get(actorId);
  if (actor?.type === "character") agendarFicha(actor);
}

/*
 * Efeitos de item também em lote: criar um item com três efeitos dispara três
 * hooks seguidos, e três POSTs estourariam o limite da edge (10/min por actor).
 * Junta os itens tocados e manda uma vez, depois que assentou.
 */
const itensPendentes = new Map(); // actorId -> Map(itemId -> item)
const timersEfeitos = new Map();

function agendarEfeitos(actor, item) {
  const fila = itensPendentes.get(actor.id) ?? new Map();
  fila.set(item.id, item);
  itensPendentes.set(actor.id, fila);
  clearTimeout(timersEfeitos.get(actor.id));
  timersEfeitos.set(
    actor.id,
    setTimeout(() => {
      timersEfeitos.delete(actor.id);
      const itens = [...(itensPendentes.get(actor.id)?.values() ?? [])].filter((i) => !actor.items?.get || actor.items.get(i.id));
      itensPendentes.delete(actor.id);
      void reportItemEffects(actor, itens);
    }, DEBOUNCE_MS),
  );
}

export function registerLiveSync() {
  // Ficha: o próprio actor mudou (PV, nível, atributos, CA manual…).
  Hooks.on("updateActor", (actor) => {
    const a = personagem(actor);
    if (a) agendarFicha(a);
  });

  // Ficha: itens entram, saem ou mudam (equipar, sintonizar, quantidade).
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      const a = personagem(item);
      if (a) agendarFicha(a);
    });
  }

  // Efeitos: no actor ou num item dele. Se o efeito é de um item com crachá
  // do Companion, os efeitos daquele item também voltam.
  for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(hook, (effect) => {
      const a = personagem(effect);
      if (!a) return;
      agendarFicha(a);
      const item = effect?.parent instanceof Item ? effect.parent : null;
      if (item && getCompanionItemId(item)) agendarEfeitos(a, item);
    });
  }

  // Ao abrir o mundo, a ficha de cada personagem vai uma vez: o Companion
  // pode estar com números de quando o Foundry estava desligado.
  setTimeout(() => {
    for (const actor of game.actors.filter((x) => x.type === "character")) agendarFicha(actor);
  }, 5_000);

  console.log(`${MODULE_ID} | tempo real Foundry→Companion registrado (ficha + efeitos)`);
}
