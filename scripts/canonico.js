/**
 * CORREÇÕES CANÔNICAS (v1.16.0) — a parte PURA, sem `game`.
 *
 * "O que vale é o canônico" (Bruno, 27/10): o item oficial do compêndio do
 * dnd5e, na MESMA edição do item do personagem. Aqui fica a conta do que muda
 * num item para ele ficar igual ao oficial (efeitos e atividades) e a cópia do
 * "antes", para desfazer. Quem grava é canonico-foundry.js.
 *
 * Só entra aqui o que o Bruno DECIDIU (CORRECOES_DECIDIDAS) e o que tem fonte
 * oficial sem ambiguidade (a escala que existe na classe oficial e falta na do
 * personagem). O resto é relatório.
 */

import { diferencasDeAtividades, mudancasDosEfeitos } from "./auditoria.js";

/**
 * Habilidades que ficam IGUAIS ao item do compêndio do dnd5e (identificador).
 *
 * v1.17.0 — VAZIA. Regra do Bruno (27/10): "sempre siga o livro; se der o
 * mesmo resultado e puder ser automático, automático". O Disciple of Life
 * (PHB 2024: "that creature regains additional Hit Points [...] 2 plus the
 * spell slot's level") é um acréscimo na cura da própria magia — o automático
 * da v1.14.0 (efeitos-dnd5e.js). O compêndio do dnd5e o faz como cura à parte,
 * rolada à mão: mesmo total, um passo a mais. Por isso ele SAIU daqui; a troca
 * feita pela v1.16.0, se houve, é desfeita (canonico-foundry.js,
 * voltarTrocasAntigas) e o efeito do D&D Beyond vira nativo (CONVERSOES_NATIVAS).
 */
export const CORRECOES_DECIDIDAS = Object.freeze([]);

/**
 * Efeitos do D&D Beyond Importer escritos para o DAE (tipo "custom", que sem o
 * DAE não faz nada: o hook applyActiveEffect não tem ninguém ouvindo) e que
 * têm um equivalente NATIVO do dnd5e com o mesmo resultado do livro.
 *
 * - system.bonuses.heal.damage: o dnd5e soma essa chave à cura na rolagem
 *   (base-activity.mjs:774-776); com a chave em FORMULA_FIELDS
 *   (efeitos-dnd5e.js) o tipo "add" grava a fórmula inteira no ator. Usado
 *   pelo Disciple of Life; a regra do livro é aplicada na rolagem.
 */
export const CONVERSOES_NATIVAS = Object.freeze([
  Object.freeze({ chave: "system.bonuses.heal.damage", de: "custom", para: "add" }),
]);

/**
 * As mudanças de um efeito convertidas para o nativo. Devolve a lista nova, ou
 * `null` se nada muda (idempotente). Não mexe no que não está na tabela.
 */
export function converterMudancas(mudancas, regras = CONVERSOES_NATIVAS) {
  const lista = Array.isArray(mudancas) ? mudancas : [];
  let mudou = false;
  const novas = lista.map((m) => {
    const r = regras.find((x) => x.chave === m?.key && x.de === m?.type);
    if (!r) return m;
    mudou = true;
    return { ...m, type: r.para };
  });
  return mudou ? novas : null;
}

/** Campos que não se copiam do documento do compêndio. */
function semMetadados(obj) {
  const { _key, _stats, folder, sort, ownership, ...resto } = obj ?? {};
  return resto;
}

/**
 * O plano para o item ficar igual ao oficial. `fonte` e `oficial` são
 * `toObject()` (o item do personagem e o do compêndio). `igual` = nada a fazer.
 */
export function planoDoItem(fonte, oficial) {
  const atividadesP = Object.values(fonte?.system?.activities ?? {});
  const atividadesO = Object.values(oficial?.system?.activities ?? {});
  const efeitosIguais = JSON.stringify(mudancasDosEfeitos(fonte?.effects)) === JSON.stringify(mudancasDosEfeitos(oficial?.effects))
    && (fonte?.effects ?? []).length === (oficial?.effects ?? []).length;
  const atividadesIguais = diferencasDeAtividades(atividadesP, atividadesO).length === 0;
  if (efeitosIguais && atividadesIguais) return { igual: true };
  return {
    igual: false,
    apagarEfeitos: efeitosIguais ? [] : (fonte?.effects ?? []).map((e) => e._id).filter(Boolean),
    criarEfeitos: efeitosIguais ? [] : (oficial?.effects ?? []).map(semMetadados),
    apagarAtividades: atividadesIguais ? [] : atividadesP.map((a) => a._id).filter(Boolean),
    criarAtividades: atividadesIguais ? {} : Object.fromEntries(atividadesO.map((a) => [a._id, semMetadados(a)])),
  };
}

/** A cópia do "antes" de um item (o que o plano pode mudar). */
export function antesDoItem(fonte) {
  return {
    effects: structuredClone(fonte?.effects ?? []),
    activities: structuredClone(fonte?.system?.activities ?? {}),
  };
}

/**
 * Os ScaleValue da classe oficial que faltam na do personagem (pelo
 * identificador). Devolve os dados crus do oficial, para copiar como estão.
 */
export function escalasQueFaltam(avancosDoPersonagem, avancosOficiais) {
  const lista = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}));
  const id = (a) => a?.configuration?.identifier ?? a?.identifier;
  const tem = new Set(lista(avancosDoPersonagem).filter((a) => a?.type === "ScaleValue").map(id));
  return lista(avancosOficiais).filter((a) => a?.type === "ScaleValue" && id(a) && !tem.has(id(a)));
}
