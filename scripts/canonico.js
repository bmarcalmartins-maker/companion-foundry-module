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
 * Habilidades que ficam IGUAIS ao oficial (identificador do dnd5e).
 * - disciple-of-life (Bruno, 27/10: "siga o oficial do dnd5e no Disciple of
 *   Life"): o oficial não tem efeito; no 2024 é uma atividade de cura à parte,
 *   `@scaling + 2` (dnd5e classes24 phbclcDiscipleOf); no 2014, só o texto
 *   (dnd5e classfeatures jF8AFfEMICIJnAkR).
 */
export const CORRECOES_DECIDIDAS = Object.freeze(["disciple-of-life"]);

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
