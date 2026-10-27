/**
 * AUDITORIA FOUNDRY × CANÔNICO (v1.15.0) — a parte PURA, sem `game`.
 *
 * Só lê. Quem liga ao Foundry é auditoria-foundry.js; aqui ficam as contas
 * testáveis (test/auditoria.test.js):
 *   - achar os "@" de uma fórmula e dizer quais não resolvem num roll data,
 *     com a MESMA regra do dnd5e 5.3.0 (module/utils.mjs:399-410:
 *     `/@([a-z.0-9_-]+)/gi` e `getProperty(data, termo) == null` = ausente);
 *   - classificar a mudança de um efeito (tipo "custom", chave de módulo que
 *     não está instalado: midi-qol, dae, macro);
 *   - achar as fórmulas dentro de uma atividade ou de um item (as strings com
 *     "@"), sem descrição e sem texto de chat;
 *   - a edição de um item (`system.source.rules`, "2014"/"2024") e os
 *     compêndios oficiais de cada edição (system.json do dnd5e 5.3.0: SRD 5.1
 *     = 2014, SRD 5.2 = 2024);
 *   - os ScaleValue de uma classe (o `@scale.<classe>.<id>` vem do
 *     `identifier` do item e do `identifier` do avanço:
 *     module/data/abstract/actor-data-model.mjs:71-74 e
 *     module/documents/item.mjs:386-397).
 */

/** A regex de referência do dnd5e (utils.mjs:400). */
const REF = /@([a-z.0-9_-]+)/gi;

/** As referências "@x.y" de uma fórmula, sem repetir, na ordem. */
export function referenciasDaFormula(formula) {
  if (formula == null) return [];
  const out = [];
  for (const m of String(formula).matchAll(REF)) {
    // O termo como o dnd5e o lê (sem aparar nada: "@abc." também falha lá).
    const termo = m[1];
    if (!out.includes(termo)) out.push(termo);
  }
  return out;
}

/** Lê um caminho "a.b.c" (o mesmo que foundry.utils.getProperty, sem o Foundry). */
export function lerCaminho(obj, caminho) {
  let atual = obj;
  for (const parte of String(caminho).split(".")) {
    if (atual == null) return undefined;
    atual = atual[parte];
  }
  return atual;
}

/** As referências que NÃO resolvem nesse roll data (null/undefined = ausente, como o dnd5e). */
export function referenciasAusentes(formula, dados, ler = lerCaminho) {
  return referenciasDaFormula(formula).filter((termo) => ler(dados, termo) == null);
}

/** Chaves de efeito que só fazem algo com módulos de automação. */
export const PREFIXOS_DE_MODULO = Object.freeze([
  { prefixo: "flags.midi-qol.", modulo: "midi-qol" },
  { prefixo: "flags.dae.", modulo: "dae" },
  { prefixo: "macro.", modulo: "dae" },
  { prefixo: "flags.automated-conditions-5e.", modulo: "automated-conditions-5e" },
]);

/**
 * O tipo da mudança: v14 grava `type` ("add", "custom"...); v13, `mode`
 * (0 = custom, CONST.ACTIVE_EFFECT_MODES). Devolve a string.
 */
const MODOS = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };
export function tipoDaMudanca(mudanca) {
  if (typeof mudanca?.type === "string" && mudanca.type) return mudanca.type;
  const m = Number(mudanca?.mode);
  return Number.isInteger(m) && MODOS[m] ? MODOS[m] : "desconhecido";
}

/**
 * Por que esta mudança não faz nada no dnd5e puro? null = nada a dizer.
 * `modulosAtivos`: Set dos ids de módulo ativos no mundo.
 */
export function mudancaInerte(mudanca, modulosAtivos = new Set()) {
  const chave = String(mudanca?.key ?? "");
  for (const { prefixo, modulo } of PREFIXOS_DE_MODULO) {
    if (chave.startsWith(prefixo) && !modulosAtivos.has(modulo)) {
      return { motivo: "chave_de_modulo_ausente", modulo };
    }
  }
  if (tipoDaMudanca(mudanca) === "custom") {
    // O "custom" só faz algo se algum módulo trata o hook applyActiveEffect.
    return { motivo: "tipo_custom", modulo: null };
  }
  return null;
}

/** Chaves de texto que não são fórmula (descrição, chat, nomes, imagens). */
const NAO_FORMULA = new Set(["description", "chatFlavor", "chat", "name", "img", "special", "condition", "requirements", "unidentified", "_stats", "flags", "source"]);

/**
 * As strings com "@" de um objeto (atividade ou `system` do item), com o
 * caminho. Pula descrição/chat e o que `pular` mandar (ex.: "activities").
 */
export function formulasDoObjeto(obj, { pular = [] } = {}) {
  const out = [];
  const pularSet = new Set([...NAO_FORMULA, ...pular]);
  const andar = (v, caminho) => {
    if (typeof v === "string") {
      if (v.includes("@")) out.push({ caminho, formula: v });
      return;
    }
    if (!v || typeof v !== "object") return;
    const entradas = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v);
    for (const [k, x] of entradas) {
      if (pularSet.has(k)) continue;
      andar(x, caminho ? `${caminho}.${k}` : k);
    }
  };
  andar(obj, "");
  return out;
}

/** A edição do item: "2014", "2024" ou null (não diz). */
export function edicaoDoItem(item) {
  const r = String(item?.system?.source?.rules ?? "").trim();
  return r === "2014" || r === "2024" ? r : null;
}

/** Os compêndios oficiais de Item por edição (system.json do dnd5e 5.3.0). */
export const PACOTES_OFICIAIS = Object.freeze({
  2014: ["dnd5e.classes", "dnd5e.subclasses", "dnd5e.classfeatures", "dnd5e.spells", "dnd5e.items", "dnd5e.races", "dnd5e.backgrounds"],
  2024: ["dnd5e.classes24", "dnd5e.spells24", "dnd5e.equipment24", "dnd5e.feats24", "dnd5e.origins24"],
});

/** Os identificadores dos ScaleValue de uma lista de avanços (dado cru ou instância). */
export function escalasDosAvancos(avancos) {
  const lista = Array.isArray(avancos) ? avancos : Object.values(avancos ?? {});
  const out = [];
  for (const a of lista) {
    if (a?.type !== "ScaleValue") continue;
    const id = a.identifier ?? a.configuration?.identifier;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** "scale.monk.unarmored-movement" → { classe: "monk", id: "unarmored-movement" }. */
export function partesDaEscala(termo) {
  const m = /^scale\.([^.]+)\.([^.]+)/.exec(String(termo));
  return m ? { classe: m[1], id: m[2] } : null;
}

/**
 * Resumo comparável de uma atividade (do personagem ou oficial): o tipo e as
 * fórmulas que mais importam. Recebe o objeto CRU (`toObject()` ou o dado do
 * compêndio).
 */
export function resumoDaAtividade(a) {
  const dano = (a?.damage?.parts ?? []).map(formulaDaParte);
  const cura = a?.healing ? formulaDaParte(a.healing) : null;
  return {
    tipo: a?.type ?? null,
    dano,
    cura,
    ataque: a?.attack?.bonus || null,
    cd: a?.save?.dc?.formula || null,
    usos: a?.uses?.max || null,
  };
}

/** A fórmula de uma parte de dano do dnd5e 5.x (DamageData: custom ou NdM + bônus). */
export function formulaDaParte(p) {
  if (!p) return null;
  if (p.custom?.enabled) return String(p.custom.formula ?? "").trim() || null;
  const dado = p.number && p.denomination ? `${p.number}d${p.denomination}` : "";
  const bonus = String(p.bonus ?? "").trim();
  const f = [dado, bonus].filter(Boolean).join(" + ");
  return f || null;
}

/**
 * Diferenças entre as atividades do personagem e as oficiais, por tipo e
 * ordem dentro do tipo. Devolve uma lista de { campo, personagem, oficial }.
 */
export function diferencasDeAtividades(doPersonagem, oficiais) {
  const porTipo = (lista) => {
    const m = new Map();
    for (const a of lista) {
      const r = resumoDaAtividade(a);
      if (!m.has(r.tipo)) m.set(r.tipo, []);
      m.get(r.tipo).push(r);
    }
    return m;
  };
  const p = porTipo(doPersonagem ?? []);
  const o = porTipo(oficiais ?? []);
  const out = [];
  for (const tipo of new Set([...p.keys(), ...o.keys()])) {
    const lp = p.get(tipo) ?? [];
    const lo = o.get(tipo) ?? [];
    if (lp.length !== lo.length) out.push({ campo: `atividades.${tipo}.quantidade`, personagem: lp.length, oficial: lo.length });
    for (let i = 0; i < Math.min(lp.length, lo.length); i++) {
      for (const campo of ["dano", "cura", "ataque", "cd", "usos"]) {
        const a = JSON.stringify(lp[i][campo]);
        const b = JSON.stringify(lo[i][campo]);
        if (a !== b) out.push({ campo: `atividades.${tipo}[${i}].${campo}`, personagem: lp[i][campo], oficial: lo[i][campo] });
      }
    }
  }
  return out;
}

/** As mudanças de uma lista de efeitos crus, para comparar com o oficial. */
export function mudancasDosEfeitos(efeitos) {
  const out = [];
  for (const e of efeitos ?? []) {
    const changes = e?.system?.changes ?? e?.changes ?? [];
    for (const c of changes) out.push(`${c?.key}|${tipoDaMudanca(c)}|${c?.value}`);
  }
  return out.sort();
}

/** Uma mensagem de console é das que a auditoria procura? */
export const PADROES_DE_AVISO = Object.freeze([/was not present/i, /failed to resolve/i, /failed to validate/i, /deprecat/i]);
export function avisoInteressa(texto) {
  return PADROES_DE_AVISO.some((r) => r.test(String(texto)));
}

/** Junta os argumentos de um console.warn num texto curto. */
export function textoDoConsole(args) {
  return args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
    .join(" ")
    .slice(0, 600);
}
