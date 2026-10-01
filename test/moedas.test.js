/**
 * As regras das moedas (moedas.js), sem Foundry. A cola com o ator e a
 * foundry-inbound está no bridge-client.test.js.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirMoedas, mesmasMoedas, moedasValidas, mudouMoedas, sincronizadoValido } from "../scripts/moedas.js";

const m = (pp, gp, ep, sp, cp, versao) => ({ pp, gp, ep, sp, cp, ...(versao === undefined ? {} : { versao }) });

test("moedas válidas: as cinco, inteiras, de 0 ao teto; o resto é descartado", () => {
  assert.deepEqual(moedasValidas({ ...m(1, 2, 3, 4, 5), xp: 9 }), m(1, 2, 3, 4, 5));
  assert.equal(moedasValidas({ pp: 1, gp: 2, ep: 3, sp: 4 }), null, "falta cp");
  assert.equal(moedasValidas(m(0, -1, 0, 0, 0)), null, "negativo");
  assert.equal(moedasValidas(m(0, 1.5, 0, 0, 0)), null, "fração");
  assert.equal(moedasValidas(m(0, "3", 0, 0, 0)), null, "texto");
  assert.equal(moedasValidas(m(0, 1_000_000_001, 0, 0, 0)), null, "acima do teto");
  assert.equal(moedasValidas(null), null);
  assert.ok(mesmasMoedas(m(1, 2, 3, 4, 5), m(1, 2, 3, 4, 5, 9)), "a versão não entra na comparação");
  assert.ok(!mesmasMoedas(m(1, 2, 3, 4, 5), m(1, 2, 3, 4, 6)));
  assert.equal(sincronizadoValido(m(1, 2, 3, 4, 5)), null, "sem versão não é acordo");
});

test("primeiro contato: o Foundry vence (nada daqui é sobrescrito)", () => {
  assert.equal(decidirMoedas({ atual: m(0, 10, 0, 0, 0), sincronizado: undefined, recebido: m(0, 50, 0, 0, 0, 3) }), "foundry_vence");
});

test("o Foundry mudou depois do último acordo: o Foundry vence", () => {
  assert.equal(
    decidirMoedas({ atual: m(0, 9, 0, 0, 0), sincronizado: m(0, 10, 0, 0, 0, 3), recebido: m(0, 50, 0, 0, 0, 4) }),
    "foundry_vence",
  );
});

test("envio mais velho que o último acordo é ignorado", () => {
  assert.equal(decidirMoedas({ atual: m(0, 10, 0, 0, 0), sincronizado: m(0, 10, 0, 0, 0, 5), recebido: m(0, 50, 0, 0, 0, 5) }), "antigo");
  assert.equal(decidirMoedas({ atual: m(0, 10, 0, 0, 0), sincronizado: m(0, 10, 0, 0, 0, 5), recebido: m(0, 50, 0, 0, 0, 4) }), "antigo");
});

test("o Foundry não mudou e o envio é novo: aplica; se já são iguais, só anota a versão", () => {
  assert.equal(decidirMoedas({ atual: m(0, 10, 0, 0, 0), sincronizado: m(0, 10, 0, 0, 0, 5), recebido: m(1, 7, 2, 3, 4, 6) }), "aplicar");
  assert.equal(decidirMoedas({ atual: m(0, 10, 0, 0, 0), sincronizado: m(0, 10, 0, 0, 0, 5), recebido: m(0, 10, 0, 0, 0, 6) }), "igual");
});

test("envio sem as cinco moedas ou sem versão é inválido", () => {
  assert.equal(decidirMoedas({ atual: m(0, 1, 0, 0, 0), sincronizado: m(0, 1, 0, 0, 0, 1), recebido: m(0, 1, 0, 0, 0) }), "invalido");
  assert.equal(decidirMoedas({ atual: m(0, 1, 0, 0, 0), sincronizado: m(0, 1, 0, 0, 0, 1), recebido: { gp: 1, versao: 2 } }), "invalido");
});

test("o gancho reconhece mudança de moeda nos dois formatos do Foundry", () => {
  assert.ok(mudouMoedas({ system: { currency: { gp: 3 } } }));
  assert.ok(mudouMoedas({ "system.currency.gp": 3 }));
  assert.ok(!mudouMoedas({ system: { attributes: { hp: { value: 3 } } } }));
  assert.ok(!mudouMoedas({ flags: { x: 1 } }));
  assert.ok(!mudouMoedas(null));
});
