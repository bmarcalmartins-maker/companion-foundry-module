/**
 * A ficha completa no snapshot (ficha-completa.js, v1.15.0, schema 3), sem
 * Foundry: o deslocamento, todo efeito que pode valer no ator com o veredito
 * e a origem, as habilidades com os efeitos e o corte em degraus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deslocamentoDe, efeitosDaFicha, encolherFicha, habilidadesDoAtor } from "../scripts/ficha-completa.js";

const efeito = (id, name, changes, extra = {}) => ({
  id,
  name,
  disabled: false,
  transfer: true,
  active: true,
  toObject: () => ({ system: { changes } }),
  ...extra,
});

test("deslocamento: só número; unidade, pairar e especial", () => {
  assert.deepEqual(deslocamentoDe({ walk: 45, fly: 0, swim: "30", units: "ft", hover: false, special: "" }), { walk: 45, fly: 0, units: "ft" });
  assert.deepEqual(deslocamentoDe({ walk: 30, fly: 30, hover: true, special: " voa " }), { walk: 30, fly: 30, hover: true, special: "voa" });
  assert.equal(deslocamentoDe(null), undefined);
});

test("efeitos: origem do item, do ator (magia), suprimido e o valor resolvido", () => {
  const monge = { documentName: "Item", id: "f1", name: "Unarmored Movement", type: "feat" };
  const bota = { documentName: "Item", id: "i1", name: "Boots of Speed", type: "equipment" };
  const lista = [
    efeito("e1", "Unarmored Movement", [{ key: "system.attributes.movement.walk", type: "add", value: "@scale.monk.unarmored-movement" }], { parent: monge }),
    efeito("e2", "Boots", [{ key: "system.attributes.movement.walk", type: "multiply", value: "2" }], { parent: bota, active: false, isSuppressed: true }),
    efeito("e3", "Bless", [{ key: "system.bonuses.abilities.save", type: "add", value: "1d4" }], { parent: { documentName: "Actor" }, origin: "Actor.x.Item.s1", statuses: new Set(["blessed"]) }),
  ];
  const r = efeitosDaFicha(lista, (uuid) => (uuid === "Actor.x.Item.s1" ? "Bless" : null), (f) => (f === "@scale.monk.unarmored-movement" ? 15 : undefined));
  assert.deepEqual(r[0].origem, { tipo: "item", id: "f1", nome: "Unarmored Movement", tipo_do_item: "feat" });
  assert.equal(r[0].system.changes[0].resolvido, 15);
  assert.equal(r[1].suprimido, true);
  assert.equal(r[1].active, false);
  assert.equal(r[1].system.changes[0].resolvido, undefined);
  assert.deepEqual(r[2].origem, { tipo: "ator", uuid: "Actor.x.Item.s1", nome: "Bless" });
  assert.deepEqual(r[2].statuses, ["blessed"]);
});

test("efeitos: o de item NÃO IDENTIFICADO fica fora da ficha que o jogador lê (1.18.0)", () => {
  const anel = { documentName: "Item", id: "i2", name: "Anel estranho", type: "equipment", system: { identified: false } };
  const bota = { documentName: "Item", id: "i1", name: "Boots of Speed", type: "equipment", system: { identified: true } };
  const lista = [
    efeito("e1", "Ring of Protection", [{ key: "system.attributes.ac.bonus", type: "add", value: "1" }], { parent: anel }),
    efeito("e2", "Boots", [{ key: "system.attributes.movement.walk", type: "multiply", value: "2" }], { parent: bota }),
  ];
  const r = efeitosDaFicha(lista, () => null, () => undefined);
  assert.deepEqual(r.map((x) => x.name), ["Boots"]);
});

test("habilidades: só o que não é físico, com todos os efeitos", () => {
  const itens = [
    { id: "c", name: "Monk", type: "class", system: { identifier: "monk", levels: 6, source: { rules: "2014" } }, effects: [] },
    { id: "s", name: "Bless", type: "spell", system: { level: 1, source: { rules: "2024" } }, effects: [efeito("x", "Bless", [], { transfer: false })] },
    { id: "f", name: "Ki", type: "feat", system: { type: { value: "class" } }, effects: [] },
    { id: "w", name: "Dart", type: "weapon", system: {}, effects: [] },
  ];
  const h = habilidadesDoAtor(itens);
  assert.deepEqual(h.map((x) => x.id), ["c", "s", "f"]);
  assert.equal(h[0].niveis, 6);
  assert.equal(h[0].edicao, "2014");
  assert.equal(h[1].nivel, 1);
  assert.equal(h[1].effects[0].transfer, false);
  assert.equal(h[2].categoria, "class");
});

test("encolher: corta as habilidades em degraus e diz o quê", () => {
  const grande = "x".repeat(400);
  const snap = {
    efeitos: [{ name: "fica" }],
    habilidades: [{ id: "a", effects: [{ transfer: false, name: grande }, { transfer: true, name: "ok" }] }],
  };
  assert.deepEqual(encolherFicha(snap, 10_000).cortes, []);
  const um = encolherFicha(snap, 300);
  assert.equal(um.cortes.length, 1);
  assert.deepEqual(um.snapshot.habilidades[0].effects.map((e) => e.name), ["ok"]);
  const dois = encolherFicha(snap, 60);
  assert.equal(dois.cortes.length, 2);
  assert.equal(dois.snapshot.habilidades[0].effects, undefined);
  assert.deepEqual(dois.snapshot.efeitos, [{ name: "fica" }]);
});
