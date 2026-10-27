/**
 * O registro do bônus de cura como fórmula (efeitos-dnd5e.js), sem Foundry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAVES_DE_FORMULA, registrarCamposDeFormula } from "../scripts/efeitos-dnd5e.js";

test("registra system.bonuses.heal.damage na FORMULA_FIELDS do dnd5e", () => {
  const classe = { FORMULA_FIELDS: new Set(["system.attributes.ac.bonus"]) };
  assert.deepEqual(registrarCamposDeFormula(classe), ["system.bonuses.heal.damage"]);
  assert.ok(classe.FORMULA_FIELDS.has("system.bonuses.heal.damage"));
  assert.ok(classe.FORMULA_FIELDS.has("system.attributes.ac.bonus"), "o que o sistema já tinha continua");
});

test("rodar de novo não duplica nem devolve nada", () => {
  const classe = { FORMULA_FIELDS: new Set() };
  registrarCamposDeFormula(classe);
  assert.deepEqual(registrarCamposDeFormula(classe), []);
  assert.equal(classe.FORMULA_FIELDS.size, CHAVES_DE_FORMULA.length);
});

test("sem a lista (outro sistema ou dnd5e antigo) não faz nada", () => {
  assert.deepEqual(registrarCamposDeFormula({}), []);
  assert.deepEqual(registrarCamposDeFormula(undefined), []);
  assert.deepEqual(registrarCamposDeFormula({ FORMULA_FIELDS: ["x"] }), []);
});
