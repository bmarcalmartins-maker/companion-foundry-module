/**
 * A iniciativa falada (iniciativa.js, v1.23.0), sem Foundry: a lista da cena
 * para o cartão do Companion, abrir o combate (novo ou o de agora), rolar só os
 * outros, perguntar ao jogador, rolar pelo Companion (no jogador ou, sem ele,
 * no GM), a janela que nunca rola duas vezes e o aviso de quem rolou.
 *
 * O Foundry falso só tem o que o módulo usa. Não prova que o Foundry de verdade
 * responde igual — isso é a ETAPA 4, com o Foundry aberto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_OUTROS,
  QUERY_ROLAR_INICIATIVA,
  abrirCombate,
  combateDaCena,
  eventoDeRolagem,
  listarCena,
  perguntarAoJogador,
  rolarNoJogador,
  rolarPeloCompanion,
  selecionadosNaCena,
  textoDaJanela,
  textoDaRolagem,
} from "../scripts/iniciativa.js";

const moduleJson = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
const espera = () => new Promise((r) => setTimeout(r, 5));

class Colecao extends Map {
  constructor(lista = []) {
    super(lista.map((x) => [x.id, x]));
  }
  filter(fn) { return [...this.values()].filter(fn); }
  find(fn) { return [...this.values()].find(fn); }
  [Symbol.iterator]() { return this.values(); }
}

const usuario = (id, { isGM = false, active = true, character = null, respostas = [] } = {}) => {
  const u = { id, name: id, isGM, active, character, chamadas: [] };
  u.query = async (nome, dados, opcoes) => {
    u.chamadas.push({ nome, dados, opcoes });
    const r = respostas.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return u;
};
const ator = (id, type, donos = []) => ({ id, type, name: id, testUserPermission: (u) => donos.includes(u.id) });

let seq = 0;
function combate({ id = "Comb1", scene = "Cena1", started = false, active = true, combatentes = [] } = {}) {
  const c = {
    id, scene: { id: scene }, started, active, round: started ? 1 : 0,
    combatants: new Colecao(combatentes),
    rolados: [],
    getCombatantsByToken(tid) { return [...this.combatants.values()].filter((x) => x.tokenId === tid); },
    getCombatantsByActor(aid) { return [...this.combatants.values()].filter((x) => x.actorId === aid); },
    async createEmbeddedDocuments(tipo, dados) {
      assert.equal(tipo, "Combatant");
      const novos = dados.map((d) => ({ id: `Cbt${++seq}`, initiative: null, name: d.tokenId, isOwner: true, ...d, actor: atores.get(d.actorId) ?? null }));
      for (const n of novos) this.combatants.set(n.id, n);
      return novos;
    },
    async rollInitiative(ids, opcoes) {
      this.rolados.push({ ids: [...ids], opcoes });
      for (const i of ids) this.combatants.get(i).initiative = 10 + ids.indexOf(i);
    },
  };
  for (const x of combatentes) x.parent = c;
  return c;
}

const atores = new Map();
for (const a of [ator("AtorGuldrum", "character", ["renan"]), ator("AtorTeste", "character", ["teste"]), ator("AtorGoblin", "npc"), ator("AtorLobo", "npc")]) atores.set(a.id, a);
const token = (id, actorId, extra = {}) => ({ id, name: extra.name ?? id, actorId, actorLink: extra.actorLink ?? false, hidden: extra.hidden ?? false,
  texture: { src: `tokens/${id}.webp` }, actor: atores.get(actorId) ?? null });

function mundo({ tokens, combates = [], usuarios = [] }) {
  const cena = { id: "Cena1", name: "Estrada", tokens: new Colecao(tokens) };
  return {
    cena,
    game: {
      scenes: { active: cena, get: (id) => (id === cena.id ? cena : undefined) },
      combats: Object.assign(new Colecao(combates), {}),
      users: new Colecao(usuarios),
    },
  };
}

const PCS = [
  { character_id: "c-guldrum", actor_id: "AtorGuldrum", nome: "Guldrum", do_mestre: false },
  { character_id: "c-talaniel", actor_id: "AtorTalaniel", nome: "Talaniel", do_mestre: false },
  { character_id: "c-teste", actor_id: "AtorTeste", nome: "PC Teste", do_mestre: true },
  { character_id: "c-sumido", actor_id: "AtorSumido", nome: "Sumido do Mestre", do_mestre: true },
];

test("o nome da pergunta tem o prefixo do módulo (CONFIG.queries)", () => {
  assert.ok(QUERY_ROLAR_INICIATIVA.startsWith(`${moduleJson.id}.`), QUERY_ROLAR_INICIATIVA);
  // o número exato é conferido contra o código em ordem.test.js (v1.24.0)
  assert.match(moduleJson.version, /^\d+\.\d+\.\d+$/);
});

test("sem cena ativa: o cartão diz", async () => {
  assert.deepEqual(await listarCena({ game: { scenes: { active: null } }, pcs: PCS }), { erro: "sem_cena_ativa" });
});

test("a lista da cena: os PCs com e sem token, os outros, os selecionados primeiro, o PC do Mestre só com token", async () => {
  const { game } = mundo({
    tokens: [token("TokLobo", "AtorLobo"), token("TokGoblin", "AtorGoblin", { hidden: true }), token("TokGuldrum", "AtorGuldrum", { actorLink: true }), token("TokTeste", "AtorTeste", { actorLink: true })],
  });
  const canvas = { scene: { id: "Cena1" }, tokens: { controlled: [{ document: { id: "TokGoblin" } }] } };
  const miniaturas = [];
  const r = await listarCena({ game, canvas, pcs: PCS, miniatura: async (src) => (miniaturas.push(src), `data:${src}`) });
  assert.deepEqual(r.cena, { id: "Cena1", nome: "Estrada" });
  assert.equal(r.vendo, true);
  assert.equal(r.combate, null);
  assert.deepEqual(r.pcs.map((p) => [p.nome, p.token_id]), [["Guldrum", "TokGuldrum"], ["Talaniel", null], ["PC Teste", "TokTeste"]]);
  assert.equal(r.pcs[0].img, "data:tokens/TokGuldrum.webp");
  assert.equal(r.pcs[1].img, null);
  assert.deepEqual(r.outros.map((o) => o.token_id), ["TokGoblin", "TokLobo"], "o selecionado vem primeiro");
  assert.equal(r.outros[0].escondido, true);
  assert.equal(r.outros[0].tipo, "npc");
  assert.deepEqual(r.selecionados, ["TokGoblin"]);
  assert.equal(miniaturas.length, 4);
});

test("o Mestre vendo outra cena: nada vem selecionado", async () => {
  const { game } = mundo({ tokens: [token("TokGoblin", "AtorGoblin")] });
  const r = await listarCena({ game, canvas: { scene: { id: "Outra" }, tokens: { controlled: [{ document: { id: "TokGoblin" } }] } }, pcs: [] });
  assert.equal(r.vendo, false);
  assert.deepEqual(r.selecionados, []);
  assert.deepEqual(selecionadosNaCena({ scene: { id: "Cena1" }, tokens: { controlled: [{ id: "a" }, { document: { id: "a" } }] } }, "Cena1"), ["a"]);
});

test("o combate de agora na cena aparece, com quem já está nele; muitos tokens: até MAX_OUTROS", async () => {
  const tokens = Array.from({ length: MAX_OUTROS + 5 }, (_, i) => token(`Tok${i}`, "AtorGoblin"));
  const c = combate({ started: true, combatentes: [{ id: "CbtA", tokenId: "Tok3", actorId: "AtorGoblin", initiative: 12 }] });
  const { game } = mundo({ tokens, combates: [c] });
  const r = await listarCena({ game, canvas: null, pcs: [] });
  assert.deepEqual(r.combate, { id: "Comb1", comecado: true, rodada: 1, combatentes: 1 });
  assert.equal(r.outros.length, MAX_OUTROS);
  assert.equal(r.total_tokens, MAX_OUTROS + 5);
  assert.equal(r.outros.find((o) => o.token_id === "Tok3").no_combate, true);
  assert.equal(combateDaCena({ combats: [c, combate({ id: "C2", scene: "Outra" })] }, "Cena1").id, "Comb1");
  assert.equal(combateDaCena({ combats: [] }, "Cena1"), null);
});

test("abrir (novo): cria o combate, adiciona os marcados, rola SÓ os outros, pergunta ao jogador conectado", async () => {
  seq = 0;
  const renan = usuario("renan", { character: { id: "AtorGuldrum" } });
  const mestre = usuario("mestre", { isGM: true });
  const { game } = mundo({
    tokens: [token("TokGuldrum", "AtorGuldrum", { actorLink: true }), token("TokGoblin", "AtorGoblin", { hidden: true }), token("TokLobo", "AtorLobo"), token("TokFora", "AtorLobo")],
    usuarios: [renan, mestre],
  });
  const novo = combate({ id: "CombNovo" });
  let criado = 0;
  const r = await abrirCombate(
    { modo: "novo", cena_id: "Cena1", tokens: ["TokGuldrum", "TokGoblin", "TokLobo", "NaoExiste"], pcs: [{ pedido_id: "p1", actor_id: "AtorGuldrum", token_id: "TokGuldrum" }] },
    { game, criarCombate: async () => (criado++, novo), rolar: (c, ids) => c.rollInitiative(ids), perguntar: (a) => perguntarAoJogador(a, { game }) },
  );
  assert.equal(criado, 1);
  assert.equal(r.combate_id, "CombNovo");
  assert.equal(r.adicionados, 3);
  assert.equal(r.combatentes, 3);
  assert.equal(r.outros_rolados, 2);
  assert.equal(novo.rolados.length, 1);
  assert.deepEqual(novo.rolados[0].ids.length, 2, "o Guldrum não é rolado pelo GM");
  const goblin = novo.getCombatantsByToken("TokGoblin")[0];
  assert.equal(goblin.hidden, true, "o escondido entra escondido");
  assert.equal(r.pcs.length, 1);
  assert.equal(r.pcs[0].iniciativa, null);
  assert.equal(r.pcs[0].entregue, true);
  assert.equal(r.pcs[0].usuario, "renan");
  await espera();
  assert.equal(renan.chamadas.length, 1);
  assert.equal(renan.chamadas[0].nome, QUERY_ROLAR_INICIATIVA);
  assert.equal(renan.chamadas[0].dados.perguntar, true);
  assert.equal(mestre.chamadas.length, 0, "o GM nunca é tratado como jogador");
});

test("abrir (adicionar): usa o combate de agora, não duplica quem já está, devolve a iniciativa de quem já rolou", async () => {
  const ja = { id: "CbtJa", tokenId: "TokGuldrum", actorId: "AtorGuldrum", initiative: 17, isOwner: true, actor: atores.get("AtorGuldrum") };
  const c = combate({ id: "CombAgora", started: true, combatentes: [ja] });
  const { game } = mundo({ tokens: [token("TokGuldrum", "AtorGuldrum"), token("TokOgro", "AtorLobo")], combates: [c] });
  const r = await abrirCombate(
    { modo: "adicionar", combate_id: "CombAgora", cena_id: "Cena1", tokens: ["TokGuldrum", "TokOgro"], pcs: [{ pedido_id: "p1", actor_id: "AtorGuldrum", token_id: "TokGuldrum" }] },
    { game, criarCombate: async () => assert.fail("não cria"), rolar: (cb, ids) => cb.rollInitiative(ids), perguntar: () => assert.fail("já rolou: não pergunta") },
  );
  assert.equal(r.comecado, true);
  assert.equal(r.adicionados, 1);
  assert.equal(r.pcs[0].iniciativa, 17);
  assert.equal(r.pcs[0].entregue, false);
  await assert.rejects(
    abrirCombate({ modo: "adicionar", combate_id: "Sumiu", tokens: [] }, { game, criarCombate: async () => null, rolar: async () => {}, perguntar: () => ({}) }),
    /combate_sumiu/,
  );
});

test("rolar pelo Companion: o navegador do jogador rola sem perguntar; o GM não rola junto", async () => {
  const renan = usuario("renan", { respostas: [{ ok: true, rolou: true, valor: 15 }] });
  const cbt = { id: "Cbt1", tokenId: "T", actorId: "AtorGuldrum", initiative: null, actor: atores.get("AtorGuldrum") };
  const c = combate({ combatentes: [cbt] });
  const { game } = mundo({ tokens: [], combates: [c], usuarios: [renan] });
  let gm = 0;
  const r = rolarPeloCompanion({ combate_id: "Comb1", combatant_id: "Cbt1", pedido_id: "p1" }, { game, rolarNoGm: async () => gm++, reportarFalha: () => assert.fail() });
  assert.deepEqual(r, { entregue: true, por: "jogador", usuario: "renan" });
  await espera();
  assert.equal(renan.chamadas[0].dados.perguntar, false);
  assert.equal(renan.chamadas[0].dados.pelo_companion, true);
  assert.equal(gm, 0);
});

test("rolar pelo Companion: sem o jogador no Foundry (ou o navegador dele não rola), o GM rola por ele", async () => {
  const cbt = { id: "Cbt1", actorId: "AtorGuldrum", initiative: null, actor: atores.get("AtorGuldrum") };
  const c = combate({ combatentes: [cbt] });
  let gm = 0;
  const { game } = mundo({ tokens: [], combates: [c], usuarios: [usuario("renan", { active: false })] });
  assert.deepEqual(rolarPeloCompanion({ combate_id: "Comb1", combatant_id: "Cbt1" }, { game, rolarNoGm: async () => gm++, reportarFalha: () => {} }), { entregue: true, por: "mestre" });
  await espera();
  assert.equal(gm, 1);

  const semModulo = usuario("renan", { respostas: [new Error("no handler")] });
  const c2 = combate({ combatentes: [{ ...cbt, initiative: null }] });
  const g2 = mundo({ tokens: [], combates: [c2], usuarios: [semModulo] }).game;
  rolarPeloCompanion({ combate_id: "Comb1", combatant_id: "Cbt1" }, { game: g2, rolarNoGm: async () => gm++, reportarFalha: () => {} });
  await espera();
  assert.equal(gm, 2);

  const falha = [];
  const c3 = combate({ combatentes: [{ ...cbt, initiative: null }] });
  const g3 = mundo({ tokens: [], combates: [c3], usuarios: [] }).game;
  rolarPeloCompanion({ combate_id: "Comb1", combatant_id: "Cbt1", pedido_id: "p9" }, { game: g3, rolarNoGm: async () => { throw new Error("sem permissão"); }, reportarFalha: (...a) => falha.push(a) });
  await espera();
  assert.deepEqual(falha, [["p9", "o Foundry não rolou: sem permissão"]]);
});

test("rolar pelo Companion: quem já rolou não rola de novo; combate ou combatente sumido é erro claro", () => {
  const c = combate({ combatentes: [{ id: "Cbt1", initiative: 8, actor: atores.get("AtorGuldrum") }] });
  const { game } = mundo({ tokens: [], combates: [c] });
  assert.deepEqual(rolarPeloCompanion({ combate_id: "Comb1", combatant_id: "Cbt1" }, { game, rolarNoGm: () => assert.fail(), reportarFalha: () => {} }), { ja_rolou: true, valor: 8 });
  assert.throws(() => rolarPeloCompanion({ combate_id: "X", combatant_id: "Cbt1" }, { game }), /combate_sumiu/);
  assert.throws(() => rolarPeloCompanion({ combate_id: "Comb1", combatant_id: "X" }, { game }), /combatente_sumiu/);
});

test("no jogador: a janela; só o 'Rolar' rola; nunca duas vezes; o que veio do Companion rola direto", async () => {
  const cbt = { id: "Cbt1", initiative: null, isOwner: true };
  const c = combate({ combatentes: [cbt] });
  const game = { combats: new Colecao([c]) };
  const rolagens = [];
  const rolar = async (cb, x, op) => { rolagens.push(op); x.initiative = 13; };

  assert.deepEqual(await rolarNoJogador({ combate_id: "Comb1", combatant_id: "Cbt1", perguntar: true }, { game, perguntar: async () => false, rolar }), { ok: true, rolou: false, motivo: "recusou" });
  assert.equal(rolagens.length, 0);
  assert.deepEqual(await rolarNoJogador({ combate_id: "Comb1", combatant_id: "Cbt1", perguntar: true }, { game, perguntar: async () => true, rolar }), { ok: true, rolou: true, valor: 13 });
  assert.deepEqual(rolagens, [{ pelo_companion: false }]);
  assert.deepEqual(await rolarNoJogador({ combate_id: "Comb1", combatant_id: "Cbt1", perguntar: false }, { game, perguntar: () => assert.fail(), rolar }), { ok: true, rolou: false, motivo: "ja_rolou", valor: 13 });

  // a janela aberta e o botão do Companion ao mesmo tempo: rola UMA vez
  cbt.initiative = null;
  let soltaJanela;
  const janela = rolarNoJogador({ combate_id: "Comb1", combatant_id: "Cbt1", perguntar: true }, { game, perguntar: () => new Promise((r) => (soltaJanela = r)), rolar });
  const botao = await rolarNoJogador({ combate_id: "Comb1", combatant_id: "Cbt1", perguntar: false, pelo_companion: true }, { game, perguntar: () => assert.fail(), rolar });
  assert.deepEqual(botao, { ok: true, rolou: true, valor: 13 });
  soltaJanela(true);
  assert.deepEqual(await janela, { ok: true, rolou: false, motivo: "ja_rolou", valor: 13 });
  assert.deepEqual(rolagens.at(-1), { pelo_companion: true });
  assert.equal(rolagens.length, 2);

  assert.deepEqual(await rolarNoJogador({ combate_id: "Comb1", combatant_id: "X" }, { game }), { ok: false, motivo: "combatente_sumiu" });
  const alheio = combate({ id: "C2", combatentes: [{ id: "Cbt9", initiative: null, isOwner: false }] });
  assert.deepEqual(await rolarNoJogador({ combate_id: "C2", combatant_id: "Cbt9" }, { game: { combats: new Colecao([alheio]) } }), { ok: false, motivo: "nao_e_dono" });
});

test("quem rolou: só personagem, só com iniciativa, e se foi um GM", () => {
  const users = new Colecao([{ id: "gm", isGM: true }, { id: "renan", isGM: false }]);
  const game = { users };
  const pc = { id: "Cbt1", actorId: "AtorGuldrum", actor: atores.get("AtorGuldrum"), parent: { id: "Comb1" } };
  assert.deepEqual(eventoDeRolagem(pc, { initiative: 14.2 }, "renan", game), {
    op: "iniciativa.rolou", combate_id: "Comb1", combatant_id: "Cbt1", actor_id: "AtorGuldrum", valor: 14.2, pelo_gm: false,
  });
  assert.equal(eventoDeRolagem(pc, { initiative: 9 }, "gm", game).pelo_gm, true);
  assert.equal(eventoDeRolagem(pc, { initiative: null }, "gm", game), null, "zerar a iniciativa não é rolar");
  assert.equal(eventoDeRolagem(pc, { defeated: true }, "gm", game), null);
  assert.equal(eventoDeRolagem({ ...pc, actor: atores.get("AtorGoblin") }, { initiative: 5 }, "gm", game), null, "criatura não vai");
});

test("os textos: 'rolado pelo Companion' e a janela escapada", () => {
  const t = (k) => ({
    "CFB.Iniciativa.RoladoPeloCompanion": "{nome} rola a iniciativa — rolado pelo Companion",
    "CFB.Iniciativa.RoladoPeloCompanionMestre": "{nome} rola a iniciativa — rolado pelo Companion (pelo Mestre)",
    "CFB.Iniciativa.Pergunta": "{nome}, rolar a sua iniciativa?",
    "CFB.Iniciativa.Dica": "dica",
  })[k];
  assert.equal(textoDaRolagem({ nome: "Guldrum", pelo_gm: false }, t), "Guldrum rola a iniciativa — rolado pelo Companion");
  assert.match(textoDaRolagem({ nome: "Guldrum", pelo_gm: true }, t), /pelo Mestre/);
  assert.match(textoDaJanela({ nome: "<b>Gul</b>" }, t), /&lt;b&gt;Gul&lt;\/b&gt;/);
  for (const arq of ["../languages/pt-BR.json", "../languages/en.json"]) {
    const d = JSON.parse(readFileSync(new URL(arq, import.meta.url), "utf8"));
    for (const k of ["Titulo", "Pergunta", "Dica", "Rolar", "AgoraNao", "RoladoPeloCompanion", "RoladoPeloCompanionMestre"]) assert.ok(d[`CFB.Iniciativa.${k}`], `${arq} ${k}`);
    assert.match(d["CFB.Iniciativa.RoladoPeloCompanion"], /Companion/);
  }
});
