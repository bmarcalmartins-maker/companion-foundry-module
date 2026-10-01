/**
 * O caminho de um envio do Companion DENTRO do módulo, de ponta a ponta, com
 * um Foundry de mentira: a mensagem chega pelo WebSocket, vira plano
 * (plano-inventario.js) e operações no ator, e o estado volta à
 * foundry-inbound. O que se confere aqui é a COLA — a fila por actor, a
 * tradução do plano em documentos do Foundry, as flags do envio e a volta.
 * As regras do plano têm o teste delas (plano-inventario.test.js).
 *
 * O Foundry falso só tem o que o módulo usa: game, ui, Hooks, foundry.utils,
 * Actor, Item e WebSocket. Não prova que o Foundry de verdade responde igual —
 * isso é o roteiro com o Foundry aberto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const MODULE_ID = "companion-foundry-bridge";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let proximoId = 0;
const novoId = () => `f${String(++proximoId).padStart(15, "0")}`;

/* ── foundry.utils (só o que o módulo usa) ── */
const ehObjeto = (v) => v && typeof v === "object" && !Array.isArray(v);
function mergeObject(original, other) {
  const saida = structuredClone(original ?? {});
  for (const [k, v] of Object.entries(other ?? {})) {
    saida[k] = ehObjeto(v) && ehObjeto(saida[k]) ? mergeObject(saida[k], v) : structuredClone(v);
  }
  return saida;
}
function setProperty(obj, caminho, valor) {
  const partes = caminho.split(".");
  let alvo = obj;
  for (const p of partes.slice(0, -1)) alvo = alvo[p] ??= {};
  alvo[partes.at(-1)] = valor;
}
/** Mudança do Foundry com chaves pontuadas e "-=chave" para apagar. */
function aplicar(doc, mudanca) {
  for (const [chave, valor] of Object.entries(mudanca)) {
    if (chave === "_id") continue;
    const partes = chave.split(".");
    const ultima = partes.at(-1);
    let alvo = doc;
    for (const p of partes.slice(0, -1)) alvo = alvo[p] ??= {};
    if (ultima.startsWith("-=")) delete alvo[ultima.slice(2)];
    else alvo[ultima] = valor;
  }
}

class Colecao extends Map {
  filter(fn) { return [...this.values()].filter(fn); }
  find(fn) { return [...this.values()].find(fn); }
  map(fn) { return [...this.values()].map(fn); }
  some(fn) { return [...this.values()].some(fn); }
  [Symbol.iterator]() { return this.values(); }
}

class FakeItem {
  constructor(dados, parent) {
    Object.assign(this, structuredClone({ flags: {}, system: {}, ...dados }));
    this.id = dados._id ?? novoId();
    delete this._id;
    this.parent = parent;
    this.effects = new Map();
  }
  getFlag(scope, chave) { return this.flags?.[scope]?.[chave]; }
  toObject() {
    const { parent, effects, id, ...resto } = this;
    return { ...structuredClone(resto), _id: id };
  }
  async update(mudanca, options) {
    aplicar(this, mudanca);
    this.parent?.ops.push({ op: "item.update", id: this.id, mudanca, options });
    return this;
  }
}

class FakeActor {
  constructor({ id, name, type = "character", items = [] }) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.flags = {};
    this.system = {};
    this.ops = [];
    this.lento = 0;
    this.items = new Colecao(items.map((d) => { const i = new FakeItem(d, this); return [i.id, i]; }));
  }
  getFlag(scope, chave) { return this.flags?.[scope]?.[chave]; }
  async update(dados, options) { aplicar(this, dados); this.ops.push({ op: "actor.update", dados, options, t: Date.now() }); }
  async createEmbeddedDocuments(_tipo, dados, options) {
    if (this.lento) await espera(this.lento);
    const criados = dados.map((d) => new FakeItem(d, this));
    for (const c of criados) this.items.set(c.id, c);
    this.ops.push({ op: "create", dados, options, t: Date.now() });
    return criados;
  }
  async updateEmbeddedDocuments(_tipo, mudancas, options) {
    if (this.lento) await espera(this.lento);
    const feitos = [];
    for (const m of mudancas) {
      const item = this.items.get(m._id);
      if (!item) continue;
      aplicar(item, m);
      feitos.push(item);
    }
    this.ops.push({ op: "update", mudancas, options, t: Date.now() });
    return feitos;
  }
  async deleteEmbeddedDocuments(_tipo, ids, options) {
    if (this.lento) await espera(this.lento);
    for (const id of ids) this.items.delete(id);
    this.ops.push({ op: "delete", ids, options, t: Date.now() });
  }
}

class FakeWS {
  static OPEN = 1;
  static ultimo = null;
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.ouvintes = {};
    this.enviados = [];
    FakeWS.ultimo = this;
  }
  addEventListener(tipo, fn) { (this.ouvintes[tipo] ??= []).push(fn); }
  send(s) { if (s !== "ping") this.enviados.push(JSON.parse(s)); }
  close() {}
  emitir(tipo, ev = {}) { for (const fn of this.ouvintes[tipo] ?? []) fn(ev); }
}

/* ── o mundo ── */
const uuidDoEspelho = "Compendium.world.ddb-items.Item.AAAAAAAAAAAAAAAA";
const itemDoCompendio = new FakeItem({ _id: "AAAAAAAAAAAAAAAA", name: "Amulet of Health", type: "equipment", img: "ddb/amulet.webp", system: { equipped: false, quantity: 1, attunement: "required", attuned: false } }, null);
const chamadasInbound = [];
globalThis.foundry = {
  applications: { api: { ApplicationV2: class {} } },
  utils: {
    deepClone: (o) => structuredClone(o),
    mergeObject,
    setProperty,
    fromUuid: async (uuid) => (uuid === uuidDoEspelho ? itemDoCompendio : null),
  },
};
globalThis.Item = FakeItem;
globalThis.Actor = FakeActor;
globalThis.WebSocket = FakeWS;
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {} };
globalThis.game = {
  settings: {
    get: (_m, chave) => ({ bridgeUrl: "wss://ponte/ws", apiKeyLocal: "k", inboundUrl: "https://inbound/foundry-inbound", inboundKeyLocal: "ik", autoConnect: false })[chave],
  },
  i18n: { localize: (s) => s, format: (s) => s },
  actors: new Colecao(),
  users: { activeGM: { id: "gm" } },
  user: { id: "gm", isGM: true },
  packs: [],
  system: { version: "5.3.3" },
  version: "14",
};
let versaoDaCarteira = 0;
globalThis.fetch = async (url, init) => {
  const corpo = JSON.parse(init.body);
  chamadasInbound.push({ url, corpo, chave: init.headers["x-foundry-inbound-key"] });
  // actor.moedas: a edge grava a carteira e devolve a versão nova.
  if (corpo.op === "actor.moedas") return new Response(JSON.stringify({ ok: true, versao: ++versaoDaCarteira }), { status: 200 });
  return new Response(JSON.stringify({ ok: true, gravados: corpo.items?.length ?? 0, fora: [] }), { status: 200 });
};
// Os avisos de "não consegui ler a ficha" do live-sync (o ator falso não tem ficha) não interessam aqui.
console.warn = () => {};
console.log = () => {};

const { BridgeClient } = await import("../scripts/bridge-client.js");
const cliente = new BridgeClient();
cliente.connect();
const ws = FakeWS.ultimo;
ws.emitir("open");

async function comando(msg) {
  ws.emitir("message", { data: JSON.stringify(msg) });
  for (let i = 0; i < 200; i++) {
    const resposta = ws.enviados.find((r) => r.request_id === msg.request_id);
    if (resposta) return resposta;
    await espera(10);
  }
  throw new Error(`sem resposta para ${msg.request_id}`);
}
const itemDoEnvio = (cracha, extra = {}) => ({
  name: `Item ${cracha}`,
  type: "equipment",
  system: { quantity: 1, equipped: false, ...(extra.system ?? {}) },
  flags: { [MODULE_ID]: { item_id: cracha, compendium_hint: { source_key: null, name: `Item ${cracha}`, uuid: null }, ...(extra.flags ?? {}) } },
  ...(extra.raiz ?? {}),
});

test("o inventário é reconciliado NO LUGAR: nada de apagar e recriar o que o ator já tem", async () => {
  const ator = new FakeActor({
    id: "ator1",
    name: "Grimbald",
    items: [
      // cópia deste módulo, sintonizada à mão no Foundry
      { _id: "copia1", name: "Item c1", type: "equipment", system: { equipped: false, quantity: 1, attuned: true }, flags: { [MODULE_ID]: { synced: true, item_id: "c1", ajuste_aplicado: 0 } } },
      // nativo com crachá: poções, 5 no Foundry
      { _id: "nativo2", name: "Potion", type: "consumable", system: { quantity: 5 }, flags: { [MODULE_ID]: { item_id: "c2", ajuste_aplicado: 0 } } },
      // cópia que o Companion não manda mais
      { _id: "copia4", name: "Item c4", type: "equipment", system: { quantity: 1 }, flags: { [MODULE_ID]: { synced: true, item_id: "c4" } } },
      // nativo que SAIU do personagem no Companion (descartado)
      { _id: "nativo5", name: "Rope", type: "loot", system: { quantity: 1 }, flags: { [MODULE_ID]: { item_id: "c5" } } },
      // nativo com crachá velho, fora do envio e sem saída: fica
      { _id: "nativo6", name: "Old", type: "loot", system: { quantity: 1 }, flags: { [MODULE_ID]: { item_id: "c6" } } },
      // arma natural com crachá e saída: nunca sai
      { _id: "soco", name: "Unarmed Strike", type: "weapon", system: { type: { value: "natural" }, equipped: false }, flags: { [MODULE_ID]: { item_id: "c7" } } },
    ],
  });
  game.actors.set(ator.id, ator);
  chamadasInbound.length = 0;

  const resposta = await comando({
    request_id: "r1",
    action: "actor.update",
    actor_id: "ator1",
    payload: {
      items: [
        itemDoEnvio("c1", { system: { equipped: true, quantity: 9 }, flags: { ajuste_total: 0 } }),
        itemDoEnvio("c2", { raiz: { type: "consumable" }, system: { quantity: 2 }, flags: { ajuste_total: 3 } }),
        itemDoEnvio("c3", { system: { quantity: 4 }, flags: { ajuste_total: 1 } }),
      ],
      flags: { [MODULE_ID]: { saidas: ["c5", "c7"] } },
    },
  });
  assert.equal(resposta.ok, true, JSON.stringify(resposta));

  const ops = ator.ops.map((o) => o.op);
  assert.ok(!ops.includes("actor.update"), "as saídas não viram flag do ator");
  const apagados = ator.ops.find((o) => o.op === "delete")?.ids ?? [];
  assert.deepEqual(apagados.sort(), ["copia4", "nativo5"]);
  assert.ok(ator.items.get("copia1"), "a cópia sintonizada não é recriada");
  assert.equal(ator.items.get("copia1").system.equipped, true);
  assert.equal(ator.items.get("copia1").system.attuned, true, "a sintonia do Foundry fica");
  assert.equal(ator.items.get("copia1").system.quantity, 1, "a quantidade do Companion não é imposta");
  assert.equal(ator.items.get("nativo2").system.quantity, 8, "5 no Foundry + 3 que o Companion somou");
  assert.equal(ator.items.get("nativo2").flags[MODULE_ID].ajuste_aplicado, 3);
  assert.ok(ator.items.get("nativo6"), "crachá velho sem saída não apaga nada");
  assert.ok(ator.items.get("soco"), "arma natural nunca sai");
  const novo = ator.items.find((i) => i.flags[MODULE_ID]?.item_id === "c3");
  assert.ok(novo, "o item novo é criado");
  assert.equal(novo.system.quantity, 4);
  assert.equal(novo.flags[MODULE_ID].synced, true);
  assert.equal(novo.flags[MODULE_ID].ajuste_aplicado, 1, "o novo marca o ajuste que já está na quantidade dele");
  assert.ok(ator.ops.every((o) => o.op === "actor.update" || o.options?.companionBridge === true), "toda operação leva a marca da ponte (anti-eco)");

  // A quantidade que o Foundry ficou volta ao Companion, agrupada.
  await espera(1200);
  const estado = chamadasInbound.find((c) => c.corpo.op === "item.estado");
  assert.ok(estado, "o estado volta à foundry-inbound");
  assert.equal(estado.chave, "ik");
  const doC2 = estado.corpo.items.find((i) => i.item_id === "c2");
  assert.equal(doC2.qty, 8);
  const doC1 = estado.corpo.items.find((i) => i.item_id === "c1");
  assert.equal(doC1.attuned, true);
});

test("um actor.update por actor de cada vez (FVT-07)", async () => {
  const ator = new FakeActor({ id: "ator2", name: "Talaniel", items: [] });
  ator.lento = 60;
  game.actors.set(ator.id, ator);
  const a = comando({ request_id: "q1", action: "actor.update", actor_id: "ator2", payload: { items: [itemDoEnvio("x1")] } });
  const b = comando({ request_id: "q2", action: "actor.update", actor_id: "ator2", payload: { items: [itemDoEnvio("x1"), itemDoEnvio("x2")] } });
  await Promise.all([a, b]);
  const criacoes = ator.ops.filter((o) => o.op === "create");
  assert.equal(criacoes.length, 2);
  assert.deepEqual(criacoes[0].dados.map((d) => d.flags[MODULE_ID].item_id), ["x1"]);
  // O segundo viu o que o primeiro criou: só cria o que falta.
  assert.deepEqual(criacoes[1].dados.map((d) => d.flags[MODULE_ID].item_id), ["x2"]);
  assert.equal(ator.items.size, 2, "sem duplicata");
});

test("o item do espelho é resolvido pelo uuid do compêndio (FVT-15)", async () => {
  const ator = new FakeActor({ id: "ator3", name: "Guldrum", items: [] });
  game.actors.set(ator.id, ator);
  await comando({
    request_id: "u1",
    action: "actor.update",
    actor_id: "ator3",
    payload: {
      items: [
        itemDoEnvio("m1", {
          raiz: { name: "Amuleto da Saúde" },
          system: { equipped: true, quantity: 1 },
          flags: { ajuste_total: 0, compendium_hint: { source_key: null, name: "Amuleto da Saúde", uuid: uuidDoEspelho } },
        }),
      ],
    },
  });
  const criado = ator.items.find((i) => i.flags[MODULE_ID]?.item_id === "m1");
  assert.ok(criado);
  assert.equal(criado.name, "Amuleto da Saúde", "o nome do Companion vale");
  assert.equal(criado.system.attunement, "required", "o resto vem do item do compêndio");
  assert.equal(criado.system.equipped, true);
  assert.equal(criado.flags[MODULE_ID].compendio, true);
});

test("moedas (v1.9.0): primeiro contato e Foundry que mudou vencem; envio novo aplica; envio velho não", async () => {
  const ator = new FakeActor({ id: "ator4", name: "Talaniel", items: [] });
  ator.system = { currency: { pp: 0, gp: 10, ep: 0, sp: 0, cp: 0 } };
  game.actors.set(ator.id, ator);
  const moedasDoEnvio = (gp, versao) => ({ flags: { [MODULE_ID]: { moedas: { pp: 1, gp, ep: 0, sp: 2, cp: 3, versao } } } });
  const enviosDeMoedas = () => chamadasInbound.filter((c) => c.corpo.op === "actor.moedas" && c.corpo.actor_id === "ator4");
  chamadasInbound.length = 0;

  // 1) Primeiro contato (sem moedas_sync): o Foundry vence e manda as dele.
  let r = await comando({ request_id: "m1", action: "actor.update", actor_id: "ator4", payload: moedasDoEnvio(50, 3) });
  assert.equal(r.ok, true);
  assert.equal(r.data?.moedas, "foundry_vence");
  assert.equal(ator.system.currency.gp, 10, "nada daqui é sobrescrito");
  await espera(1200);
  assert.equal(enviosDeMoedas().length, 1);
  assert.deepEqual(enviosDeMoedas()[0].corpo.moedas, { pp: 0, gp: 10, ep: 0, sp: 0, cp: 0 });
  const acordo = ator.flags[MODULE_ID]?.moedas_sync;
  assert.equal(acordo?.gp, 10);
  assert.equal(acordo?.versao, versaoDaCarteira, "a versão que a edge devolveu fica no ator");
  assert.ok(!ator.ops.some((o) => o.op === "actor.update" && "flags" in o.dados), "as moedas do envio não viram flag cru do ator");

  // 2) Envio novo, Foundry sem mudança: aplica as cinco moedas.
  r = await comando({ request_id: "m2", action: "actor.update", actor_id: "ator4", payload: moedasDoEnvio(60, versaoDaCarteira + 1) });
  assert.equal(r.data?.moedas, "aplicar");
  assert.deepEqual(ator.system.currency, { pp: 1, gp: 60, ep: 0, sp: 2, cp: 3 });
  assert.equal(ator.flags[MODULE_ID].moedas_sync.versao, versaoDaCarteira + 1);
  const aplicacao = ator.ops.filter((o) => o.op === "actor.update").at(-1);
  assert.equal(aplicacao.options?.companionBridge, true, "a aplicação leva a marca da ponte (anti-eco)");

  // 3) Envio velho (versão já vista): ignora.
  r = await comando({ request_id: "m3", action: "actor.update", actor_id: "ator4", payload: moedasDoEnvio(999, versaoDaCarteira) });
  assert.equal(r.data?.moedas, "antigo");
  assert.equal(ator.system.currency.gp, 60);

  // 4) O Foundry mudou depois do acordo (e a volta ainda não chegou): o Foundry vence.
  ator.system.currency.gp = 61;
  const antes = enviosDeMoedas().length;
  r = await comando({ request_id: "m4", action: "actor.update", actor_id: "ator4", payload: moedasDoEnvio(70, versaoDaCarteira + 10) });
  assert.equal(r.data?.moedas, "foundry_vence");
  assert.equal(ator.system.currency.gp, 61);
  await espera(1200);
  assert.equal(enviosDeMoedas().length, antes + 1);
  assert.equal(enviosDeMoedas().at(-1).corpo.moedas.gp, 61);

  // 5) Envio sem moedas (o Companion antigo): nada muda, a resposta não traz a chave.
  r = await comando({ request_id: "m5", action: "actor.update", actor_id: "ator4", payload: {} });
  assert.equal(r.ok, true);
  assert.equal(r.data, undefined);
});

test("a ficha (actor.read, schema 2) leva as moedas e o inventário físico inteiro", async () => {
  const ator = new FakeActor({
    id: "ator5",
    name: "Guldrum",
    items: [
      { _id: "i1", name: "Rope", type: "loot", system: { quantity: 2 }, flags: { [MODULE_ID]: { item_id: "c1" } } },
      { _id: "i2", name: "Amulet", type: "equipment", system: { quantity: 1, equipped: true, attunement: "required", attuned: true } },
      { _id: "i3", name: "Fire Bolt", type: "spell", system: {} },
      { _id: "i4", name: "Unarmed Strike", type: "weapon", system: { type: { value: "natural" }, equipped: true } },
    ],
  });
  ator.system = { currency: { pp: 0, gp: 7, ep: 1, sp: 0, cp: 9 } };
  game.actors.set(ator.id, ator);
  const r = await comando({ request_id: "l1", action: "actor.read", actor_id: "ator5" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.schema, 2);
  assert.deepEqual(r.data.moedas, { pp: 0, gp: 7, ep: 1, sp: 0, cp: 9 });
  const nomes = r.data.inventario.map((i) => i.name).sort();
  assert.deepEqual(nomes, ["Amulet", "Rope"], "magia e arma natural não são inventário");
  const corda = r.data.inventario.find((i) => i.name === "Rope");
  assert.equal(corda.companion_item_id, "c1");
  assert.equal(corda.qty, 2);
  assert.equal(corda.equipped, undefined, "loot não tem o campo equipado");
  const amuleto = r.data.inventario.find((i) => i.name === "Amulet");
  assert.equal(amuleto.companion_item_id, null);
  assert.equal(amuleto.equipped, true);
  assert.equal(amuleto.attuned, true);
  assert.equal(amuleto.attunement, "required");
});

test("fim: desconecta (sem timers pendurados)", () => {
  cliente.disconnect();
});
