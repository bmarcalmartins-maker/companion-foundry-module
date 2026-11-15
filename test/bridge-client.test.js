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

/** Um ActiveEffect de mentira: os dados, o id e o `toObject` que o efeito enxuto lê. */
function novoEfeito(dados) {
  const ef = structuredClone({ flags: {}, ...dados });
  ef.id = dados._id ?? novoId();
  delete ef._id;
  ef.toObject = () => { const { toObject, id, ...resto } = ef; return { ...structuredClone(resto), _id: id }; };
  return ef;
}

class FakeItem {
  constructor(dados, parent) {
    Object.assign(this, structuredClone({ flags: {}, system: {}, ...dados }));
    this.id = dados._id ?? novoId();
    delete this._id;
    this.parent = parent;
    // Os ActiveEffects do item: uma coleção por id, como no Foundry (v1.26.0).
    this.effects = new Colecao((dados.effects ?? []).map((e) => { const ef = novoEfeito(e); return [ef.id, ef]; }));
  }
  getFlag(scope, chave) { return this.flags?.[scope]?.[chave]; }
  toObject() {
    const { parent, effects, id, ...resto } = this;
    return { ...structuredClone(resto), _id: id };
  }
  async createEmbeddedDocuments(tipo, dados, options) {
    const criados = dados.map(novoEfeito);
    for (const c of criados) this.effects.set(c.id, c);
    this.parent?.ops.push({ op: "efeito.create", item: this.id, tipo, dados, options });
    return criados;
  }
  async deleteEmbeddedDocuments(tipo, ids, options) {
    for (const id of ids) this.effects.delete(id);
    this.parent?.ops.push({ op: "efeito.delete", item: this.id, tipo, ids, options });
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

test("a ficha (actor.read, schema 3) leva as moedas, o inventário físico inteiro e as habilidades", async () => {
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
  assert.equal(r.data.schema, 3);
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
  // v1.15.0: as habilidades (aqui, a magia) e a lista de efeitos (vazia neste ator).
  assert.deepEqual(r.data.habilidades.map((h) => h.name), ["Fire Bolt"]);
  assert.deepEqual(r.data.efeitos, []);
});

test("ITEM NÃO IDENTIFICADO (1.18.0): a versão nova do Companion esconde no lugar; a velha não mexe; o nome guardado não é trocado", async () => {
  const ator = new FakeActor({
    id: "ator9",
    name: "Grimbald",
    items: [
      // o dnd5e já mostra a fachada no nome preparado; o guardado é o verdadeiro
      { _id: "esp", name: "Espada estranha", _source: { name: "Item e1" }, type: "weapon",
        system: { equipped: false, quantity: 1, identified: false, unidentified: { name: "Espada estranha", description: "" } },
        flags: { [MODULE_ID]: { synced: true, item_id: "e1", ajuste_aplicado: 0, identificacao_aplicada: 2 } } },
      { _id: "ane", name: "Item e2", type: "equipment",
        system: { equipped: false, quantity: 1, identified: true, unidentified: { name: "", description: "" } },
        flags: { [MODULE_ID]: { synced: true, item_id: "e2", ajuste_aplicado: 0, identificacao_aplicada: 0 } } },
    ],
  });
  game.actors.set(ator.id, ator);
  const resposta = await comando({
    request_id: "id1",
    action: "actor.update",
    actor_id: "ator9",
    payload: {
      items: [
        // versão 2 já aplicada: o envio velho (identificado) não desfaz
        itemDoEnvio("e1", { system: { identified: true }, flags: { ajuste_total: 0, identificacao: { identificado: true, versao: 2 } } }),
        // versão 1, nova: esconde, com a fachada
        itemDoEnvio("e2", {
          system: { identified: false, unidentified: { name: "Anel opaco", description: "<p>Frio.</p>" } },
          flags: { ajuste_total: 0, identificacao: { identificado: false, versao: 1 } },
        }),
        // item novo (casca, sem compêndio) já nasce escondido e com a versão
        itemDoEnvio("e3", {
          raiz: { type: "consumable" },
          system: { identified: false, unidentified: { name: "Frasco turvo", description: "" } },
          flags: { ajuste_total: 0, identificacao: { identificado: false, versao: 4 }, compendium_hint: null },
        }),
      ],
    },
  });
  assert.equal(resposta.ok, true, JSON.stringify(resposta));
  const esp = ator.items.get("esp");
  assert.equal(esp.system.identified, false, "a versão já aplicada não mexe");
  assert.equal(esp.name, "Espada estranha", "o plano compara com o nome guardado: não renomeia");
  const ane = ator.items.get("ane");
  assert.equal(ane.system.identified, false);
  assert.equal(ane.system.unidentified.name, "Anel opaco");
  assert.equal(ane.system.unidentified.description, "<p>Frio.</p>");
  assert.equal(ane.flags[MODULE_ID].identificacao_aplicada, 1);
  const novo = ator.items.find((i) => i.flags[MODULE_ID]?.item_id === "e3");
  assert.equal(novo.system.identified, false);
  assert.equal(novo.flags[MODULE_ID].identificacao_aplicada, 4);
  // A mudança veio da ponte: o estado que volta não leva a identificação (não é do GM).
  await espera(1200);
  const estado = chamadasInbound.filter((c) => c.corpo.op === "item.estado").flatMap((c) => c.corpo.items);
  assert.ok(estado.every((i) => !("identified" in i)), JSON.stringify(estado));
});

test("SINTONIA (1.26.0): só o pedido NOVO do Companion mexe; o limite do ator barra e avisa o GM; a volta leva o attuned real", async () => {
  const ator = new FakeActor({
    id: "ator10",
    name: "Grimbald",
    items: [
      // casca deste módulo, de antes da 1.26.0: sem "mgc" e sem a exigência
      { _id: "s1", name: "Item s1", type: "equipment", system: { equipped: true, quantity: 1, attuned: false, attunement: "", properties: [] },
        flags: { [MODULE_ID]: { synced: true, item_id: "s1", ajuste_aplicado: 0 } } },
      // nativo sintonizado à mão no Foundry; o Companion nunca pediu nada
      { _id: "s2", name: "Cloak", type: "equipment", system: { equipped: true, quantity: 1, attuned: true, attunement: "required" },
        flags: { [MODULE_ID]: { item_id: "s2", ajuste_aplicado: 0 } } },
      // nativo sintonizado aqui DEPOIS do pedido 2 do Companion (desfazer), que já foi aplicado
      { _id: "s3", name: "Ring", type: "equipment", system: { equipped: true, quantity: 1, attuned: true, attunement: "required" },
        flags: { [MODULE_ID]: { item_id: "s3", ajuste_aplicado: 0, sintonia_aplicada: 2 } } },
    ],
  });
  ator.system = { attributes: { attunement: { max: 3 } } };
  game.actors.set(ator.id, ator);
  chamadasInbound.length = 0;
  const avisos = [];
  const avisoDeAntes = ui.notifications.warn;
  ui.notifications.warn = (t) => avisos.push(t);
  const sintonia = (pedido, versao, exige = "required") => ({ sintonia: { exige, pedido, versao } });
  const envio = () => ({
    items: [
      itemDoEnvio("s1", { system: { equipped: true, attunement: "required", attuned: true, properties: ["mgc"] }, flags: { ajuste_total: 0, ...sintonia(true, 1) } }),
      itemDoEnvio("s2", { system: { equipped: true, attunement: "required" }, flags: { ajuste_total: 0, ...sintonia(null, 0) } }),
      itemDoEnvio("s3", { system: { equipped: true, attunement: "required", attuned: false }, flags: { ajuste_total: 0, ...sintonia(false, 2) } }),
      // novo, casca: pede sintonia, mas s2 + s3 + s1 já enchem o limite de 3
      itemDoEnvio("s4", { system: { equipped: true, attunement: "required", attuned: true, properties: ["mgc"] }, flags: { ajuste_total: 0, compendium_hint: null, ...sintonia(true, 3) } }),
    ],
  });
  const resposta = await comando({ request_id: "st1", action: "actor.update", actor_id: "ator10", payload: envio() });
  assert.equal(resposta.ok, true, JSON.stringify(resposta));

  const s1 = ator.items.get("s1");
  assert.equal(s1.system.attuned, true, "o pedido novo sintoniza");
  assert.equal(s1.flags[MODULE_ID].sintonia_aplicada, 1);
  assert.equal(s1.system.attunement, "required", "na casca, a exigência acompanha o Companion");
  assert.deepEqual(s1.system.properties, ["mgc"], "sem mgc o dnd5e desfaz a sintonia no preparo");
  assert.equal(ator.items.get("s2").system.attuned, true, "sem pedido (versão 0), a sintonia do Foundry não é tocada");
  assert.equal(ator.items.get("s2").flags[MODULE_ID].sintonia_aplicada, undefined);
  assert.equal(ator.items.get("s3").system.attuned, true, "o pedido velho (versão já aplicada) não desfaz o que o GM fez aqui");
  const s4 = ator.items.find((i) => i.flags[MODULE_ID]?.item_id === "s4");
  assert.equal(s4.system.attuned, false, "o limite barrou: nasce sem sintonia");
  assert.equal(s4.flags[MODULE_ID].sintonia_aplicada, 3, "marca a versão mesmo barrado: não tenta de novo");
  assert.deepEqual(avisos, ["Grimbald: limite de 3 itens sintonizados. Item s4 não foi sintonizado."]);
  assert.ok(ator.ops.every((o) => o.options?.companionBridge === true), "toda escrita leva a marca da ponte");

  // a volta: o estado dos itens tocados, com o attuned REAL (o barrado volta false)
  await espera(1200);
  const estado = chamadasInbound.filter((c) => c.corpo.op === "item.estado").flatMap((c) => c.corpo.items);
  assert.equal(estado.find((i) => i.item_id === "s1")?.attuned, true, "o item sintonizado a pedido entra no agendarEstado");
  assert.equal(estado.find((i) => i.item_id === "s4")?.attuned, false);

  // reenviar o mesmo envio: nada é reaplicado e ninguém é avisado de novo
  const opsAntes = ator.ops.length;
  avisos.length = 0;
  await comando({ request_id: "st2", action: "actor.update", actor_id: "ator10", payload: envio() });
  assert.equal(ator.ops.length, opsAntes, "nenhuma escrita no reenvio");
  assert.deepEqual(avisos, []);

  // o jogador desfaz a do s1 (versão 2) e pede de novo a do s4 (versão 4): a vaga liberada no mesmo envio vale
  const outro = envio();
  outro.items[0].flags[MODULE_ID].sintonia = { exige: "required", pedido: false, versao: 2 };
  outro.items[0].system.attuned = false;
  outro.items[3].flags[MODULE_ID].sintonia = { exige: "required", pedido: true, versao: 4 };
  await comando({ request_id: "st3", action: "actor.update", actor_id: "ator10", payload: outro });
  assert.equal(ator.items.get("s1").system.attuned, false);
  assert.equal(s4.system.attuned, true);
  assert.equal(s4.flags[MODULE_ID].sintonia_aplicada, 4);
  assert.deepEqual(avisos, []);
  ui.notifications.warn = avisoDeAntes;
});

test("SINTONIA (1.26.0): no item novo resolvido pelo compêndio, o pedido do Companion vale; sem pedido, fica o do compêndio", async () => {
  const ator = new FakeActor({ id: "ator11", name: "Guldrum", items: [] });
  game.actors.set(ator.id, ator);
  const doEspelho = (cracha, sintonia, attuned) =>
    itemDoEnvio(cracha, {
      raiz: { name: "Amuleto da Saúde" },
      system: { equipped: true, attunement: "required", ...(attuned === undefined ? {} : { attuned }) },
      flags: { ajuste_total: 0, compendium_hint: { source_key: null, name: "Amuleto da Saúde", uuid: uuidDoEspelho }, sintonia },
    });
  await comando({
    request_id: "sc1",
    action: "actor.update",
    actor_id: "ator11",
    payload: { items: [doEspelho("k1", { exige: "required", pedido: true, versao: 5 }, true), doEspelho("k2", { exige: "required", pedido: null, versao: 0 })] },
  });
  const k1 = ator.items.find((i) => i.flags[MODULE_ID]?.item_id === "k1");
  assert.equal(k1.flags[MODULE_ID].compendio, true);
  assert.equal(k1.system.attuned, true, "o pedido vale no item do compêndio");
  assert.equal(k1.flags[MODULE_ID].sintonia_aplicada, 5);
  const k2 = ator.items.find((i) => i.flags[MODULE_ID]?.item_id === "k2");
  assert.equal(k2.system.attuned, false, "sem pedido: o que o compêndio tem");
  assert.equal(k2.flags[MODULE_ID].sintonia_aplicada, 0);
});

test("EFEITOS DO MESTRE (1.26.0): o item com flags.efeitos não passa pelo compêndio; versão nova troca os efeitos no lugar", async () => {
  const doCompanion = (nome, valor) => ({
    name: nome, type: "base", disabled: false, transfer: true,
    system: { changes: [{ key: "system.attributes.ac.bonus", type: "add", value: String(valor), phase: "initial", priority: null }] },
    flags: { [MODULE_ID]: { do_companion: true } },
  });
  const ator = new FakeActor({
    id: "ator12",
    name: "Talaniel",
    items: [
      // casca que já recebeu efeitos do Companion (versão 1): um marcado e um que perdeu a marca
      { _id: "h1", name: "Item h1", type: "equipment", system: { equipped: true, quantity: 1, attuned: false, attunement: "", rarity: "", properties: ["foc"] },
        flags: { [MODULE_ID]: { synced: true, item_id: "h1", ajuste_aplicado: 0, efeitos_aplicada: 1 } },
        effects: [{ _id: "e1", ...doCompanion("Velho", 1) }, { _id: "e2", name: "Sem marca", transfer: true, system: { changes: [] } }, { _id: "e3", name: "Não transfere", transfer: false, system: { changes: [] } }] },
      // nativo do Foundry com um efeito dele: os do Mestre entram ao lado
      { _id: "h3", name: "Shield", type: "equipment", system: { equipped: true, quantity: 1, attuned: false, attunement: "", rarity: "", properties: [] },
        flags: { [MODULE_ID]: { item_id: "h3", ajuste_aplicado: 0 } },
        effects: [{ _id: "e9", name: "Do Foundry", transfer: true, system: { changes: [] } }] },
    ],
  });
  game.actors.set(ator.id, ator);
  chamadasInbound.length = 0;
  const comEfeitos = (cracha, versao, efeitos, extra = {}) =>
    itemDoEnvio(cracha, {
      raiz: { effects: efeitos },
      system: { equipped: true, attunement: "required", rarity: "rare", properties: ["mgc"] },
      // a dica aponta para um item que EXISTE no compêndio: mesmo assim não é usada
      flags: { ajuste_total: 0, compendium_hint: { source_key: null, name: "Amulet of Health", uuid: uuidDoEspelho }, efeitos: { versao }, ...extra },
    });
  const envio = (versao) => ({
    items: [
      comEfeitos("h1", versao, [doCompanion("CA +2", 2)]),
      comEfeitos("h2", versao, [doCompanion("CA +1", 1)]),
      comEfeitos("h3", versao, [doCompanion("CA +3", 3)]),
    ],
  });
  let r = await comando({ request_id: "ef1", action: "actor.update", actor_id: "ator12", payload: envio(2) });
  assert.equal(r.ok, true, JSON.stringify(r));

  // h2, novo: a casca inteira (nome e efeitos do Mestre), sem a marca do compêndio
  const h2 = ator.items.find((i) => i.flags[MODULE_ID]?.item_id === "h2");
  assert.equal(h2.name, "Item h2");
  assert.equal(h2.flags[MODULE_ID].compendio, undefined, "com flags.efeitos o compêndio é pulado");
  assert.deepEqual(h2.effects.map((e) => e.name), ["CA +1"]);
  assert.equal(h2.flags[MODULE_ID].efeitos_aplicada, 2);
  assert.equal(h2.system.attunement, "required");

  // h1, casca que já existia: saem o marcado e o de transferência sem marca; o que não transfere fica
  const h1 = ator.items.get("h1");
  assert.deepEqual(h1.effects.map((e) => e.name).sort(), ["CA +2", "Não transfere"]);
  assert.equal(h1.effects.find((e) => e.name === "CA +2").flags[MODULE_ID].do_companion, true);
  assert.equal(h1.flags[MODULE_ID].efeitos_aplicada, 2);
  assert.equal(h1.system.attunement, "required");
  assert.equal(h1.system.rarity, "rare");
  assert.deepEqual(h1.system.properties, ["foc", "mgc"], "só acrescenta mgc");
  const apagou = ator.ops.find((o) => o.op === "efeito.delete" && o.item === "h1");
  assert.deepEqual([apagou.tipo, apagou.ids.sort(), apagou.options], ["ActiveEffect", ["e1", "e2"], { companionBridge: true }]);
  const criou = ator.ops.find((o) => o.op === "efeito.create" && o.item === "h1");
  assert.deepEqual([criou.tipo, criou.options], ["ActiveEffect", { companionBridge: true }]);

  // h3, nativo: o efeito do Foundry fica; o do Mestre entra
  const h3 = ator.items.get("h3");
  assert.deepEqual(h3.effects.map((e) => e.name).sort(), ["CA +3", "Do Foundry"]);
  assert.ok(!ator.ops.some((o) => o.op === "efeito.delete" && o.item === "h3"));

  // os efeitos trocados voltam ao Companion (item.effects) e o item entra no estado
  await espera(1200);
  const efeitos = chamadasInbound.filter((c) => c.corpo.op === "item.effects").flatMap((c) => c.corpo.items);
  assert.deepEqual(efeitos.find((i) => i.item_id === "h1")?.effects.map((e) => e.name).sort(), ["CA +2", "Não transfere"]);
  assert.ok(efeitos.some((i) => i.item_id === "h2"), "o criado com efeito também volta");
  const estado = chamadasInbound.filter((c) => c.corpo.op === "item.estado").flatMap((c) => c.corpo.items);
  assert.equal(estado.find((i) => i.item_id === "h1")?.attunement, "required");

  // a mesma versão de novo: nenhum efeito é mexido
  const antes = ator.ops.filter((o) => o.op.startsWith("efeito.")).length;
  r = await comando({ request_id: "ef2", action: "actor.update", actor_id: "ator12", payload: envio(2) });
  assert.equal(ator.ops.filter((o) => o.op.startsWith("efeito.")).length, antes);

  // versão 3: troca de novo, e no nativo só sai o que é do Companion
  const novo = envio(3);
  novo.items[2].effects = [];
  await comando({ request_id: "ef3", action: "actor.update", actor_id: "ator12", payload: novo });
  assert.deepEqual(h3.effects.map((e) => e.name), ["Do Foundry"], "lista vazia: os bônus do Mestre saem, o do Foundry fica");
  assert.equal(h3.flags[MODULE_ID].efeitos_aplicada, 3);
});

test("O +N MÁGICO (1.26.0): system.magicalBonus entra com a versão dos efeitos e volta a nulo na casca; sintonia sem pedido não escreve nada", async () => {
  const ator = new FakeActor({
    id: "ator14",
    name: "Grimbald",
    items: [
      { _id: "b1", name: "Item b1", type: "weapon", system: { equipped: true, quantity: 1, attuned: false, attunement: "", rarity: "", properties: [], magicalBonus: null },
        flags: { [MODULE_ID]: { synced: true, item_id: "b1", ajuste_aplicado: 0 } } },
      // item do compêndio que exige sintonia, sintonizado à mão: o envio traz system.attunement e a sintonia sem pedido
      { _id: "b2", name: "Item b2", type: "equipment", system: { equipped: true, quantity: 1, attuned: true, attunement: "optional", properties: [] },
        flags: { [MODULE_ID]: { synced: true, item_id: "b2", ajuste_aplicado: 0, compendio: true } } },
    ],
  });
  game.actors.set(ator.id, ator);
  const semPedido = (exige) => ({ sintonia: { exige, pedido: null, versao: 0 } });
  const envio = (versao, bonus) => ({
    items: [
      itemDoEnvio("b1", { raiz: { type: "weapon", effects: [] }, system: { equipped: true, properties: ["mgc"], ...(bonus ? { magicalBonus: bonus } : {}) }, flags: { ajuste_total: 0, efeitos: { versao }, ...semPedido("") } }),
      itemDoEnvio("b2", { system: { equipped: true, attunement: "required", properties: ["mgc"] }, flags: { ajuste_total: 0, ...semPedido("required") } }),
    ],
  });
  await comando({ request_id: "mb1", action: "actor.update", actor_id: "ator14", payload: envio(1, 2) });
  const b1 = ator.items.get("b1");
  assert.equal(b1.system.magicalBonus, 2);
  assert.deepEqual(b1.system.properties, ["mgc"]);
  assert.equal(b1.flags[MODULE_ID].efeitos_aplicada, 1);
  assert.equal(b1.system.attuned, false);
  assert.equal(b1.flags[MODULE_ID].sintonia_aplicada, undefined, "sintonia sem pedido não marca nada");
  const b2 = ator.items.get("b2");
  assert.deepEqual([b2.system.attunement, b2.system.attuned, b2.system.properties], ["optional", true, []], "sem pedido e sem flags.efeitos, nada do item muda");
  const mudancas = ator.ops.filter((o) => o.op === "update").flatMap((o) => o.mudancas);
  assert.ok(!mudancas.some((m) => m._id === "b2"), "nenhuma atualização no b2");
  // a mesma versão com outro +N: não mexe; versão nova sem o campo: volta a nulo
  await comando({ request_id: "mb2", action: "actor.update", actor_id: "ator14", payload: envio(1, 3) });
  assert.equal(b1.system.magicalBonus, 2);
  await comando({ request_id: "mb3", action: "actor.update", actor_id: "ator14", payload: envio(2, 0) });
  assert.equal(b1.system.magicalBonus, null);
  assert.equal(b1.flags[MODULE_ID].efeitos_aplicada, 2);
});

test("EFEITOS DO MESTRE (1.26.0): se a troca falha, a versão não é marcada e o próximo envio tenta de novo", async () => {
  const ator = new FakeActor({
    id: "ator13",
    name: "Guldrum",
    items: [{ _id: "q1", name: "Item q1", type: "equipment", system: { equipped: false, quantity: 1, attuned: false, attunement: "", rarity: "", properties: [] },
      flags: { [MODULE_ID]: { synced: true, item_id: "q1", ajuste_aplicado: 0 } } }],
  });
  game.actors.set(ator.id, ator);
  const item = ator.items.get("q1");
  const criar = item.createEmbeddedDocuments.bind(item);
  item.createEmbeddedDocuments = async () => { throw new Error("o Foundry recusou"); };
  const erroDeAntes = console.error;
  console.error = () => {};
  const payload = () => ({ items: [itemDoEnvio("q1", { raiz: { effects: [{ name: "CA +1", transfer: true, system: { changes: [] }, flags: { [MODULE_ID]: { do_companion: true } } }] }, system: { rarity: "rare" }, flags: { ajuste_total: 0, compendium_hint: null, efeitos: { versao: 1 } } })] });
  let r = await comando({ request_id: "fx1", action: "actor.update", actor_id: "ator13", payload: payload() });
  console.error = erroDeAntes;
  assert.equal(r.ok, true, "a falha de um item não derruba o envio");
  assert.equal(item.flags[MODULE_ID].efeitos_aplicada, undefined);
  item.createEmbeddedDocuments = criar;
  r = await comando({ request_id: "fx2", action: "actor.update", actor_id: "ator13", payload: payload() });
  assert.deepEqual(item.effects.map((e) => e.name), ["CA +1"]);
  assert.equal(item.flags[MODULE_ID].efeitos_aplicada, 1);
});

test("fim: desconecta (sem timers pendurados)", () => {
  cliente.disconnect();
});
