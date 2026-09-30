/**
 * A volta Foundry→Companion (equip-sync.js) com um Foundry de mentira: os
 * ganchos recebem o que o Foundry passaria e o teste confere o que sai para a
 * foundry-inbound. Mesmo espírito do bridge-client.test.js: prova a cola, não
 * o Foundry de verdade.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const MODULE_ID = "companion-foundry-bridge";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

class Colecao extends Map {
  filter(fn) { return [...this.values()].filter(fn); }
  find(fn) { return [...this.values()].find(fn); }
  some(fn) { return [...this.values()].some(fn); }
  [Symbol.iterator]() { return this.values(); }
}
class FakeActor {
  constructor(id, type = "character") { this.id = id; this.name = id; this.type = type; this.items = new Colecao(); }
}
class FakeItem {
  constructor(id, parent, dados) {
    this.id = id;
    this.parent = parent;
    this.name = dados.name ?? id;
    this.type = dados.type ?? "equipment";
    this.img = dados.img ?? "";
    this.system = dados.system ?? {};
    this.flags = dados.flags ?? {};
    this.effects = [];
    this.updates = [];
    parent.items.set(id, this);
  }
  getFlag(scope, chave) { return this.flags?.[scope]?.[chave]; }
  async update(mudanca, options) {
    this.updates.push({ mudanca, options });
    for (const [k, v] of Object.entries(mudanca)) {
      const partes = k.split(".");
      const ultima = partes.at(-1);
      let alvo = this;
      for (const p of partes.slice(0, -1)) alvo = alvo[p] ??= {};
      if (ultima.startsWith("-=")) delete alvo[ultima.slice(2)];
      else alvo[ultima] = v;
    }
  }
}

const ganchos = {};
const posts = [];
globalThis.foundry = { applications: { api: { ApplicationV2: class {} } } };
globalThis.Actor = FakeActor;
globalThis.Item = FakeItem;
globalThis.Hooks = { on: (nome, fn) => (ganchos[nome] ??= []).push(fn), once() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.game = {
  settings: { get: (_m, chave) => ({ inboundUrl: "https://inbound/foundry-inbound", inboundKeyLocal: "ik" })[chave] },
  actors: new Colecao(),
  users: { activeGM: { id: "gm" } },
  user: { id: "gm", isGM: true },
};
globalThis.fetch = async (_url, init) => {
  const corpo = JSON.parse(init.body);
  posts.push(corpo);
  if (corpo.op === "item.upsert") return new Response(JSON.stringify({ ok: true, item_id: "novo-cracha", created: true }), { status: 200 });
  return new Response(JSON.stringify({ ok: true, gravados: 1, fora: [], removido: true }), { status: 200 });
};
console.log = () => {};
console.warn = () => {};

const { registerEquipWatcher, crachasApagadosHaPouco } = await import("../scripts/equip-sync.js");
registerEquipWatcher();
const dispara = async (nome, ...args) => { for (const fn of ganchos[nome] ?? []) await fn(...args); };

const ator = new FakeActor("atorA");
game.actors.set(ator.id, ator);
const comCracha = (id, cracha, dados = {}) =>
  new FakeItem(id, ator, { ...dados, flags: { [MODULE_ID]: { item_id: cracha, ...(dados.flags?.[MODULE_ID] ?? {}) } } });

test("quantidade, equipado e sintonia mudados no Foundry voltam num item.estado só", async () => {
  posts.length = 0;
  const pocao = comCracha("p1", "cp1", { type: "consumable", system: { quantity: 3 } });
  const anel = comCracha("a1", "ca1", { system: { equipped: false, attunement: "required", attuned: false } });
  pocao.system.quantity = 2;
  await dispara("updateItem", pocao, { system: { quantity: 2 } }, {});
  anel.system.equipped = true;
  await dispara("updateItem", anel, { system: { equipped: true } }, {});
  anel.system.attuned = true;
  await dispara("updateItem", anel, { system: { attuned: true } }, {});
  await espera(1100);
  const estados = posts.filter((p) => p.op === "item.estado");
  assert.equal(estados.length, 1, "agrupado: um POST");
  const itens = Object.fromEntries(estados[0].items.map((i) => [i.item_id, i]));
  assert.equal(itens.cp1.qty, 2);
  assert.deepEqual(itens.ca1, { item_id: "ca1", equipped: true, attuned: true, attunement: "required" });
});

test("mudança feita pela ponte não volta (anti-eco)", async () => {
  posts.length = 0;
  const item = comCracha("p2", "cp2", { system: { quantity: 1 } });
  await dispara("updateItem", item, { system: { quantity: 5 } }, { companionBridge: true });
  await espera(1000);
  assert.equal(posts.length, 0);
});

test("item apagado aqui sai do Companion, e fica marcado para não ser recriado", async () => {
  posts.length = 0;
  const item = comCracha("p3", "cp3", { type: "consumable", system: { quantity: 1 } });
  ator.items.delete("p3");
  await dispara("deleteItem", item, {});
  assert.ok(crachasApagadosHaPouco(ator.id).has("cp3"));
  await espera(1700);
  assert.deepEqual(posts.filter((p) => p.op === "item.delete"), [{ op: "item.delete", actor_id: "atorA", item_id: "cp3" }]);
});

test("apagado pela ponte, sem crachá, arma natural ou com o personagem inteiro saindo: nada sai", async () => {
  posts.length = 0;
  const pelaPonte = comCracha("d1", "cd1");
  await dispara("deleteItem", pelaPonte, { companionBridge: true });
  const semCracha = new FakeItem("d2", ator, { type: "loot" });
  await dispara("deleteItem", semCracha, {});
  const soco = comCracha("d3", "cd3", { type: "weapon", system: { type: { value: "natural" } } });
  await dispara("deleteItem", soco, {});
  const outro = new FakeActor("atorSumindo");
  game.actors.set(outro.id, outro);
  const doOutro = new FakeItem("d4", outro, { type: "loot", flags: { [MODULE_ID]: { item_id: "cd4" } } });
  await dispara("deleteItem", doOutro, {});
  game.actors.delete(outro.id); // o personagem inteiro foi apagado
  await espera(1700);
  assert.equal(posts.filter((p) => p.op === "item.delete").length, 0, JSON.stringify(posts));
});

test("item novo com crachá ALHEIO (arrastado de outro personagem) perde o crachá e vai como novo", async () => {
  posts.length = 0;
  const outro = new FakeActor("atorB");
  game.actors.set(outro.id, outro);
  new FakeItem("original", outro, { type: "loot", flags: { [MODULE_ID]: { item_id: "de-outro-pc" } } });
  const copia = new FakeItem("n1", ator, { type: "loot", flags: { [MODULE_ID]: { item_id: "de-outro-pc", synced: true, ajuste_aplicado: 2 }, companion: { item_id: "de-outro-pc" } } });
  await dispara("createItem", copia, {});
  const limpeza = copia.updates[0];
  assert.equal(limpeza.options.companionBridge, true);
  assert.ok(`flags.${MODULE_ID}.-=item_id` in limpeza.mudanca && `flags.${MODULE_ID}.-=synced` in limpeza.mudanca);
  const upsert = posts.find((p) => p.op === "item.upsert");
  assert.ok(upsert, "vai como item novo deste actor");
  assert.equal(copia.flags[MODULE_ID].item_id, "novo-cracha", "e ganha o crachá dele");
});

test("o upsert leva a sintonia quando o item tem o campo", async () => {
  posts.length = 0;
  const novo = new FakeItem("n2", ator, { type: "equipment", system: { equipped: true, attunement: "required", attuned: true } });
  await dispara("createItem", novo, {});
  const upsert = posts.find((p) => p.op === "item.upsert");
  assert.equal(upsert.attunement, "required");
  assert.equal(upsert.attuned, true);
});

test("reimportação (o item é recriado com o mesmo crachá): nem exclusão nem item novo", async () => {
  posts.length = 0;
  const velho = comCracha("r1", "cr1", { type: "loot" });
  ator.items.delete("r1");
  await dispara("deleteItem", velho, {});
  const novo = comCracha("r2", "cr1", { type: "loot" });
  await dispara("createItem", novo, {});
  await espera(1700);
  // (O "estado inicial" de 6 s depois de abrir o mundo pode cair aqui; só interessam exclusão e item novo.)
  const relevantes = posts.filter((p) => p.op === "item.delete" || p.op === "item.upsert");
  assert.equal(relevantes.length, 0, JSON.stringify(relevantes));
  assert.equal(novo.flags[MODULE_ID].item_id, "cr1", "o crachá fica: é o mesmo item do Companion");
});

test("ao abrir o mundo, o estado de cada personagem vai uma vez (a sintonia nunca tinha ido)", async () => {
  // registerEquipWatcher agenda para 6 s depois; os casos acima já passaram disso.
  await espera(500);
  const iniciais = posts.filter((p) => p.op === "item.estado");
  assert.ok(iniciais.some((p) => p.actor_id === "atorB"), JSON.stringify(iniciais));
});
