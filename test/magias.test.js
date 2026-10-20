/**
 * A magia falada (magias.js, v1.12.0), sem Foundry: as magias do snapshot, o
 * dono do ator, o pedido no GM (responde na hora, o resultado vem depois) e a
 * pergunta no jogador (NUNCA usa a magia sem o "Lançar").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ESPERA_DO_JOGADOR_MS,
  QUERY_LANCAR_MAGIA,
  donoDoAtor,
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
  assert.deepEqual(jogador.chamadas[0].dados, { actor_id: "a1", item_id: "s1", pedido_id: "p1", falado: "lanço mísseis mágicos no goblin" });
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
  const espada = ator("a2", [{ id: "w1", name: "Espada", type: "weapon" }]);
  assert.equal(pedirMagiaAoJogador({ actor_id: "a2", payload: { item_id: "w1" } }, { game: { actors: { get: () => espada }, users: [usuario("ana")] }, reportar }).data.motivo, "magia_nao_achada", "item que não é magia");
  assert.throws(() => pedirMagiaAoJogador({ actor_id: "zz", payload: {} }, { game: { actors: { get: () => undefined }, users: [] }, reportar }), /actor not found: zz/);
  // a pergunta rejeitada (timeout, jogador saiu): vira "sem_resposta"
  const jogador = usuario("ana");
  jogador.resposta = Promise.reject(new Error("timeout"));
  pedirMagiaAoJogador({ actor_id: "a1", payload: { item_id: "s1", pedido_id: "p9" } }, { game: { actors: { get: () => a }, users: [jogador] }, reportar });
  await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(relatos, [{ pedido_id: "p9", ok: false, motivo: "sem_resposta", erro: "timeout" }]);
});

function jogo({ combate = true, dono = true, alvos = ["Goblin"], usar = async () => ({ message: {} }) } = {}) {
  const usos = [];
  const item = { id: "s1", name: "Magic Missile", type: "spell", isOwner: dono, use: async (...a) => { usos.push(a); return usar(); } };
  const a = { id: "a1", items: itens([item]) };
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
  assert.deepEqual(perguntas, [{ magia: "Magic Missile", alvos: ["Goblin"], falado: "lanço" }]);
});

test("lancarMagiaNoJogador: 'Agora não', janela fechada, sem combate, sem ser dono: NUNCA usa a magia", async () => {
  for (const resposta of [false, null, undefined, "sim"]) {
    const { game, usos } = jogo();
    const r = await lancarMagiaNoJogador({ actor_id: "a1", item_id: "s1" }, { game, confirmar: async () => resposta });
    assert.deepEqual(r, { ok: true, lancou: false, motivo: "recusou" }, `resposta ${resposta}`);
    assert.equal(usos.length, 0, `resposta ${resposta}: não usou`);
  }
  const semCombate = jogo({ combate: false });
  let perguntou = false;
  assert.deepEqual(await lancarMagiaNoJogador({ actor_id: "a1", item_id: "s1" }, { game: semCombate.game, confirmar: async () => ((perguntou = true), true) }), { ok: false, motivo: "sem_combate" });
  assert.equal(perguntou, false, "fora de combate nem pergunta");
  assert.equal(semCombate.usos.length, 0);
  const naoDono = jogo({ dono: false });
  assert.deepEqual(await lancarMagiaNoJogador({ actor_id: "a1", item_id: "s1" }, { game: naoDono.game, confirmar: async () => true }), { ok: false, motivo: "nao_e_dono" });
  assert.equal(naoDono.usos.length, 0);
  assert.deepEqual(await lancarMagiaNoJogador({ actor_id: "a1", item_id: "xx" }, { game: jogo().game, confirmar: async () => true }), { ok: false, motivo: "magia_nao_achada" });
});

test("lancarMagiaNoJogador: o diálogo do dnd5e cancelado volta como 'cancelou_no_dnd5e'", async () => {
  const { game, usos } = jogo({ usar: async () => undefined });
  assert.deepEqual(await lancarMagiaNoJogador({ actor_id: "a1", item_id: "s1" }, { game, confirmar: async () => true }), { ok: true, lancou: false, motivo: "cancelou_no_dnd5e" });
  assert.equal(usos.length, 1);
});

test("textoDaPergunta: escapa o nome e os alvos; sem alvo, diz que não há", () => {
  const t = (k) => ({ "CFB.Magia.Pergunta": "Lançar {magia} em {alvo}?", "CFB.Magia.SemAlvo": "nenhum alvo marcado", "CFB.Magia.Ouvido": "Ouvido: “{falado}”" })[k];
  const h = textoDaPergunta({ magia: "<b>X</b>", alvos: ["Gob & Lin"], falado: "lanço <x>" }, t);
  assert.equal(h, "<p>Lançar <strong>&lt;b&gt;X&lt;/b&gt;</strong> em <strong>Gob &amp; Lin</strong>?</p><p class=\"hint\">Ouvido: “lanço &lt;x&gt;”</p>");
  assert.match(textoDaPergunta({ magia: "Bless", alvos: [] }, t), /em <strong>nenhum alvo marcado<\/strong>/);
});
