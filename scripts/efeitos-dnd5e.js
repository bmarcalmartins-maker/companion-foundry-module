/**
 * BÔNUS DE CURA COMO FÓRMULA (v1.14.0).
 *
 * O dnd5e 5.3.0 soma o bônus de cura do ator a toda atividade de cura na hora
 * da rolagem: `foundry.utils.getProperty(this.actor, "system.bonuses.heal.damage")`
 * (module/data/activity/base-activity.mjs:774-776, com actionType "heal"). Os
 * efeitos que o D&D Beyond Importer traz usam essa chave — ex.: Disciple of
 * Life, `system.bonuses.heal.damage` = "2 + @item.level".
 *
 * Só que `bonuses.heal` não existe no schema do ator. Sem campo, o Foundry
 * aplica a mudança pelo caminho genérico (#castDelta), que resolve os "@" com
 * os dados do ATOR a cada preparo da ficha — e o ator não tem `@item`. Saía o
 * aviso "The attribute @item.level was not present in the provided roll data"
 * a cada recálculo da ficha (toda mudança, toda sincronização com o Companion).
 *
 * O dnd5e tem a lista certa para isso: `ActiveEffect5e.FORMULA_FIELDS`, as
 * chaves "adicionadas no preparo que devem ser tratadas como fórmula"
 * (module/documents/active-effect.mjs:40-56). Chave nessa lista é aplicada com
 * um FormulaField, que NÃO resolve os "@" no preparo
 * (module/data/fields/formula-field.mjs, _castChangeDelta) — a fórmula chega
 * inteira ao ator e o "@item.level" é resolvido na rolagem, com os dados da
 * magia lançada (o nível já com o upcast: module/data/item/spell.mjs:652).
 *
 * Roda no init de TODO navegador (GM e jogadores): cada cliente prepara a ficha
 * e rola a cura no próprio navegador.
 */

export const CHAVES_DE_FORMULA = Object.freeze(["system.bonuses.heal.damage"]);

/**
 * Registra as chaves em `FORMULA_FIELDS` da classe de ActiveEffect do sistema.
 * Devolve as chaves que entraram agora (as que já estavam ficam de fora).
 * Sem a lista (outro sistema, dnd5e antigo), não faz nada.
 */
export function registrarCamposDeFormula(classeDeEfeito) {
  const lista = classeDeEfeito?.FORMULA_FIELDS;
  if (!(lista instanceof Set)) return [];
  const novas = CHAVES_DE_FORMULA.filter((chave) => !lista.has(chave));
  for (const chave of novas) lista.add(chave);
  return novas;
}
