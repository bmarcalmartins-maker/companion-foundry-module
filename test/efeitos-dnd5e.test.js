/**
 * O bônus de cura como fórmula e a regra do Disciple of Life (efeitos-dnd5e.js),
 * sem Foundry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAVES_DE_FORMULA,
  bonusDeCuraVale,
  registrarCamposDeFormula,
  registrarRegrasDeCura,
  tirarBonusDeCura,
} from "../scripts/efeitos-dnd5e.js";

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

const magia = (extra = {}) => ({ tipoDoItem: "spell", nivel: 1, metodo: "spell", tiposDeCura: ["healing"], identificador: "cure-wounds", ...extra });

test("vale: magia de 1º+ com espaço que restaura PV (Cure Wounds, Healing Word, Mass Healing Word)", () => {
  assert.ok(bonusDeCuraVale(magia()));
  assert.ok(bonusDeCuraVale(magia({ identificador: "healing-word" })));
  assert.ok(bonusDeCuraVale(magia({ identificador: "mass-healing-word", nivel: 3 })));
  assert.ok(bonusDeCuraVale(magia({ metodo: "pact" })), "pacto gasta espaço");
  assert.ok(bonusDeCuraVale(magia({ tiposDeCura: new Set(["healing"]) })), "aceita Set (o dnd5e usa Set)");
});

test("não vale: não é magia, truque, ou sem espaço de magia", () => {
  assert.ok(!bonusDeCuraVale(magia({ tipoDoItem: "consumable" })), "poção");
  assert.ok(!bonusDeCuraVale(magia({ tipoDoItem: "feat" })));
  assert.ok(!bonusDeCuraVale(magia({ nivel: 0 })), "truque");
  for (const metodo of ["atwill", "innate", "ritual"]) assert.ok(!bonusDeCuraVale(magia({ metodo })), metodo);
});

test("não vale: não restaura PV (PV temporário, PV máximo, Aid, Revivify)", () => {
  assert.ok(!bonusDeCuraVale(magia({ tiposDeCura: ["temphp"], identificador: "enhance-ability", nivel: 2 })));
  assert.ok(!bonusDeCuraVale(magia({ tiposDeCura: ["maximum"] })));
  assert.ok(!bonusDeCuraVale(magia({ identificador: "aid", nivel: 2 })));
  assert.ok(!bonusDeCuraVale(magia({ identificador: "revivify", nivel: 3 })));
});

test("tira o bônus só das partes da primeira rolagem, depois da fórmula", () => {
  const config = { rolls: [{ parts: ["1d8 + @mod", "2 + @item.level"] }, { parts: ["2 + @item.level"] }] };
  assert.ok(tirarBonusDeCura(config, "2 + @item.level"));
  assert.deepEqual(config.rolls[0].parts, ["1d8 + @mod"]);
  assert.deepEqual(config.rolls[1].parts, ["2 + @item.level"], "outras rolagens não mexe");
  assert.ok(!tirarBonusDeCura(config, "2 + @item.level"), "já tirou");
  const soFormula = { rolls: [{ parts: ["2 + @item.level"] }] };
  assert.ok(!tirarBonusDeCura(soFormula, "2 + @item.level"), "a fórmula da magia (índice 0) nunca sai");
  assert.ok(!tirarBonusDeCura({}, "x"));
});

test("registrarRegrasDeCura liga a fórmula e o hook da rolagem de dano", () => {
  const classe = { FORMULA_FIELDS: new Set() };
  const ligados = [];
  registrarRegrasDeCura(classe, { on: (nome) => ligados.push(nome) });
  assert.ok(classe.FORMULA_FIELDS.has("system.bonuses.heal.damage"));
  assert.deepEqual(ligados, ["dnd5e.preRollDamageV2"]);
});
