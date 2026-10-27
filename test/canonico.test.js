/**
 * As correções canônicas (canonico.js, v1.16.0), sem Foundry. Os dados do
 * oficial são os do dnd5e 5.3.0: Disciple of Life 2024 (classes24
 * phbclcDiscipleOf, uma atividade heal `@scaling + 2`, sem efeito) e 2014
 * (classfeatures jF8AFfEMICIJnAkR, sem efeito nem atividade).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CORRECOES_DECIDIDAS, antesDoItem, escalasQueFaltam, planoDoItem } from "../scripts/canonico.js";

const DDB = {
  effects: [{ _id: "ddb1", name: "Disciple of Life", system: { changes: [{ key: "system.bonuses.heal.damage", type: "add", value: "2 + @item.level" }] } }],
  system: { activities: {} },
};
const OFICIAL_2024 = {
  effects: [],
  system: { activities: { Dm91WPfNiRty1bXv: { _id: "Dm91WPfNiRty1bXv", type: "heal", healing: { number: null, denomination: 0, types: ["healing"], custom: { enabled: true, formula: "@scaling + 2" }, bonus: "" } } } },
};
const OFICIAL_2014 = { effects: [], system: { activities: {} } };

test("o Disciple of Life está entre as decisões do Bruno", () => {
  assert.ok(CORRECOES_DECIDIDAS.includes("disciple-of-life"));
});

test("2024: tira o efeito do D&D Beyond e cria a atividade oficial", () => {
  const p = planoDoItem(DDB, OFICIAL_2024);
  assert.equal(p.igual, false);
  assert.deepEqual(p.apagarEfeitos, ["ddb1"]);
  assert.deepEqual(p.criarEfeitos, []);
  assert.deepEqual(p.apagarAtividades, []);
  assert.deepEqual(Object.keys(p.criarAtividades), ["Dm91WPfNiRty1bXv"]);
  assert.equal(p.criarAtividades.Dm91WPfNiRty1bXv.healing.custom.formula, "@scaling + 2");
});

test("2014: tira o efeito; o oficial não tem atividade", () => {
  const p = planoDoItem(DDB, OFICIAL_2014);
  assert.deepEqual(p.apagarEfeitos, ["ddb1"]);
  assert.deepEqual(p.criarAtividades, {});
});

test("já igual ao oficial: nada a fazer (idempotente)", () => {
  assert.deepEqual(planoDoItem(structuredClone(OFICIAL_2024), OFICIAL_2024), { igual: true });
  assert.deepEqual(planoDoItem(structuredClone(OFICIAL_2014), OFICIAL_2014), { igual: true });
});

test("o antes guarda efeitos e atividades, sem ligação com o original", () => {
  const a = antesDoItem(DDB);
  assert.deepEqual(a.effects, DDB.effects);
  a.effects[0].name = "mudou";
  assert.equal(DDB.effects[0].name, "Disciple of Life");
});

test("escalas que faltam: só as do oficial que o personagem não tem", () => {
  const personagem = [{ type: "ScaleValue", configuration: { identifier: "die" } }];
  const oficial = [
    { _id: "a", type: "ScaleValue", configuration: { identifier: "die" } },
    { _id: "b", type: "ScaleValue", configuration: { identifier: "unarmored-movement" } },
    { _id: "c", type: "HitPoints" },
  ];
  assert.deepEqual(escalasQueFaltam(personagem, oficial).map((x) => x._id), ["b"]);
});
