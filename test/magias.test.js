/**
 * A magia falada (magias.js, v1.12.0 e v1.13.0), sem Foundry: as magias e as
 * ações do snapshot, o dono do ator, o pedido no GM (responde na hora, o
 * resultado vem depois), o atalho (vários itens em ordem) e a pergunta no
 * jogador (NUNCA usa nada sem o "Lançar"/"Usar").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ESPERA_DO_JOGADOR_MS,
  MAX_ITENS_DO_ATALHO,
  QUERY_LANCAR_MAGIA,
  acoesDoAtor,
  donoDoAtor,
  eLancar,
  itensDoPedido,
  lancarMagiaNoJogador,
  magiasDoAtor,
  pedirMagiaAoJogador,
  textoDaPergunta,
} from "../scripts/magias.js";

const moduleJson = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));

function itens(lista) {
  const m = new Map(lista.map((i) => [i.id, i]));
  return Object.assign([...lista], { get: (id) => m.get(id) });
}
const magia = (id, name, extra = {}) => ({ id, uuid: `Actor.a1.Item.${id}`, name, type: "spell", system: { level: 1, method: "spell", prepared: 1 }, ...extra });
// system.activities é uma Collection (um Map) no dnd5e 5.x
const comAtividade = (n = 1) => ({ activities: new Map(Array.from({ length: n }, (_, k) => [`a${k}`, {}])) });
const acao = (id, name, type, extra = {}) => ({ id, uuid: `Actor.a1.Item.${id}`, name, type, system: comAtividade(), ...extra });

test("o nome da pergunta tem o prefixo do módulo (o Foundry exige)", () => {
  assert.ok(QUERY_LANCAR_MAGIA.startsWith(`${moduleJson.id}.`), QUERY_LANCAR_MAGIA);
});

test("magiasDoAtor: só as magias, com nível, método e preparação; nada é filtrado", () => {
  const r = magiasDoAtor([
    magia("s1", "Magic Missile"),
    { id: "w1", name: "Espada", type: "weapon", system: {} },
    magia("s2", "Fire Bolt", { system: { level: 0, method: "spell", prepared: 0 } }),
    magia("s3", "Hex", { system: { level: 1, method: "pact", prepared: 0 } }),
  ]);
  assert.deepEqual(r.map((m) => m.id), ["s1", "s2", "s3"]);
  assert.deepEqual(r[1], { id: "s2", uuid: "Actor.a1.Item.s2", name: "Fire Bolt", nivel: 0, metodo: "spell", preparada: 0 });
  assert.equal(r[2].metodo, "pact");
  assert.deepEqual(magiasDoAtor(undefined), []);
});

const usuario = (id, { isGM = false, active = true, character = null, dono = true } = {}) => ({
  id, name: id, isGM, active, character, dono,
  chamadas: [],
  query(nome, dados, opcoes) {
    this.chamadas.push({ nome, dados, opcoes });
    return this.resposta ?? Promise.resolve({ ok: true, lancou: true });
  },
});
const ator = (id, lista = [magia("s1", "Magic Missile")]) => ({ id, items: itens(lista), testUserPermission: (u, nivel) => nivel === "OWNER" && u.dono });

test("donoDoAtor: não GM, conectado e dono; quem tem o ator como personagem vence", () => {
  const a = ator("a1");
  const gm = usuario("gm", { isGM: true });
  const fora = usuario("fora", { active: false, character: { id: "a1" } });
  const outro = usuario("outro");
  const dele = usuario("dele", { character: { id: "a1" } });
  assert.equal(donoDoAtor(a, [gm, fora, outro, dele]).id, "dele");
  assert.equal(donoDoAtor(a, [gm, fora, outro]).id, "outro");
  assert.equal(donoDoAtor(a, [gm, fora]), null, "só o GM e um desconectado: ninguém");
  assert.equal(donoDoAtor(a, [usuario("x", { dono: false })]), null, "conectado mas sem ser dono: ninguém");
});

test("pedirMagiaAoJogador: responde NA HORA e o resultado vem depois, pelo reportar", async () => {
  const a = ator("a1");
  let resolver;
  const jogador = usuario("ana", { character: { id: "a1" } });
  jogador.resposta = new Promise((r) => (resolver = r));
  const relatos = [];
  const game = { actors: { get: (id) => (id === "a1" ? a : undefined) }, users: [usuario("gm", { isGM: true }), jogador] };
  const r = pedirMagiaAoJogador({ actor_id: "a1", payload: { item_id: "s1", pedido_id: "p1", falado: "lanço mísseis mágicos no goblin" } }, { game, reportar: (x) => relatos.push(x) });
  assert.deepEqual(r, { data: { entregue: true, usuario: "ana" } }, "não espera o toque");
  await new Promise((ok) => setTimeout(ok, 0));
  assert.equal(jogador.chamadas.length, 1);
  assert.equal(jogador.chamadas[0].nome, QUERY_LANCAR_MAGIA);
  assert.deepEqual(jogador.chamadas[0].dados, { actor_id: "a1", item_id: "s1", itens: ["s1"], pedido_id: "p1", falado: "lanço mísseis mágicos no goblin" });
  assert.deepEqual(jogador.chamadas[0].opcoes, { timeout: ESPERA_DO_JOGADOR_MS });
  assert.equal(relatos.length, 0, "antes do toque, nada");
  resolver({ ok: true, lancou: true, motivo: null });
  await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(relatos, [{ pedido_id: "p1", ok: true, lancou: true, motivo: null }]);
});

test("pedirMagiaAoJogador: sem jogador conectado, sem a magia, a pergunta que falha e o ator que não existe", async () => {
  const relatos = [];
  const reportar = (x) => relatos.push(x);
  const a = ator("a1");
  const semDono = { actors: { get: () => a }, users: [usuario("gm", { isGM: true })] };
  assert.deepEqual(pedirMagiaAoJogador({ actor_id: "a1", payload: { item_id: "s1" } }, { game: semDono, reportar }), { data: { entregue: false, motivo: "jogador_fora" } });
  const comDono = { actors: { get: () => a }, users: [usuario("ana")] };
  assert.deepEqual(pedirMagiaAoJogador({ actor_id: "a1", payload: { item_id: "nao-existe" } }, { game: comDono, reportar }), { data: { entregue: false, motivo: "magia_nao_achada" } });
  const espada = ator("a2", [{ id: "w1", name: "Espada", type: "weapon" }, { id: "l1", name: "Corda", type: "loot", system: comAtividade() }]);
  const comEspada = { game: { actors: { get: () => espada }, users: [usuario("ana")] }, reportar };
  assert.equal(pedirMagiaAoJogador({ actor_id: "a2", payload: { item_id: "w1" } }, comEspada).data.motivo, "magia_nao_achada", "arma sem nada a usar");
  assert.equal(pedirMagiaAoJogador({ actor_id: "a2", payload: { item_id: "l1" } }, comEspada).data.motivo, "magia_nao_achada", "tipo que não é ação");
  assert.throws(() => pedirMagiaAoJogador({ actor_id: "zz", payload: {} }, { game: { actors: { get: () => undefined }, users: [] }, reportar }), /actor not found: zz/);
  // a pergunta rejeitada (timeout, jogador saiu): vira "sem_resposta"
  const jogador = usuario("ana");
  jogador.resposta = Promise.reject(new Error("timeout"));
  pedirMagiaAoJogador({ actor_id: "a1", payload: { item_id: "s1", pedido_id: "p9" } }, { game: { actors: { get: () => a }, users: [jogador] }, reportar });
  await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(relatos, [{ pedido_id: "p9", ok: false, motivo: "sem_resposta", erro: "timeout" }]);
});

function jogo({ combate = true, dono = true, alvos = ["Goblin"], usar = async () => ({ message: {} }), extra = [] } = {}) {
  const usos = [];
  const usavel = (i) => ({ ...i, isOwner: i.isOwner ?? dono, use: async (...a) => { usos.push([i.id, ...a]); return usar(i.id); } });
  const item = usavel({ id: "s1", name: "Magic Missile", type: "spell" });
  const a = { id: "a1", items: itens([item, ...extra.map(usavel)]) };
  return {
    usos,
    game: {
      actors: { get: (id) => (id === "a1" ? a : undefined) },
      combat: combate ? { started: true } : { started: false },
      user: { targets: new Set(alvos.map((name) => ({ name }))) },
    },
  };
}

test("lancarMagiaNoJogador: só com o 'Lançar' a magia é usada; os alvos são os que ELE marcou", async () => {
  const { game, usos } = jogo();
  const perguntas = [];
  const r = await lancarMagiaNoJogador({ actor_id: "a1", item_id: "s1", falado: "lanço" }, { game, confirmar: async (p) => (perguntas.push(p), true) });
  assert.deepEqual(r, { ok: true, lancou: true, motivo: null });
  assert.equal(usos.length, 1);
  assert.deepEqual(perguntas, [{ itens: [{ nome: "Magic Missile", tipo: "spell" }], alvos: ["Goblin"], falado: "lanço" }]);
});

test("lancarMagiaNoJogador: 'Agora não', janela fechada, sem ser dono: NUNCA usa a magia; sem combate, pergunta (1.13.0)", async () => {
  for (const resposta of [false, null, undefined, "sim"]) {
    const { game, usos } = jogo();
    const r = await lancarMagiaNoJogador({ actor_id: "a1", item_id: "s1" }, { game, confirmar: async () => resposta });
    assert.deepEqual(r, { ok: true, lancou: false, motivo: "recusou" }, `resposta ${resposta}`);
    assert.equal(usos.length, 0, `resposta ${resposta}: não usou`);
  }
  // desde a 1.13.0 (decisão do Bruno, 21/10): sem trava de combate, a fala configurada decide; a pergunta continua
  const semCombate = jogo({ combate: false });
  let perguntou = false;
  assert.deepEqual(await lancarMagiaNoJogador({ actor_id: "a1", item_id: "s1" }, { game: semCombate.game, confirmar: async () => ((perguntou = true), true) }), { ok: true, lancou: true, motivo: null });
  assert.equal(perguntou, true, "fora de combate também pergunta");
  assert.equal(semCombate.usos.length, 1);
  const semCombateNao = jogo({ combate: false });
  await lancarMagiaNoJogador({ actor_id: "a1", item_id: "s1" }, { game: semCombateNao.game, confirmar: async () => false });
  assert.equal(semCombateNao.usos.length, 0, "fora de combate, o 'Agora não' também não usa");
  const naoDono = jogo({ dono: false });
  assert.deepEqual(await lancarMagiaNoJogador({ actor_id: "a1", item_id: "s1" }, { game: naoDono.game, confirmar: async () => true }), { ok: false, motivo: "nao_e_dono" });
  assert.equal(naoDono.usos.length, 0);
  assert.deepEqual(await lancarMagiaNoJogador({ actor_id: "a1", item_id: "xx" }, { game: jogo().game, confirmar: async () => true }), { ok: false, motivo: "magia_nao_achada" });
});

test("lancarMagiaNoJogador: o diálogo do dnd5e cancelado volta como 'cancelou_no_dnd5e'", async () => {
  const { game, usos } = jogo({ usar: async () => undefined });
  assert.deepEqual(await lancarMagiaNoJogador({ actor_id: "a1", item_id: "s1" }, { game, confirmar: async () => true }), { ok: true, lancou: false, motivo: "cancelou_no_dnd5e", usados: 0 });
  assert.equal(usos.length, 1);
});

const T = {
  "CFB.Magia.Pergunta": "Lançar {magia} em {alvo}?",
  "CFB.Magia.PerguntaUsar": "Usar {magia} em {alvo}?",
  "CFB.Magia.Depois": ", depois ",
  "CFB.Magia.SemAlvo": "nenhum alvo marcado",
  "CFB.Magia.Ouvido": "Ouvido: “{falado}”",
};
const t = (k) => T[k];

test("textoDaPergunta: escapa o nome e os alvos; sem alvo, diz que não há", () => {
  const h = textoDaPergunta({ itens: [{ nome: "<b>X</b>", tipo: "spell" }], alvos: ["Gob & Lin"], falado: "lanço <x>" }, t);
  assert.equal(h, "<p>Lançar <strong>&lt;b&gt;X&lt;/b&gt;</strong> em <strong>Gob &amp; Lin</strong>?</p><p class=\"hint\">Ouvido: “lanço &lt;x&gt;”</p>");
  assert.match(textoDaPergunta({ itens: [{ nome: "Bless", tipo: "spell" }], alvos: [] }, t), /em <strong>nenhum alvo marcado<\/strong>/);
});

test("textoDaPergunta: 'Usar' na arma, na poção e no atalho, com os itens em ordem", () => {
  assert.equal(textoDaPergunta({ itens: [{ nome: "Battleaxe", tipo: "weapon" }], alvos: ["Goblin"] }, t), "<p>Usar <strong>Battleaxe</strong> em <strong>Goblin</strong>?</p>");
  assert.equal(
    textoDaPergunta({ itens: [{ nome: "Bless", tipo: "spell" }, { nome: "Guiding Bolt", tipo: "spell" }], alvos: ["Ogro"] }, t),
    "<p>Usar <strong>Bless</strong>, depois <strong>Guiding Bolt</strong> em <strong>Ogro</strong>?</p>",
  );
  assert.equal(eLancar([{ tipo: "spell" }]), true);
  assert.equal(eLancar([{ tipo: "weapon" }]), false);
  assert.equal(eLancar([{ tipo: "spell" }, { tipo: "spell" }]), false, "atalho de duas magias: Usar");
});

test("acoesDoAtor (1.13.0): armas, habilidades e consumíveis com algo a usar; o resto fica de fora", () => {
  const r = acoesDoAtor([
    acao("w1", "Battleaxe", "weapon"),
    acao("f1", "Second Wind", "feat"),
    { id: "f2", name: "Darkvision", type: "feat", system: { activities: new Map() } },
    acao("c1", "Potion of Healing", "consumable"),
    magia("s1", "Bless"),
    acao("e1", "Shield", "equipment"),
    { id: "w2", name: "Clava velha", type: "weapon", system: {} },
  ]);
  assert.deepEqual(r, [
    { id: "w1", uuid: "Actor.a1.Item.w1", name: "Battleaxe", tipo: "weapon" },
    { id: "f1", uuid: "Actor.a1.Item.f1", name: "Second Wind", tipo: "feat" },
    { id: "c1", uuid: "Actor.a1.Item.c1", name: "Potion of Healing", tipo: "consumable" },
  ]);
  assert.deepEqual(acoesDoAtor(undefined), []);
});

test("itensDoPedido: o atalho com a lista (até 5), o item sozinho e o pedido de antes da 1.13.0", () => {
  assert.deepEqual(itensDoPedido({ tipo: "atalho", item_id: "s1", itens: ["s1", "s3", 7, "", "a", "b", "c"] }), ["s1", "s3", "a", "b", "c"]);
  assert.equal(MAX_ITENS_DO_ATALHO, 5);
  assert.deepEqual(itensDoPedido({ tipo: "item", item_id: "s1", itens: ["s1"] }), ["s1"]);
  assert.deepEqual(itensDoPedido({ item_id: "s2" }), ["s2"], "o pedido da edge de antes");
  assert.deepEqual(itensDoPedido({ tipo: "atalho", item_id: "s2", itens: [] }), ["s2"]);
  assert.deepEqual(itensDoPedido({}), []);
});

test("pedirMagiaAoJogador (1.13.0): o atalho vai ao jogador com os itens do ator, em ordem, sem os que sumiram", async () => {
  const a = ator("a1", [magia("s1", "Bless"), acao("w1", "Battleaxe", "weapon"), magia("s3", "Guiding Bolt")]);
  const jogador = usuario("ana", { character: { id: "a1" } });
  const game = { actors: { get: () => a }, users: [jogador] };
  const r = pedirMagiaAoJogador({ actor_id: "a1", payload: { tipo: "atalho", item_id: "s1", itens: ["s1", "sumiu", "w1", "s3"], pedido_id: "p2", falado: "combo" } }, { game, reportar: () => {} });
  assert.deepEqual(r, { data: { entregue: true, usuario: "ana" } });
  await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(jogador.chamadas[0].dados, { actor_id: "a1", item_id: "s1", itens: ["s1", "w1", "s3"], pedido_id: "p2", falado: "combo" });
  assert.deepEqual(pedirMagiaAoJogador({ actor_id: "a1", payload: { tipo: "atalho", item_id: "x", itens: ["x", "y"] } }, { game, reportar: () => {} }), { data: { entregue: false, motivo: "magia_nao_achada" } });
});

test("lancarMagiaNoJogador (1.13.0): o atalho pergunta UMA vez, usa em ordem e para no que ele cancelar", async () => {
  const extra = [{ id: "w1", name: "Battleaxe", type: "weapon", system: comAtividade() }, { id: "c1", name: "Potion of Healing", type: "consumable", system: comAtividade() }];
  const tudo = jogo({ extra });
  const perguntas = [];
  const r = await lancarMagiaNoJogador({ actor_id: "a1", itens: ["s1", "w1", "c1"] }, { game: tudo.game, confirmar: async (p) => (perguntas.push(p), true) });
  assert.deepEqual(r, { ok: true, lancou: true, motivo: null });
  assert.deepEqual(tudo.usos.map((u) => u[0]), ["s1", "w1", "c1"], "em ordem");
  assert.equal(perguntas.length, 1);
  assert.deepEqual(perguntas[0].itens.map((i) => i.tipo), ["spell", "weapon", "consumable"]);
  // cancelou o 2º no diálogo do dnd5e: o 3º não é usado
  const parou = jogo({ extra, usar: async (id) => (id === "w1" ? undefined : { message: {} }) });
  assert.deepEqual(await lancarMagiaNoJogador({ actor_id: "a1", itens: ["s1", "w1", "c1"] }, { game: parou.game, confirmar: async () => true }), { ok: true, lancou: false, motivo: "cancelou_no_dnd5e", usados: 1 });
  assert.deepEqual(parou.usos.map((u) => u[0]), ["s1", "w1"]);
  // um item que não é dele: nada é usado
  const alheio = jogo({ extra: [{ id: "w9", name: "Espada do outro", type: "weapon", system: comAtividade(), isOwner: false }] });
  assert.deepEqual(await lancarMagiaNoJogador({ actor_id: "a1", itens: ["s1", "w9"] }, { game: alheio.game, confirmar: async () => true }), { ok: false, motivo: "nao_e_dono" });
  assert.equal(alheio.usos.length, 0);
  // "Agora não" no atalho: nada
  const nao = jogo({ extra });
  await lancarMagiaNoJogador({ actor_id: "a1", itens: ["s1", "w1"] }, { game: nao.game, confirmar: async () => false });
  assert.equal(nao.usos.length, 0);
});
