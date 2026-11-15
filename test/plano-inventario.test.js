import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirSintonia, fraseDoLimiteDeSintonia, pedidoDeSintonia, planejarInventario } from "../scripts/plano-inventario.js";

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

/* ── SINTONIA e EFEITOS DO MESTRE (1.26.0) ── */

const comSintonia = (extra = {}) => ({ temSintonia: true, sintonizado: false, exigeSintonia: "required", propriedades: ["mgc"], ...extra });
const pede = (pedido, versao) => ({ sintonia: { exige: "required", pedido, versao } });

test("sintonia: a decisão pura (não mexe, desfaz, sintoniza, barra no limite)", () => {
  assert.deepEqual(decidirSintonia({ pedido: null }), { sintonizar: null, barrado: false });
  assert.deepEqual(decidirSintonia({ pedido: true, jaSintonizado: true, sintonizados: 9, limite: 3 }), { sintonizar: null, barrado: false }, "já está: nada a fazer, nem barrar");
  assert.deepEqual(decidirSintonia({ pedido: false, jaSintonizado: true }), { sintonizar: false, barrado: false });
  assert.deepEqual(decidirSintonia({ pedido: false, jaSintonizado: false }), { sintonizar: null, barrado: false });
  assert.deepEqual(decidirSintonia({ pedido: true, sintonizados: 2, limite: 3 }), { sintonizar: true, barrado: false });
  assert.deepEqual(decidirSintonia({ pedido: true, sintonizados: 3, limite: 3 }), { sintonizar: null, barrado: true });
  assert.deepEqual(decidirSintonia({ pedido: true, sintonizados: 3, limite: 4 }), { sintonizar: true, barrado: false }, "o limite é o do ator");
  assert.deepEqual(decidirSintonia({ pedido: true, sintonizados: 3, limite: undefined }), { sintonizar: null, barrado: true }, "sem limite no ator: 3");
  assert.deepEqual(decidirSintonia({ pedido: true, sintonizados: 0, limite: 0 }), { sintonizar: null, barrado: true });
  assert.equal(pedidoDeSintonia({ pedido: true, versao: 1 }), true);
  for (const s of [null, undefined, { pedido: null, versao: 3 }, { pedido: true, versao: 0 }, { pedido: true }, { pedido: "sim", versao: 2 }, { pedido: false, versao: 1.5 }]) {
    assert.equal(pedidoDeSintonia(s), false, JSON.stringify(s));
  }
  assert.equal(fraseDoLimiteDeSintonia("Guldrum", 3, "Anel"), "Guldrum: limite de 3 itens sintonizados. Anel não foi sintonizado.");
  assert.equal(fraseDoLimiteDeSintonia("Guldrum", 1, "Anel"), "Guldrum: limite de 1 item sintonizado. Anel não foi sintonizado.");
});

test("sintonia: sem pedido (nulo, versão 0 ou envio antigo) o plano NUNCA toca na sintonia", () => {
  for (const sintonia of [undefined, { exige: "required", pedido: null, versao: 0 }, { exige: "required", pedido: true, versao: 0 }, { exige: "required", pedido: null, versao: 4 }]) {
    const plano = planejarInventario({
      existentes: [copia("f1", "c1", comSintonia({ ajusteAplicado: 0, sintonizado: true })), nativo("f2", "c2", comSintonia({ ajusteAplicado: 0 }))],
      recebidos: [recebido("c1", { sintonia }), recebido("c2", { sintonia })],
    });
    assert.deepEqual(plano, { criar: [], atualizar: [], apagar: [] }, JSON.stringify(sintonia));
  }
});

test("sintonia: o pedido mais novo que o aplicado muda attuned e marca a versão; o velho e o repetido, não", () => {
  // novo: sintoniza
  let plano = planejarInventario({
    existentes: [nativo("f1", "c1", comSintonia({ ajusteAplicado: 0 }))],
    recebidos: [recebido("c1", pede(true, 1))],
  });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", sintoniaAplicada: 1, sintonizado: true }]);
  // novo: desfaz
  plano = planejarInventario({
    existentes: [nativo("f1", "c1", comSintonia({ ajusteAplicado: 0, sintonizado: true, sintoniaAplicada: 1 }))],
    recebidos: [recebido("c1", pede(false, 2))],
  });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", sintonizado: false, sintoniaAplicada: 2 }]);
  // já aplicado (o GM sintonizou de novo aqui depois): não desfaz
  plano = planejarInventario({
    existentes: [nativo("f1", "c1", comSintonia({ ajusteAplicado: 0, sintonizado: true, sintoniaAplicada: 2 }))],
    recebidos: [recebido("c1", pede(false, 2))],
  });
  assert.deepEqual(plano.atualizar, []);
  // pedido novo que já bate com o Foundry: só marca a versão
  plano = planejarInventario({
    existentes: [nativo("f1", "c1", comSintonia({ ajusteAplicado: 0, sintonizado: true }))],
    recebidos: [recebido("c1", pede(true, 3))],
  });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", sintoniaAplicada: 3 }]);
  // item sem o campo de sintonia (um tesouro): nada
  plano = planejarInventario({
    existentes: [nativo("f1", "c1", { ajusteAplicado: 0 })],
    recebidos: [recebido("c1", pede(true, 3))],
  });
  assert.deepEqual(plano.atualizar, []);
});

test("sintonia: na CASCA do módulo o pedido leva a exigência e o mgc; no nativo e no do compêndio, não", () => {
  const r = recebido("c1", { ...pede(true, 1), exigeSintonia: "required", mgc: true });
  let plano = planejarInventario({ existentes: [copia("f1", "c1", comSintonia({ ajusteAplicado: 0, exigeSintonia: "", propriedades: ["foc"] }))], recebidos: [r] });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", sintoniaAplicada: 1, exigeSintonia: "required", propriedades: ["foc", "mgc"], sintonizado: true }]);
  plano = planejarInventario({ existentes: [copia("f1", "c1", comSintonia({ ajusteAplicado: 0, exigeSintonia: "", propriedades: [], compendio: true }))], recebidos: [r] });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", sintoniaAplicada: 1, sintonizado: true }]);
  plano = planejarInventario({ existentes: [nativo("f1", "c1", comSintonia({ ajusteAplicado: 0, exigeSintonia: "", propriedades: [] }))], recebidos: [r] });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", sintoniaAplicada: 1, sintonizado: true }]);
});

test("sintonia: o LIMITE barra, marca a versão e avisa; conta os já aplicados deste envio, os desfeitos e os que saem", () => {
  const cheio = () => [
    nativo("a", "ca", comSintonia({ ajusteAplicado: 0, sintonizado: true })),
    nativo("b", "cb", comSintonia({ ajusteAplicado: 0, sintonizado: true })),
    // sem crachá (o Companion nem conhece), mas ocupa vaga
    { id: "z", cracha: null, synced: false, sincronizavel: true, temSintonia: true, sintonizado: true },
    nativo("d", "cd", comSintonia({ ajusteAplicado: 0 })),
    nativo("e", "ce", comSintonia({ ajusteAplicado: 0 })),
  ];
  const mesmos = [recebido("ca"), recebido("cb")];
  // 3 de 3: o pedido não sintoniza, mas grava a versão (não tenta de novo)
  let plano = planejarInventario({ existentes: cheio(), recebidos: [...mesmos, recebido("cd", pede(true, 1)), recebido("ce")], limite: 3 });
  assert.deepEqual(plano.atualizar, [{ _id: "d", sintoniaAplicada: 1, sintoniaBarrada: true }]);
  // limite 4 (o do ator): cabe um; o segundo do mesmo envio é barrado
  plano = planejarInventario({ existentes: cheio(), recebidos: [...mesmos, recebido("cd", pede(true, 1)), recebido("ce", pede(true, 1))], limite: 4 });
  assert.deepEqual(plano.atualizar, [{ _id: "d", sintoniaAplicada: 1, sintonizado: true }, { _id: "e", sintoniaAplicada: 1, sintoniaBarrada: true }]);
  // sem `limite`: 3
  plano = planejarInventario({ existentes: cheio(), recebidos: [...mesmos, recebido("cd", pede(true, 1)), recebido("ce")] });
  assert.equal(plano.atualizar[0].sintoniaBarrada, true);
  // um "desfazer" no mesmo envio libera a vaga, mesmo vindo DEPOIS na lista
  plano = planejarInventario({ existentes: cheio(), recebidos: [recebido("cd", pede(true, 1)), recebido("ca", pede(false, 1)), recebido("cb"), recebido("ce")], limite: 3 });
  assert.deepEqual(plano.atualizar, [{ _id: "d", sintoniaAplicada: 1, sintonizado: true }, { _id: "a", sintonizado: false, sintoniaAplicada: 1 }]);
  // o item sintonizado que SAI do ator neste envio também libera
  plano = planejarInventario({ existentes: cheio(), recebidos: [recebido("cb"), recebido("cd", pede(true, 1)), recebido("ce")], saidas: new Set(["ca"]), limite: 3 });
  assert.deepEqual(plano.apagar, ["a"]);
  assert.deepEqual(plano.atualizar, [{ _id: "d", sintoniaAplicada: 1, sintonizado: true }]);
});

test("sintonia: o item NOVO sai com a decisão (`sintonizar`) e respeita o limite; sem pedido, é o próprio recebido", () => {
  const existentes = [
    nativo("a", "ca", comSintonia({ ajusteAplicado: 0, sintonizado: true })),
    nativo("b", "cb", comSintonia({ ajusteAplicado: 0, sintonizado: true })),
  ];
  const semPedido = recebido("n0", pede(null, 0));
  const plano = planejarInventario({
    existentes,
    recebidos: [recebido("ca"), recebido("cb"), semPedido, recebido("n1", pede(true, 2)), recebido("n2", pede(true, 1)), recebido("n3", pede(false, 1))],
    limite: 3,
  });
  assert.equal(plano.criar[0], semPedido, "sem pedido: o recebido como veio (a casca vai inteira)");
  assert.deepEqual(plano.criar.slice(1).map((r) => [r.cracha, r.sintonizar, r.sintoniaBarrada]), [["n1", true, undefined], ["n2", false, true], ["n3", false, undefined]]);
  assert.deepEqual(plano.atualizar, []);
});

const efeito = (nome) => ({ name: nome, type: "base", transfer: true, system: { changes: [] }, flags: { "companion-foundry-bridge": { do_companion: true } } });

test("efeitos do Mestre: versão nova troca os do Companion pelos novos e leva exigência, raridade e mgc", () => {
  const e = copia("f1", "c1", comSintonia({
    ajusteAplicado: 0, exigeSintonia: "", raridade: "", propriedades: ["foc"],
    efeitos: [{ id: "e1", doCompanion: true, transfer: true }, { id: "e2", doCompanion: false, transfer: true }, { id: "e3", doCompanion: false, transfer: false }],
  }));
  const novos = [efeito("CA +2")];
  const r = recebido("c1", { efeitos: { versao: 2 }, efeitosNovos: novos, exigeSintonia: "required", raridade: "rare", mgc: true });
  // casca que NUNCA recebeu efeitos por versão (criada pelo 1.25): só os marcados saem
  let plano = planejarInventario({ existentes: [e], recebidos: [r] });
  assert.deepEqual(plano.atualizar, [{
    _id: "f1", efeitos: { apagar: ["e1"], criar: novos }, exigeSintonia: "required", raridade: "rare", propriedades: ["foc", "mgc"], efeitosAplicada: 2,
  }]);
  // casca que já recebeu (efeitosAplicada 1): os de transferência sem marca saem também; o que não transfere fica
  plano = planejarInventario({ existentes: [{ ...e, efeitosAplicada: 1 }], recebidos: [r] });
  assert.deepEqual(plano.atualizar[0].efeitos.apagar, ["e1", "e2"]);
  // item do compêndio ou nativo: só os marcados, sempre
  plano = planejarInventario({ existentes: [{ ...e, efeitosAplicada: 1, compendio: true }], recebidos: [r] });
  assert.deepEqual(plano.atualizar[0].efeitos.apagar, ["e1"]);
  plano = planejarInventario({ existentes: [{ ...e, efeitosAplicada: 1, synced: false }], recebidos: [r] });
  assert.deepEqual(plano.atualizar[0].efeitos.apagar, ["e1"]);
  // nada a mudar além dos efeitos: só eles e a versão
  plano = planejarInventario({ existentes: [{ ...e, exigeSintonia: "required", raridade: "rare", propriedades: ["mgc"] }], recebidos: [r] });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", efeitos: { apagar: ["e1"], criar: novos }, efeitosAplicada: 2 }]);
  // lista vazia: os bônus do Mestre saem
  plano = planejarInventario({ existentes: [e], recebidos: [{ ...r, efeitosNovos: [] }] });
  assert.deepEqual(plano.atualizar[0].efeitos, { apagar: ["e1"], criar: [] });
});

test("efeitos do Mestre: versão já aplicada, versão 0, sem a flag ou sem a lista não mexem em efeito nenhum", () => {
  const e = copia("f1", "c1", comSintonia({ ajusteAplicado: 0, efeitosAplicada: 2, efeitos: [{ id: "e1", doCompanion: true, transfer: true }] }));
  const novos = [efeito("CA +2")];
  for (const extra of [
    { efeitos: { versao: 2 }, efeitosNovos: novos },
    { efeitos: { versao: 1 }, efeitosNovos: novos },
    { efeitos: { versao: 0 }, efeitosNovos: novos },
    { efeitosNovos: novos, raridade: "rare" },
    { efeitos: { versao: 3 } },
  ]) {
    const plano = planejarInventario({ existentes: [e], recebidos: [recebido("c1", { exigeSintonia: "required", mgc: true, ...extra })] });
    assert.deepEqual(plano.atualizar, [], JSON.stringify(extra));
  }
});

test("sintonia e efeitos no mesmo envio: um item, uma atualização", () => {
  const novos = [efeito("CA +1")];
  const plano = planejarInventario({
    existentes: [copia("f1", "c1", comSintonia({ ajusteAplicado: 0, exigeSintonia: "", propriedades: [], efeitos: [] }))],
    recebidos: [recebido("c1", { ...pede(true, 1), efeitos: { versao: 1 }, efeitosNovos: novos, exigeSintonia: "required", raridade: "rare", mgc: true, equipado: true })],
  });
  assert.deepEqual(plano.atualizar, [{
    _id: "f1", equipado: true, sintoniaAplicada: 1, exigeSintonia: "required", propriedades: ["mgc"],
    efeitos: { apagar: [], criar: novos }, raridade: "rare", efeitosAplicada: 1, sintonizado: true,
  }]);
});

/* ── o contrato do Companion (push-to-foundry, aplicarSintoniaEBonus) ── */

test("o +N mágico (system.magicalBonus) acompanha a versão dos efeitos: entra, muda, e sai da casca quando o envio não o traz", () => {
  const casca = (extra = {}) => copia("f1", "c1", comSintonia({ ajusteAplicado: 0, exigeSintonia: "", propriedades: ["mgc"], efeitos: [], efeitosAplicada: 1, ...extra }));
  const r = (versao, extra = {}) => recebido("c1", { efeitos: { versao }, efeitosNovos: [], mgc: true, ...extra });
  // entra (o item não tinha) e muda (tinha outro)
  let plano = planejarInventario({ existentes: [casca()], recebidos: [r(2, { bonusMagico: 1 })] });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", efeitos: { apagar: [], criar: [] }, bonusMagico: 1, efeitosAplicada: 2 }]);
  plano = planejarInventario({ existentes: [casca({ bonusMagico: null })], recebidos: [r(2, { bonusMagico: 2 })] });
  assert.equal(plano.atualizar[0].bonusMagico, 2);
  plano = planejarInventario({ existentes: [casca({ bonusMagico: 1 })], recebidos: [r(2, { bonusMagico: 3 })] });
  assert.equal(plano.atualizar[0].bonusMagico, 3);
  // igual: não entra na atualização
  plano = planejarInventario({ existentes: [casca({ bonusMagico: 2 })], recebidos: [r(2, { bonusMagico: 2 })] });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", efeitos: { apagar: [], criar: [] }, efeitosAplicada: 2 }]);
  // o envio não traz mais o campo (o Mestre tirou o +N): na casca volta a nulo
  plano = planejarInventario({ existentes: [casca({ bonusMagico: 2 })], recebidos: [r(2)] });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", efeitos: { apagar: [], criar: [] }, bonusMagico: null, efeitosAplicada: 2 }]);
  // casca que nunca teve (nulo ou 0): nada a zerar
  for (const bonusMagico of [undefined, null, 0]) {
    plano = planejarInventario({ existentes: [casca({ bonusMagico })], recebidos: [r(2)] });
    assert.ok(!("bonusMagico" in plano.atualizar[0]), String(bonusMagico));
  }
  // no nativo e no item do compêndio, o envio sem o campo NÃO tira o bônus deles; com o campo, vale o do envio
  plano = planejarInventario({ existentes: [casca({ bonusMagico: 2, synced: false })], recebidos: [r(2)] });
  assert.ok(!("bonusMagico" in plano.atualizar[0]));
  plano = planejarInventario({ existentes: [casca({ bonusMagico: 2, compendio: true })], recebidos: [r(2)] });
  assert.ok(!("bonusMagico" in plano.atualizar[0]));
  plano = planejarInventario({ existentes: [casca({ bonusMagico: 2, compendio: true })], recebidos: [r(2, { bonusMagico: 1 })] });
  assert.equal(plano.atualizar[0].bonusMagico, 1);
  // sem versão nova dos efeitos (ou sem flags.efeitos), o +N do envio não mexe em nada
  plano = planejarInventario({ existentes: [casca({ bonusMagico: 2 })], recebidos: [r(1, { bonusMagico: 5 })] });
  assert.deepEqual(plano.atualizar, []);
  plano = planejarInventario({ existentes: [casca({ bonusMagico: 2 })], recebidos: [recebido("c1", { bonusMagico: 5, mgc: true })] });
  assert.deepEqual(plano.atualizar, []);
});

test("flags.sintonia vai em TODO item ({ exige: \"\", pedido: null, versao: 0 }): nenhuma atualização no que já existe", () => {
  const nada = { sintonia: { exige: "", pedido: null, versao: 0 } };
  const plano = planejarInventario({
    existentes: [
      copia("f1", "c1", comSintonia({ ajusteAplicado: 0, sintonizado: true })),
      copia("f2", "c2", comSintonia({ ajusteAplicado: 0, exigeSintonia: "", propriedades: [], compendio: true })),
      nativo("f3", "c3", comSintonia({ ajusteAplicado: 0, sintonizado: true, sintoniaAplicada: 4 })),
      nativo("f4", "c4", { ajusteAplicado: 0 }), // sem o campo de sintonia (tesouro)
    ],
    recebidos: [recebido("c1", nada), recebido("c2", nada), recebido("c3", nada), recebido("c4", nada)],
  });
  assert.deepEqual(plano, { criar: [], atualizar: [], apagar: [] });
});

test("system.attunement no envio SEM pedido novo e SEM flags.efeitos: nada do item existente muda", () => {
  // item do compêndio ou do catálogo que exige sintonia: o envio traz a exigência, o mgc e a sintonia sem pedido
  const r = (cracha, sintonia) => recebido(cracha, { sintonia, exigeSintonia: "required", mgc: true, raridade: "rare", bonusMagico: 1, efeitosNovos: [] });
  const semPedido = { exige: "required", pedido: null, versao: 0 };
  const plano = planejarInventario({
    existentes: [
      // casca de antes da 1.26.0: sem exigência e sem mgc; sintonizada à mão no Foundry
      copia("f1", "c1", comSintonia({ ajusteAplicado: 0, exigeSintonia: "", propriedades: [], raridade: "", sintonizado: true })),
      copia("f2", "c2", comSintonia({ ajusteAplicado: 0, exigeSintonia: "optional", propriedades: [], compendio: true })),
      nativo("f3", "c3", comSintonia({ ajusteAplicado: 0, exigeSintonia: "", propriedades: [] })),
      // pedido VELHO (já aplicado): também não leva a exigência
      copia("f4", "c4", comSintonia({ ajusteAplicado: 0, exigeSintonia: "", propriedades: [], sintoniaAplicada: 2 })),
    ],
    recebidos: [r("c1", semPedido), r("c2", semPedido), r("c3", semPedido), r("c4", { exige: "required", pedido: true, versao: 2 })],
  });
  assert.deepEqual(plano, { criar: [], atualizar: [], apagar: [] });
});

test("a casca criada pela 1.25 (sem system.attunement, sem mgc, sem flags novas) com pedido de sintonia: leva a exigência e o mgc", () => {
  // como o bridge-client a descreve: `exigeSintonia` vazio (ou ausente) e nenhuma propriedade
  for (const de125 of [{ exigeSintonia: "", propriedades: [] }, { exigeSintonia: undefined, propriedades: undefined }]) {
    const plano = planejarInventario({
      existentes: [copia("f1", "c1", { ajusteAplicado: 0, temSintonia: true, sintonizado: false, ...de125 })],
      recebidos: [recebido("c1", { ...pede(true, 1), exigeSintonia: "required", mgc: true })],
    });
    assert.deepEqual(plano.atualizar, [{ _id: "f1", sintoniaAplicada: 1, exigeSintonia: "required", propriedades: ["mgc"], sintonizado: true }], JSON.stringify(de125));
  }
  // o Companion só manda system.attunement quando exige: sem ele no envio, a exigência da casca não é tocada
  const plano = planejarInventario({
    existentes: [copia("f1", "c1", { ajusteAplicado: 0, temSintonia: true, sintonizado: false, exigeSintonia: "", propriedades: [] })],
    recebidos: [recebido("c1", pede(true, 1))],
  });
  assert.deepEqual(plano.atualizar, [{ _id: "f1", sintoniaAplicada: 1, sintonizado: true }]);
});
