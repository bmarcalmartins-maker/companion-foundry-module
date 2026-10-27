/**
 * BÔNUS DE CURA COMO FÓRMULA + REGRA CANÔNICA DO DISCIPLE OF LIFE (v1.14.0).
 *
 * 1) A fórmula
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
 * 2) A regra (o canônico vale)
 * O dnd5e soma esse bônus a TODA atividade de cura. O Disciple of Life (PHB
 * 2024) só vale para "a spell you cast with a spell slot [that] restores Hit
 * Points". Na rolagem de cura (hook `dnd5e.preRollDamageV2`,
 * module/dice/basic-roll.mjs:100-103) o bônus SAI quando:
 *  - não é magia, ou é truque (sem espaço de magia);
 *  - a magia é lançada sem espaço (à vontade, inata, ritual);
 *  - a cura não restaura PV (só PV temporário ou PV máximo);
 *  - a magia não restaura PV: Revivify e as de voltar à vida ("returns to life
 *    with 1 hit point" — fora pela implementação oficial do D&D Beyond) e Aid
 *    (aumenta PV máximo e atual; não está na lista oficial do D&D Beyond).
 *
 * Roda em TODO navegador (GM e jogadores): cada cliente prepara a ficha e rola
 * a cura no próprio navegador.
 */

export const CHAVE_BONUS_CURA = "system.bonuses.heal.damage";
export const CHAVES_DE_FORMULA = Object.freeze([CHAVE_BONUS_CURA]);

/** Magias cuja "cura" no dnd5e não é restaurar PV (identificador do dnd5e). */
export const MAGIAS_QUE_NAO_RESTAURAM = Object.freeze([
  "aid",
  "revivify",
  "raise-dead",
  "resurrection",
  "true-resurrection",
]);

/** Jeitos de lançar que não gastam espaço de magia (CONFIG.DND5E.spellcasting). */
const METODOS_SEM_ESPACO = new Set(["atwill", "innate", "ritual"]);

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

/**
 * O bônus de cura do ator vale para esta cura? (regra do Disciple of Life)
 * `tiposDeCura`: os tipos da cura da atividade ("healing", "temphp", "maximum").
 */
export function bonusDeCuraVale({ tipoDoItem, nivel, metodo, tiposDeCura, identificador }) {
  if (tipoDoItem !== "spell") return false;
  if (!(Number(nivel) >= 1)) return false;
  if (METODOS_SEM_ESPACO.has(metodo)) return false;
  if (!Array.from(tiposDeCura ?? []).includes("healing")) return false;
  if (MAGIAS_QUE_NAO_RESTAURAM.includes(identificador)) return false;
  return true;
}

/**
 * Tira o bônus de cura do ator das partes da primeira rolagem (é lá que o
 * dnd5e o põe, base-activity.mjs:773-777). Só a primeira ocorrência depois da
 * fórmula da magia. Devolve true se tirou.
 */
export function tirarBonusDeCura(config, bonus) {
  const partes = config?.rolls?.[0]?.parts;
  if (!Array.isArray(partes) || !bonus) return false;
  const i = partes.findIndex((p, idx) => idx > 0 && String(p).trim() === String(bonus).trim());
  if (i < 0) return false;
  partes.splice(i, 1);
  return true;
}

/** Hook da rolagem de cura: aplica a regra canônica. */
export function aplicarRegraNaRolagem(config) {
  const atividade = config?.subject;
  if (atividade?.type !== "heal") return;
  const bonus = foundry.utils.getProperty(atividade.actor ?? {}, CHAVE_BONUS_CURA);
  if (!bonus) return;
  const item = atividade.item;
  const vale = bonusDeCuraVale({
    tipoDoItem: item?.type,
    nivel: item?.system?.level,
    metodo: item?.system?.method,
    tiposDeCura: atividade.healing?.types,
    identificador: item?.system?.identifier,
  });
  if (!vale) tirarBonusDeCura(config, bonus);
}

/** Liga tudo no init (todo navegador). */
export function registrarRegrasDeCura(classeDeEfeito, hooks) {
  registrarCamposDeFormula(classeDeEfeito);
  hooks?.on?.("dnd5e.preRollDamageV2", (config) => {
    try {
      aplicarRegraNaRolagem(config);
    } catch (err) {
      console.warn("companion-foundry-bridge | regra do bônus de cura falhou:", err);
    }
  });
}
