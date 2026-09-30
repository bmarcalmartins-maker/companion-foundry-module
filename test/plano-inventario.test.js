import { test } from "node:test";
import assert from "node:assert/strict";
import { planejarInventario } from "../scripts/plano-inventario.js";

const nativo = (id, cracha, extra = {}) => ({
  id, cracha, synced: false, sincronizavel: true, temEquipado: true, equipado: false,
  temQuantidade: true, quantidade: 1, ...extra,
});
const copia = (id, cracha, extra = {}) => nativo(id, cracha, { synced: true, ...extra });
const recebido = (cracha, extra = {}) => ({ cracha, equipado: false, quantidade: 1, ajuste: 0, dados: { name: cracha }, ...extra });

test("item novo no Companion é criado", () => {
  const plano = planejarInventario({ existentes: [], recebidos: [recebido("c1")] });
  assert.equal(plano.criar.length, 1);
  assert.deepEqual(plano.atualizar, []);
  assert.deepEqual(plano.apagar, []);
});

test("item que o ator já tem é atualizado no lugar, nunca recriado", () => {
  const plano = planejarInventario({
    existentes: [copia("f1", "c1", { ajusteAplicado: 0 })],
    recebidos: [recebido("c1", { equipado: true })],
  });
  assert.deepEqual(plano.criar, []);
  assert.deepEqual(plano.apagar, []);
  assert.deepEqual(plano.atualizar, [{ _id: "f1", equipado: true }]);
});

test("nada mudou: nada a fazer (a sintonia, as cargas e os usos do Foundry ficam)", () => {
  const plano = planejarInventario({
    existentes: [copia("f1", "c1", { quantidade: 3, ajusteAplicado: 2 })],
    recebidos: [recebido("c1", { quantidade: 9, ajuste: 2 })],
  });
  assert.deepEqual(plano, { criar: [], atualizar: [], apagar: [] });
});

test("quantidade: a do Companion não é imposta; só a diferença do que o Companion mudou", () => {
  // Poção: o Foundry gastou 2 (tem 1); o Companion comprou +3 (ajuste 0 → 3).
  const plano = planejarInventario({
    existentes: [copia("f1", "c1", { quantidade: 1, ajusteAplicado: 0 })],
    recebidos: [recebido("c1", { quantidade: 6, ajuste: 3 })],
  });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", quantidade: 4, ajusteAplicado: 3 }]);
});

test("reenviar o mesmo ajuste não aplica duas vezes", () => {
  const plano = planejarInventario({
    existentes: [copia("f1", "c1", { quantidade: 4, ajusteAplicado: 3 })],
    recebidos: [recebido("c1", { quantidade: 6, ajuste: 3 })],
  });
  assert.deepEqual(plano.atualizar, []);
});

test("diferença negativa não passa de zero", () => {
  const plano = planejarInventario({
    existentes: [nativo("f1", "c1", { quantidade: 1, ajusteAplicado: 5 })],
    recebidos: [recebido("c1", { ajuste: 2 })],
  });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", quantidade: 0, ajusteAplicado: 2 }]);
});

test("item de antes do LOTE 08 (sem ajusteAplicado): só marca a base, sem mexer na quantidade", () => {
  const plano = planejarInventario({
    existentes: [nativo("f1", "c1", { quantidade: 7 })],
    recebidos: [recebido("c1", { quantidade: 2, ajuste: -1 })],
  });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", ajusteAplicado: -1 }]);
});

test("Companion anterior ao LOTE 08 (sem ajuste no envio): quantidade intocada", () => {
  const plano = planejarInventario({
    existentes: [nativo("f1", "c1", { quantidade: 7, ajusteAplicado: 1 })],
    recebidos: [recebido("c1", { quantidade: 2, ajuste: undefined, equipado: true })],
  });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", equipado: true }]);
});

test("cópia deste módulo que o Companion não manda mais sai", () => {
  const plano = planejarInventario({ existentes: [copia("f1", "c1")], recebidos: [] });
  assert.deepEqual(plano.apagar, ["f1"]);
});

test("nativo fora do envio NÃO sai só por não estar lá (crachá velho não apaga nada)", () => {
  const plano = planejarInventario({ existentes: [nativo("f1", "c1")], recebidos: [] });
  assert.deepEqual(plano.apagar, []);
});

test("nativo que SAIU do personagem no Companion (descartado, trocado) sai do ator", () => {
  const plano = planejarInventario({ existentes: [nativo("f1", "c1")], recebidos: [], saidas: new Set(["c1"]) });
  assert.deepEqual(plano.apagar, ["f1"]);
});

test("nativo que saiu e VOLTOU (está no envio) fica", () => {
  const plano = planejarInventario({
    existentes: [nativo("f1", "c1", { ajusteAplicado: 0 })],
    recebidos: [recebido("c1")],
    saidas: new Set(["c1"]),
  });
  assert.deepEqual(plano.apagar, []);
  assert.deepEqual(plano.criar, []);
});

test("arma natural, magia e talento nunca saem, nem com saída", () => {
  const plano = planejarInventario({
    existentes: [nativo("f1", "c1", { sincronizavel: false })],
    recebidos: [],
    saidas: new Set(["c1"]),
  });
  assert.deepEqual(plano.apagar, []);
});

test("item sem crachá não é tocado; cópia sem crachá é sobra e sai", () => {
  const plano = planejarInventario({
    existentes: [nativo("f1", null), copia("f2", null)],
    recebidos: [],
    saidas: new Set(["c1"]),
  });
  assert.deepEqual(plano.apagar, ["f2"]);
});

test("crachá repetido: fica o nativo; as cópias a mais saem", () => {
  const plano = planejarInventario({
    existentes: [copia("f1", "c1", { ajusteAplicado: 0 }), nativo("f2", "c1", { ajusteAplicado: 0 }), copia("f3", "c1", { ajusteAplicado: 0 })],
    recebidos: [recebido("c1", { equipado: true })],
  });
  assert.deepEqual(plano.apagar.sort(), ["f1", "f3"]);
  assert.deepEqual(plano.atualizar, [{ _id: "f2", equipado: true }]);
});

test("apagado no Foundry há pouco não é recriado pelo envio que ainda o traz", () => {
  const plano = planejarInventario({
    existentes: [],
    recebidos: [recebido("c1"), recebido("c2")],
    apagadosHaPouco: new Set(["c1"]),
  });
  assert.deepEqual(plano.criar.map((r) => r.cracha), ["c2"]);
});

test("nome e imagem acompanham o Companion só na cópia deste módulo", () => {
  const plano = planejarInventario({
    existentes: [
      copia("f1", "c1", { nome: "Corda", img: "https://x/velha.webp", ajusteAplicado: 0 }),
      nativo("f2", "c2", { nome: "Rope", img: "icons/rope.webp", ajusteAplicado: 0 }),
    ],
    recebidos: [
      recebido("c1", { nome: "Corda de seda", img: "https://x/nova.webp" }),
      recebido("c2", { nome: "Corda", img: "https://x/outra.webp" }),
    ],
  });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", nome: "Corda de seda", img: "https://x/nova.webp" }]);
});

test("ícone genérico do Foundry não troca a arte da cópia", () => {
  const plano = planejarInventario({
    existentes: [copia("f1", "c1", { nome: "Corda", img: "https://x/boa.webp", ajusteAplicado: 0 })],
    recebidos: [recebido("c1", { nome: "Corda", img: "icons/svg/item-bag.svg" })],
  });
  assert.deepEqual(plano.atualizar, []);
});

test("equipado só vai a item que tem o campo (consumível não tem)", () => {
  const plano = planejarInventario({
    existentes: [nativo("f1", "c1", { temEquipado: false, equipado: undefined, ajusteAplicado: 0 })],
    recebidos: [recebido("c1", { equipado: true })],
  });
  assert.deepEqual(plano.atualizar, []);
});
