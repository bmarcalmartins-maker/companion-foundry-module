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

// ── ITEM NÃO IDENTIFICADO (1.18.0) ──
const identificavel = (extra = {}) => ({ temIdentificacao: true, identificado: true, ajusteAplicado: 0, ...extra });

test("identificação: versão 0 (a virada) nunca mexe no que o Foundry tem", () => {
  const plano = planejarInventario({
    existentes: [nativo("f1", "c1", identificavel({ identificado: false }))],
    recebidos: [recebido("c1", { identificacao: { identificado: true, versao: 0 } })],
  });
  assert.deepEqual(plano.atualizar, []);
});

test("identificação: a versão mais nova do Companion marca não identificado, com a fachada", () => {
  const plano = planejarInventario({
    existentes: [copia("f1", "c1", identificavel({ identificacaoAplicada: 2 }))],
    recebidos: [recebido("c1", {
      identificacao: { identificado: false, versao: 3 },
      fachada: { name: "Espada estranha", description: "<p>Quente.</p>" },
    })],
  });
  assert.deepEqual(plano.atualizar, [{
    _id: "f1", identificado: false, fachada: { name: "Espada estranha", description: "<p>Quente.</p>" }, identificacaoAplicada: 3,
  }]);
});

test("identificação: o envio VELHO (versão já aplicada) não desfaz o que o GM fez aqui", () => {
  const plano = planejarInventario({
    existentes: [nativo("f1", "c1", identificavel({ identificado: true, identificacaoAplicada: 3 }))],
    recebidos: [recebido("c1", { identificacao: { identificado: false, versao: 3 } })],
  });
  assert.deepEqual(plano.atualizar, []);
});

test("identificação: revelar no Companion vale também no NATIVO; sem o campo no item, nada", () => {
  const plano = planejarInventario({
    existentes: [
      nativo("f1", "c1", identificavel({ identificado: false, identificacaoAplicada: 1 })),
      nativo("f2", "c2", { temIdentificacao: false, ajusteAplicado: 0 }),
    ],
    recebidos: [
      recebido("c1", { identificacao: { identificado: true, versao: 2 } }),
      recebido("c2", { identificacao: { identificado: false, versao: 5 } }),
    ],
  });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", identificado: true, identificacaoAplicada: 2 }]);
});

test("identificação: o módulo de antes do Companion (sem `identificacao`) não mexe em nada", () => {
  const plano = planejarInventario({
    existentes: [copia("f1", "c1", identificavel({ identificado: false }))],
    recebidos: [recebido("c1")],
  });
  assert.deepEqual(plano.atualizar, []);
});
