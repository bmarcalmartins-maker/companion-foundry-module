/**
 * A auditoria (auditoria.js, v1.15.0), sem Foundry: os "@" que não resolvem
 * (a regra do dnd5e 5.3.0, utils.mjs:399-410), os efeitos que só um módulo de
 * automação faz funcionar, as fórmulas de uma atividade, a edição e as escalas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diferencasDeAtividades,
  edicaoDoItem,
  escalasDosAvancos,
  formulaDaParte,
  formulasDoObjeto,
  mudancaInerte,
  partesDaEscala,
  referenciasAusentes,
  referenciasDaFormula,
  tipoDaMudanca,
  avisoInteressa,
} from "../scripts/auditoria.js";

test("referências: acha os @ sem repetir", () => {
  assert.deepEqual(referenciasDaFormula("2 + @item.level + @item.level + @mod"), ["item.level", "mod"]);
  assert.deepEqual(referenciasDaFormula("1d6"), []);
  assert.deepEqual(referenciasDaFormula(null), []);
});

test("ausente = null/undefined, como o dnd5e; zero não é ausente", () => {
  const dados = { item: { level: 0 }, scale: { monk: { die: "1d6" } } };
  assert.deepEqual(referenciasAusentes("@item.level + @scale.monk.die", dados), []);
  assert.deepEqual(referenciasAusentes("@scale.monk.unarmored-movement", dados), ["scale.monk.unarmored-movement"]);
  assert.deepEqual(referenciasAusentes("2 + @item.level", { abilities: {} }), ["item.level"]);
});

test("tipo da mudança: v14 (type) e v13 (mode)", () => {
  assert.equal(tipoDaMudanca({ type: "add" }), "add");
  assert.equal(tipoDaMudanca({ mode: 0 }), "custom");
  assert.equal(tipoDaMudanca({ mode: 2 }), "add");
  assert.equal(tipoDaMudanca({}), "desconhecido");
});

test("efeito inerte: custom e chave de módulo que não está ativo", () => {
  assert.deepEqual(mudancaInerte({ key: "flags.midi-qol.advantage.all", type: "custom" }), { motivo: "chave_de_modulo_ausente", modulo: "midi-qol" });
  assert.deepEqual(mudancaInerte({ key: "macro.itemMacro", mode: 0 }), { motivo: "chave_de_modulo_ausente", modulo: "dae" });
  assert.equal(mudancaInerte({ key: "flags.midi-qol.x", type: "add" }, new Set(["midi-qol"])), null);
  assert.deepEqual(mudancaInerte({ key: "system.attributes.hp.bonuses.level", type: "custom" }), { motivo: "tipo_custom", modulo: null });
  assert.equal(mudancaInerte({ key: "system.bonuses.heal.damage", type: "add" }), null);
});

test("fórmulas de um objeto: pula descrição e chat", () => {
  const atv = {
    description: { chatFlavor: "@actor.name" },
    damage: { parts: [{ custom: { enabled: true, formula: "@scale.monk.die + @mod" }, bonus: "" }] },
    uses: { max: "@prof" },
    name: "@nome",
  };
  assert.deepEqual(formulasDoObjeto(atv), [
    { caminho: "damage.parts.0.custom.formula", formula: "@scale.monk.die + @mod" },
    { caminho: "uses.max", formula: "@prof" },
  ]);
  assert.deepEqual(formulasDoObjeto({ uses: { max: "@x" }, activities: { a: { uses: { max: "@y" } } } }, { pular: ["activities"] }), [{ caminho: "uses.max", formula: "@x" }]);
});

test("edição do item e escalas da classe", () => {
  assert.equal(edicaoDoItem({ system: { source: { rules: "2024" } } }), "2024");
  assert.equal(edicaoDoItem({ system: { source: { rules: "" } } }), null);
  const avancos = [
    { type: "HitPoints" },
    { type: "ScaleValue", configuration: { identifier: "die" } },
    { type: "ScaleValue", identifier: "unarmored-movement" },
  ];
  assert.deepEqual(escalasDosAvancos(avancos), ["die", "unarmored-movement"]);
  assert.deepEqual(escalasDosAvancos({ a: avancos[1] }), ["die"]);
  assert.deepEqual(partesDaEscala("scale.monk.unarmored-movement"), { classe: "monk", id: "unarmored-movement" });
  assert.equal(partesDaEscala("item.level"), null);
});

test("parte de dano e diferenças com o oficial", () => {
  assert.equal(formulaDaParte({ number: 1, denomination: 8, bonus: "@mod" }), "1d8 + @mod");
  assert.equal(formulaDaParte({ custom: { enabled: true, formula: "@scaling + 2" } }), "@scaling + 2");
  const p = [{ type: "heal", healing: { number: 2, denomination: 8, bonus: "" } }];
  const o = [{ type: "heal", healing: { number: 1, denomination: 8, bonus: "" } }, { type: "utility" }];
  const d = diferencasDeAtividades(p, o);
  assert.deepEqual(d.map((x) => x.campo).sort(), ["atividades.heal[0].cura", "atividades.utility.quantidade"]);
});

test("avisos que interessam", () => {
  assert.ok(avisoInteressa("The attribute @item.level was not present in the provided roll data."));
  assert.ok(avisoInteressa("x failed to validate"));
  assert.ok(!avisoInteressa("companion-foundry-bridge | initialized"));
});
