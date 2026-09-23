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
/** A edge corta o body em 32 KiB; os efeitos dos equipados são o que pesa. */
const MAX_SNAPSHOT_JSON = 28_000;

const timers = new Map(); // actorId -> timeout
const naoVinculado = new Map(); // actorId -> até quando ignorar

function personagem(doc) {
  const actor = doc instanceof Actor ? doc : doc?.parent instanceof Actor ? doc.parent : doc?.parent?.parent;
  return actor instanceof Actor && actor.type === "character" ? actor : null;
}

async function enviarFicha(actor) {
  const ate = naoVinculado.get(actor.id) ?? 0;
  if (Date.now() < ate) return;

  let snapshot;
  try {
    snapshot = readActor(actor.id, MODULE_ID);
  } catch (err) {
    console.warn(`${MODULE_ID} | não consegui ler a ficha de "${actor.name}":`, err);
    return;
  }
  // Grande demais: vai sem os efeitos dos equipados (os números calculados,
  // que são o que o painel mostra, continuam inteiros).
  if (JSON.stringify(snapshot).length > MAX_SNAPSHOT_JSON) {
    snapshot = { ...snapshot, equipped: (snapshot.equipped ?? []).map(({ effects, ...resto }) => resto) };
  }

  const res = await postInbound({ op: "actor.snapshot", actor_id: actor.id, snapshot }, { silencioso404: true });
  if (res?.status === 404) {
    naoVinculado.set(actor.id, Date.now() + NAO_VINCULADO_MS);
    return;
  }
  if (res?.ok) naoVinculado.delete(actor.id);
}

/** Agenda o envio da ficha deste actor (debounce). */
export function agendarFicha(actor) {
  if (!actor || !isReportingGm()) return;
  clearTimeout(timers.get(actor.id));
  timers.set(
    actor.id,
    setTimeout(() => {
      timers.delete(actor.id);
      void enviarFicha(actor);
    }, DEBOUNCE_MS),
  );
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
