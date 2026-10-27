/**
 * A FICHA COMPLETA NO SNAPSHOT (v1.15.0, schema 3; pedido do Bruno, 27/10:
 * "eu quero tudo sincronizado").
 *
 * Até a v1.13.0 o Companion recebia só os efeitos dos itens EQUIPADOS e o nome
 * das magias e das ações. Agora vão também:
 *   - `deslocamento`: system.attributes.movement JÁ PREPARADO (os efeitos
 *     aplicados, como o Unarmored Movement). Os campos são os do MovementField
 *     do dnd5e 5.3.0 (module/data/shared/movement-field.mjs:14-26);
 *   - `efeitos`: TODO efeito que pode valer no ator — os do próprio ator (uma
 *     magia lançada nele, uma condição) e os que passam dos itens (habilidades
 *     de classe, raça, talentos e itens, equipados ou não). `ativo` e
 *     `suprimido` são o veredito do Foundry/dnd5e: item não equipado ou sem
 *     sintonia fica `suprimido` (ActiveEffect5e#isSuppressed,
 *     module/documents/active-effect.mjs:121-129);
 *   - `habilidades`: os itens que NÃO são físicos (classe, subclasse, raça,
 *     antecedente, talento/habilidade e magia), com TODOS os efeitos deles,
 *     inclusive os que não passam ao personagem (os que a magia aplica no
 *     alvo: `transfer` falso).
 *
 * Lógica pura, sem `game` (test/ficha-completa.test.js).
 */

import { efeitoEnxuto } from "./effect-shape.js";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Os tipos de item que não são físicos (os físicos já vão no `inventario`). */
export const TIPOS_DE_HABILIDADE = Object.freeze(["class", "subclass", "race", "background", "feat", "spell"]);

/** O deslocamento preparado. Campo que não for número é omitido (a tela mostra "—"). */
export function deslocamentoDe(movement) {
  if (!movement || typeof movement !== "object") return undefined;
  const out = {};
  for (const k of ["walk", "fly", "swim", "climb", "burrow"]) {
    const v = num(movement[k]);
    if (v !== undefined) out[k] = v;
  }
  if (typeof movement.units === "string" && movement.units) out.units = movement.units;
  if (movement.hover === true) out.hover = true;
  if (typeof movement.special === "string" && movement.special.trim()) out.special = movement.special.trim().slice(0, 200);
  return out;
}

/** A edição do item ("2014"/"2024") ou null. */
function edicao(item) {
  const r = String(item?.system?.source?.rules ?? "").trim();
  return r === "2014" || r === "2024" ? r : null;
}

/** De onde o efeito vem: o item dono (habilidade, magia, item) ou o próprio ator. */
function origemDo(efeito, nomeDaOrigem) {
  const p = efeito?.parent;
  if (p && p.documentName === "Item") return { tipo: "item", id: p.id, nome: p.name, tipo_do_item: p.type };
  const uuid = typeof efeito?.origin === "string" && efeito.origin ? efeito.origin : null;
  return { tipo: "ator", uuid, nome: uuid ? (nomeDaOrigem?.(uuid) ?? null) : null };
}

/**
 * Os efeitos que podem valer no ator, enxutos + de onde vêm e o veredito.
 * `nomeDaOrigem(uuid)`: devolve o nome do documento de origem (fromUuidSync no Foundry).
 * `resolver(formula)`: o valor da fórmula nos dados do ator (número), ou undefined.
 */
export function efeitosDaFicha(efeitos, nomeDaOrigem, resolver) {
  const out = [];
  for (const e of efeitos ?? []) {
    const enxuto = efeitoEnxuto(e);
    // O valor com "@" (ex.: "@scale.monk.unarmored-movement") vai também
    // RESOLVIDO pelo Foundry, para o Companion mostrar o número e não a fórmula.
    if (typeof resolver === "function") {
      for (const c of enxuto.system.changes) {
        if (typeof c.value === "string" && c.value.includes("@")) {
          const r = resolver(c.value);
          if (r !== undefined) c.resolvido = r;
        }
      }
    }
    out.push({
      ...enxuto,
      suprimido: e?.isSuppressed === true,
      statuses: Array.from(e?.statuses ?? []).filter((s) => typeof s === "string"),
      origem: origemDo(e, nomeDaOrigem),
    });
  }
  return out;
}

/** Os itens que não são físicos, com todos os efeitos. */
export function habilidadesDoAtor(itens) {
  const out = [];
  for (const i of itens ?? []) {
    if (!TIPOS_DE_HABILIDADE.includes(i?.type)) continue;
    const h = {
      id: i.id,
      name: i.name,
      type: i.type,
      identificador: typeof i.system?.identifier === "string" && i.system.identifier ? i.system.identifier : null,
      edicao: edicao(i),
      effects: Array.from(i.effects ?? []).map(efeitoEnxuto),
    };
    if (i.type === "class") h.niveis = num(i.system?.levels);
    if (i.type === "spell") h.nivel = num(i.system?.level);
    if (i.type === "feat" && typeof i.system?.type?.value === "string") h.categoria = i.system.type.value;
    out.push(h);
  }
  return out;
}

/**
 * O teto da edge é 128 KiB. Se a ficha passar, corta em degraus, sempre
 * AVISANDO: primeiro as mudanças das habilidades que não passam ao personagem,
 * depois os efeitos das habilidades inteiros. Os efeitos que valem no ator
 * (`efeitos`) e o deslocamento ficam sempre.
 */
export function encolherFicha(snapshot, teto) {
  const tam = (s) => JSON.stringify(s).length;
  if (tam(snapshot) <= teto) return { snapshot, cortes: [] };
  const cortes = [];
  let s = {
    ...snapshot,
    habilidades: (snapshot.habilidades ?? []).map((h) => ({ ...h, effects: (h.effects ?? []).filter((e) => e.transfer !== false) })),
  };
  cortes.push("efeitos que as habilidades aplicam no alvo");
  if (tam(s) <= teto) return { snapshot: s, cortes };
  s = { ...s, habilidades: s.habilidades.map(({ effects, ...h }) => h) };
  cortes.push("efeitos das habilidades (os que valem no ator continuam em `efeitos`)");
  return { snapshot: s, cortes };
}
