/**
 * LEITURA DA FICHA CALCULADA (IMPL-47, comando `actor.read`).
 *
 * O Foundry é a fonte da verdade da ficha. O Companion nunca soma base + bônus:
 * ele pede isto aqui e mostra o que o dnd5e calculou.
 *
 * Tudo sai do `actor.system` DEPOIS do prepareData — ou seja, com os
 * ActiveEffects dos itens já aplicados. Caminhos conferidos no código do dnd5e
 * 5.3.0 (tag release-5.3.0), não de memória:
 *
 *   abilities.<x>.value      valor final (efeitos aplicados antes do derivado)
 *   abilities.<x>.mod        module/data/actor/templates/common.mjs:137
 *   abilities.<x>.save.value module/data/actor/templates/common.mjs:161
 *   attributes.ac.value      module/data/actor/templates/attributes.mjs:234
 *     (e as partes base/armor/shield/bonus/cover, :124-233)
 *   attributes.hp.value/max  module/data/actor/templates/attributes.mjs:356-361
 *   attributes.prof          module/data/actor/character.mjs:170
 *   attributes.init.total    module/data/actor/templates/attributes.mjs:403
 *   attributes.init.mod      module/data/actor/templates/attributes.mjs:381
 *
 * Regra: só vai NÚMERO. Campo que não existir ou não for número é OMITIDO —
 * a tela do Companion mostra "—", nunca um valor inventado.
 */

import { efeitoEnxuto } from "./effect-shape.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/** Número finito ou undefined (o JSON some com a chave). */
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** `save` virou objeto `{ value }` no dnd5e 4+; aceita o número antigo também. */
function saveDe(abl) {
  const s = abl?.save;
  if (typeof s === "number") return num(s);
  return num(s?.value);
}

export function readActor(actorId, moduleId) {
  if (!actorId) throw new Error("missing actor_id");
  const actor = game.actors.get(actorId);
  if (!actor) throw new Error(`actor not found: ${actorId}`);

  const sys = actor.system ?? {};
  const attrs = sys.attributes ?? {};

  const abilities = {};
  for (const k of ABILITIES) {
    const a = sys.abilities?.[k];
    if (!a) continue;
    abilities[k] = { value: num(a.value), mod: num(a.mod), save: saveDe(a) };
  }

  const ac = attrs.ac ?? {};
  const hp = attrs.hp ?? {};

  const equipped = actor.items
    .filter((i) => i.system?.equipped === true)
    .map((i) => ({
      id: i.id,
      uuid: i.uuid,
      name: i.name,
      type: i.type,
      companion_item_id:
        i.getFlag?.(moduleId, "item_id") ?? i.flags?.companion?.item_id ?? null,
      equipped: true,
      effects: Array.from(i.effects ?? []).map(efeitoEnxuto),
    }));

  return {
    schema: 1,
    actor_id: actor.id,
    name: actor.name,
    system_version: game.system?.version ?? null,
    foundry_version: game.version ?? null,
    read_at: new Date().toISOString(),
    level: num(sys.details?.level),
    abilities,
    ac: {
      value: num(ac.value),
      base: num(ac.base),
      armor: num(ac.armor),
      shield: num(ac.shield),
      bonus: num(ac.bonus),
      cover: num(ac.cover),
      calc: typeof ac.calc === "string" ? ac.calc : undefined,
    },
    hp: {
      value: num(hp.value),
      max: num(hp.max),
      temp: num(hp.temp),
      tempmax: num(hp.tempmax),
    },
    prof: num(attrs.prof),
    init: { total: num(attrs.init?.total), mod: num(attrs.init?.mod) },
    equipped,
  };
}
