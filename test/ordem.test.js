import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_COMBATENTES,
  VIVO_MS,
  chaveDoEnvio,
  combateParaMostrar,
  comandoDeTurno,
  focarCombatente,
  fotoDoCombate,
  oQueMandar,
  versoesDoModulo,
  vidaDoAtor,
} from "../scripts/ordem.js";
import { VERSAO_DO_CODIGO } from "../scripts/versao.js";

const mapa = (arr) => {
  const m = new Map(arr.map((x) => [x.id, x]));
  m.contents = arr;
  return m;
};

function combatente(id, extra = {}) {
  return {
    id,
    tokenId: `T${id}`,
    actorId: `A${id}`,
    name: `Nome ${id}`,
    initiative: null,
    hidden: false,
    isDefeated: false,
    token: { id: `T${id}`, hidden: false, texture: { src: `tokens/${id}.webp` } },
    actor: { type: "npc", system: { attributes: { hp: { value: 5, max: 7, effectiveMax: 7, temp: 0 } } } },
    ...extra,
  };
}

function combate(id, { cena = "Cena1", started = true, active = false, turns = [], turn = 0, round = 1 } = {}) {
  return {
    id,
    started,
    active,
    scene: cena ? { id: cena, name: `Cena ${cena}` } : null,
    turns,
    turn,
    round,
    combatant: turns[turn] ?? null,
    combatants: mapa(turns),
  };
}

test("a versão do código bate com o module.json", () => {
  const m = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(VERSAO_DO_CODIGO, m.version);
});

test("o combate da ordem: o começado da cena ativa, o ativo dela primeiro", () => {
  const a = combate("A", { cena: "Cena1" });
  const b = combate("B", { cena: "Cena1", active: true });
  const outraCena = combate("C", { cena: "Cena2", active: true });
  const naoComecado = combate("D", { cena: "Cena1", started: false, active: true });
  const game = { scenes: { active: { id: "Cena1" } }, combats: [a, b, outraCena, naoComecado] };
  assert.equal(combateParaMostrar(game).id, "B");
  assert.equal(combateParaMostrar({ ...game, combats: [a, outraCena] }).id, "A");
});

test("sem combate começado na cena ativa: o global (sem cena), senão nada", () => {
  const global = combate("G", { cena: null });
  const outra = combate("C", { cena: "Cena2" });
  assert.equal(combateParaMostrar({ scenes: { active: { id: "Cena1" } }, combats: [outra, global] }).id, "G");
  assert.equal(combateParaMostrar({ scenes: { active: { id: "Cena1" } }, combats: [outra] }), null);
  assert.equal(combateParaMostrar({ scenes: { active: null }, combats: [] }), null);
});

test("a foto segue combat.turns e leva a vida, o escondido e o derrotado", () => {
  const turns = [
    combatente("1", { initiative: 18, actor: { type: "character", system: { attributes: { hp: { value: 30, max: 40, effectiveMax: 45, temp: 5 } } } } }),
    combatente("2", { initiative: 12, hidden: true }),
    combatente("3", { token: { id: "T3", hidden: true, texture: { src: "data:image/png;base64,AAA" } }, isDefeated: true }),
  ];
  const f = fotoDoCombate(combate("X", { turns, turn: 1, round: 3 }));
  assert.equal(f.id, "X");
  assert.deepEqual(f.cena, { id: "Cena1", nome: "Cena Cena1" });
  assert.equal(f.rodada, 3);
  assert.equal(f.turno, 1);
  assert.equal(f.vez, "2");
  assert.deepEqual(f.combatentes.map((c) => c.id), ["1", "2", "3"]);
  assert.deepEqual(f.combatentes[0].pv, { valor: 30, max: 45, temp: 5 });
  assert.equal(f.combatentes[0].tipo, "character");
  assert.equal(f.combatentes[0].img, "tokens/1.webp");
  assert.equal(f.combatentes[1].escondido, true);
  assert.equal(f.combatentes[1].token_escondido, false);
  assert.equal(f.combatentes[2].token_escondido, true);
  assert.equal(f.combatentes[2].derrotado, true);
  assert.equal(f.combatentes[2].iniciativa, null);
  assert.equal(f.combatentes[2].img, null, "a imagem data: não vai");
});

test("a foto corta em 100 combatentes; sem combate, nulo", () => {
  const turns = Array.from({ length: MAX_COMBATENTES + 5 }, (_, i) => combatente(String(i)));
  assert.equal(fotoDoCombate(combate("X", { turns })).combatentes.length, MAX_COMBATENTES);
  assert.equal(fotoDoCombate(null), null);
});

test("a vida: o máximo efetivo, o temporário só se houver; sem hp, nulo", () => {
  assert.deepEqual(vidaDoAtor({ system: { attributes: { hp: { value: 3, max: 7, temp: 0 } } } }), { valor: 3, max: 7 });
  assert.deepEqual(vidaDoAtor({ system: { attributes: { hp: { value: 0, max: 10, effectiveMax: 12, temp: 2 } } } }), { valor: 0, max: 12, temp: 2 });
  assert.equal(vidaDoAtor({ system: {} }), null);
  assert.equal(vidaDoAtor(null), null);
});

test("o que mandar: mudou, o 'estou vivo' de 30 s, ou nada", () => {
  const ch = chaveDoEnvio({ id: "X" }, { codigo: "1.24.0" });
  assert.equal(oQueMandar(ch, true, null, 0), "manda");
  assert.equal(oQueMandar(ch, true, { chave: "outra", em: 0 }, 1), "manda");
  assert.equal(oQueMandar(ch, true, { chave: ch, em: 1000 }, 1000 + VIVO_MS - 1), null);
  assert.equal(oQueMandar(ch, true, { chave: ch, em: 1000 }, 1000 + VIVO_MS), "vivo");
  const semCombate = chaveDoEnvio(null, {});
  assert.equal(oQueMandar(semCombate, false, { chave: semCombate, em: 0 }, 10 * VIVO_MS), null, "sem combate não fica mandando");
});

test("passar o turno: só na vez que o Mestre viu", async () => {
  const turns = [combatente("1"), combatente("2")];
  const c = combate("X", { turns, turn: 0 });
  const chamadas = [];
  const deps = {
    game: { combats: mapa([c]) },
    passarTurno: async (cb) => chamadas.push(["proximo", cb.id]),
    voltarTurno: async (cb) => chamadas.push(["anterior", cb.id]),
  };
  assert.deepEqual(await comandoDeTurno({ acao: "proximo", combate_id: "X", vez_vista: "2" }, deps), { recusado: "a_vez_mudou" });
  assert.equal(chamadas.length, 0);
  const r = await comandoDeTurno({ acao: "proximo", combate_id: "X", vez_vista: "1" }, deps);
  assert.equal(r.passou, true);
  await comandoDeTurno({ acao: "anterior", combate_id: "X", vez_vista: "1" }, deps);
  assert.deepEqual(chamadas, [["proximo", "X"], ["anterior", "X"]]);
  await assert.rejects(comandoDeTurno({ acao: "proximo", combate_id: "Y" }, deps), /combate_sumiu/);
  const parado = combate("P", { started: false, turns });
  assert.deepEqual(await comandoDeTurno({ acao: "proximo", combate_id: "P" }, { ...deps, game: { combats: mapa([parado]) } }), { recusado: "nao_comecado" });
});

test("selecionar: o token do combatente; sem token, recusa", async () => {
  const comToken = combatente("1", { token: { id: "T1", parent: { id: "Cena1" } } });
  const semToken = combatente("2", { token: null });
  const c = combate("X", { turns: [comToken, semToken] });
  const focados = [];
  const deps = { game: { combats: mapa([c]) }, focar: async (cena, tok) => focados.push([cena.id, tok.id]) };
  assert.deepEqual(await focarCombatente({ combate_id: "X", combatant_id: "1" }, deps), { focado: true });
  assert.deepEqual(focados, [["Cena1", "T1"]]);
  assert.deepEqual(await focarCombatente({ combate_id: "X", combatant_id: "2" }, deps), { recusado: "sem_token" });
  await assert.rejects(focarCombatente({ combate_id: "X", combatant_id: "9" }, deps), /combatente_sumiu/);
  await assert.rejects(focarCombatente({ combate_id: "Z", combatant_id: "1" }, deps), /combate_sumiu/);
});

test("as versões: o servidor, o código e cada navegador (nulo = código velho)", () => {
  const v = versoesDoModulo({
    servidor: "1.24.0",
    codigo: "1.24.0",
    navegadores: [{ usuario: "Bruno", gm: true, codigo: "1.24.0" }, { usuario: "Teste", gm: false, codigo: null }, { nada: 1 }],
  });
  assert.deepEqual(v, {
    servidor: "1.24.0",
    codigo: "1.24.0",
    navegadores: [{ usuario: "Bruno", gm: true, codigo: "1.24.0" }, { usuario: "Teste", gm: false, codigo: null }],
  });
});
