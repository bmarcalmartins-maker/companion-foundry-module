/**
 * AUDITORIA FOUNDRY × CANÔNICO (v1.15.0) — a parte que lê o Foundry.
 *
 * SÓ LEITURA. Nada aqui grava documento: `actor.reset()` refaz o preparo da
 * ficha em memória a partir do dado salvo (o mesmo que o Foundry faz sozinho a
 * cada mudança), e as simulações montam a configuração da rolagem sem rolar
 * (getDamageConfig / getAttackData do dnd5e 5.3.0:
 * module/data/activity/base-activity.mjs:744 e attack-data.mjs:259).
 *
 * Uso (console do GM):
 *   const r = await game.modules.get("companion-foundry-bridge").api.auditar();
 *   // r é o relatório; { baixar: true } também salva o JSON num arquivo.
 *   await game.modules.get("companion-foundry-bridge").api.auditar({ baixar: true });
 *   // Só alguns atores: { atores: ["Guldrum", "Talaniel"] } (nome ou id).
 *
 * O que cada parte procura está no pedido do Bruno (AUDITORIA 27/10):
 *   1. "@" que não resolve: efeitos × actor.getRollData(); atividades ×
 *      activity.getRollData(); campos do item × item.getRollData();
 *      @scale.<classe>.<id> × os ScaleValue da classe oficial.
 *   2. recálculo (actor.reset) e simulação de toda atividade, capturando os
 *      console.warn/error de dado ausente; e os `_preparationWarnings` que o
 *      dnd5e junta no preparo (actor.mjs:305, utils.mjs:411-417).
 *   3. efeitos que só um módulo de automação faz funcionar (tipo "custom",
 *      flags.midi-qol.*, flags.dae.*, macro.*).
 *   4. as condições conhecidas que o dnd5e não aplica (abaixo, `condicoes`).
 *   5. o item × o oficial do compêndio da MESMA edição; edição misturada.
 *   6. os módulos ativos e as versões.
 *   7. a FOTO para a paridade com o Companion (todos os itens, efeitos,
 *      deslocamento), comparada fora daqui com o Supabase.
 */

import {
  PACOTES_OFICIAIS,
  avisoInteressa,
  diferencasDeAtividades,
  edicaoDoItem,
  escalasDosAvancos,
  formulasDoObjeto,
  mudancaInerte,
  mudancasDosEfeitos,
  partesDaEscala,
  referenciasAusentes,
  textoDoConsole,
  tipoDaMudanca,
} from "./auditoria.js";

const ler = (obj, caminho) => foundry.utils.getProperty(obj, caminho);

/** Roda `fn` capturando console.warn/error; devolve { valor, avisos }. Restaura sempre. */
async function capturando(fn) {
  const avisos = [];
  const warn = console.warn;
  const error = console.error;
  console.warn = (...a) => { avisos.push({ nivel: "warn", texto: textoDoConsole(a) }); warn.apply(console, a); };
  console.error = (...a) => { avisos.push({ nivel: "error", texto: textoDoConsole(a) }); error.apply(console, a); };
  try {
    const valor = await fn();
    return { valor, avisos };
  } catch (err) {
    return { valor: undefined, avisos, erro: String(err?.message ?? err).slice(0, 400) };
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

/** As mudanças cruas de um efeito (v14: system.changes; v13: changes). */
function mudancasDoEfeito(efeito) {
  let raw = null;
  try { raw = efeito.toObject(); } catch { raw = null; }
  const c = raw?.system?.changes ?? raw?.changes ?? efeito?.changes ?? [];
  return Array.isArray(c) ? c : [];
}

/** Todos os efeitos que podem valer no ator (do ator e os transferidos dos itens). */
function efeitosDoAtor(ator) {
  if (typeof ator.allApplicableEffects === "function") return Array.from(ator.allApplicableEffects());
  const out = Array.from(ator.effects ?? []);
  for (const i of ator.items ?? []) for (const e of i.effects ?? []) if (e.transfer) out.push(e);
  return out;
}

/** A chave existe no modelo do ator? (o mesmo getField que o dnd5e usa: advantage-mode-field.mjs:170) */
function chaveNoModelo(ator, chave) {
  try {
    if (chave.startsWith("system.")) return !!ator.system?.schema?.getField(chave.slice(7));
    return !!ator.schema?.getField(chave);
  } catch {
    return false;
  }
}

/** Índice dos compêndios oficiais, por edição → identificador|tipo → [{pack, _id}]. */
async function indiceOficial() {
  const out = { 2014: new Map(), 2024: new Map() };
  for (const [edicao, ids] of Object.entries(PACOTES_OFICIAIS)) {
    for (const id of ids) {
      const pack = game.packs.get(id);
      if (!pack) continue;
      const idx = await pack.getIndex({ fields: ["system.identifier", "system.source.rules"] });
      for (const e of idx) {
        const ident = ler(e, "system.identifier");
        if (!ident) continue;
        const chave = `${ident}|${e.type}`;
        if (!out[edicao].has(chave)) out[edicao].set(chave, []);
        out[edicao].get(chave).push({ pack: id, _id: e._id });
      }
    }
  }
  return out;
}

async function oficialDe(indice, edicao, identificador, tipo, cache) {
  if (!edicao) return null;
  const achados = indice[edicao]?.get(`${identificador}|${tipo}`) ?? [];
  if (!achados.length) return null;
  const { pack, _id } = achados[0];
  const k = `${pack}.${_id}`;
  if (!cache.has(k)) cache.set(k, await game.packs.get(pack).getDocument(_id));
  const doc = cache.get(k);
  return doc ? { doc, uuid: doc.uuid, mais: achados.length - 1 } : null;
}

/** Lê o ator inteiro: problemas + foto. */
async function auditarAtor(ator, ctx) {
  const problemas = [];
  const add = (p) => problemas.push({ ator: ator.name, ...p });

  // 2. Recalcula a ficha capturando os avisos (e os do próprio dnd5e).
  const recalculo = await capturando(() => ator.reset());
  for (const a of recalculo.avisos) {
    if (avisoInteressa(a.texto)) add({ parte: "recalculo", fato: true, o_que: a.texto, nivel: a.nivel });
  }
  if (recalculo.erro) add({ parte: "recalculo", fato: true, o_que: `actor.reset() falhou: ${recalculo.erro}` });
  for (const w of ator._preparationWarnings ?? []) {
    add({ parte: "recalculo", fato: true, o_que: w.message, link: w.link ?? null, nivel: w.type ?? null });
  }

  const dadosDoAtor = ator.getRollData();
  const escalasAusentes = new Map(); // termo → [onde]
  const anotarEscala = (termo, onde) => {
    if (!partesDaEscala(termo)) return;
    if (!escalasAusentes.has(termo)) escalasAusentes.set(termo, []);
    escalasAusentes.get(termo).push(onde);
  };

  // 1a + 3. Efeitos que valem no ator.
  const fotoEfeitos = [];
  const FORMULA_FIELDS = CONFIG.ActiveEffect?.documentClass?.FORMULA_FIELDS;
  for (const ef of efeitosDoAtor(ator)) {
    const origem = ef.parent?.documentName === "Item" ? ef.parent : null;
    const mudancas = mudancasDoEfeito(ef);
    fotoEfeitos.push({
      id: ef.id,
      nome: ef.name,
      item: origem ? { id: origem.id, nome: origem.name, tipo: origem.type, equipado: origem.system?.equipped ?? null } : null,
      ativo: ef.active === true,
      desligado: ef.disabled === true,
      mudancas: mudancas.map((c) => ({ chave: c.key, tipo: tipoDaMudanca(c), valor: c.value })),
    });
    for (const c of mudancas) {
      const onde = { efeito: ef.name, efeito_id: ef.id, item: origem?.name ?? null, item_id: origem?.id ?? null, chave: c.key, tipo: tipoDaMudanca(c), valor: c.value };
      const inerte = mudancaInerte(c, ctx.modulosAtivos);
      if (inerte) add({ parte: "efeito_inerte", fato: true, ...onde, ...inerte, o_que: inerte.motivo === "tipo_custom" ? "tipo custom: o dnd5e puro não aplica" : `chave do módulo ${inerte.modulo}, que não está ativo` });
      const chave = String(c.key ?? "");
      const ehFormula = FORMULA_FIELDS instanceof Set && FORMULA_FIELDS.has(chave);
      if (!inerte && !ehFormula && !chave.startsWith("flags.") && !chave.startsWith("activities[") && !chave.startsWith("system.activities.") && !chaveNoModelo(ator, chave)) {
        add({ parte: "efeito_chave_fora_do_modelo", fato: true, ...onde, o_que: "a chave não existe no modelo do ator (schema.getField nulo)" });
      }
      // Na fórmula de FORMULA_FIELDS os "@" só se resolvem na rolagem: não se testam aqui.
      if (!ehFormula && typeof c.value === "string") {
        const faltam = referenciasAusentes(c.value, dadosDoAtor, ler);
        for (const t of faltam) anotarEscala(t, { efeito: ef.name, item: origem?.name ?? null });
        if (faltam.length) add({ parte: "efeito_formula", fato: true, ...onde, ausentes: faltam, o_que: `"@" que não resolve em actor.getRollData(): ${faltam.join(", ")}` });
      }
    }
  }

  // 1b + 1c + 2. Itens e atividades.
  const fotoItens = [];
  const edicoes = { 2014: 0, 2024: 0, sem: 0 };
  for (const item of ator.items) {
    const edicao = edicaoDoItem(item);
    edicoes[edicao ?? "sem"] += 1;
    const fonte = item.toObject();

    // Campos do item (usos etc.) × item.getRollData({ deterministic: true }) — o que o dnd5e usa no preparo.
    let dadosDoItem = null;
    try { dadosDoItem = item.getRollData({ deterministic: true }); } catch { dadosDoItem = null; }
    if (dadosDoItem) {
      for (const { caminho, formula } of formulasDoObjeto(fonte.system, { pular: ["activities", "advancement"] })) {
        const faltam = referenciasAusentes(formula, dadosDoItem, ler);
        for (const t of faltam) anotarEscala(t, { item: item.name, campo: caminho });
        if (faltam.length) add({ parte: "item_formula", fato: true, item: item.name, item_id: item.id, campo: `system.${caminho}`, valor: formula, ausentes: faltam, o_que: `"@" que não resolve em item.getRollData(): ${faltam.join(", ")}` });
      }
    }

    const atividades = [];
    for (const atv of item.system?.activities ?? []) {
      const bruto = atv.toObject();
      atividades.push({ id: atv.id, tipo: atv.type, nome: atv.name });
      let dadosDaAtv = null;
      try { dadosDaAtv = atv.getRollData(); } catch (err) {
        add({ parte: "atividade", fato: true, item: item.name, atividade: atv.name, o_que: `activity.getRollData() falhou: ${String(err?.message ?? err)}` });
      }
      if (dadosDaAtv) {
        for (const { caminho, formula } of formulasDoObjeto(bruto)) {
          const faltam = referenciasAusentes(formula, dadosDaAtv, ler);
          for (const t of faltam) anotarEscala(t, { item: item.name, atividade: atv.name, campo: caminho });
          if (faltam.length) add({ parte: "atividade_formula", fato: true, item: item.name, item_id: item.id, atividade: atv.name || atv.type, atividade_id: atv.id, campo: caminho, valor: formula, ausentes: faltam, o_que: `"@" que não resolve em activity.getRollData(): ${faltam.join(", ")}` });
        }
      }
      // Simula: monta a configuração do dano/cura e do ataque, sem rolar.
      const sim = await capturando(() => {
        const rolagens = [];
        if (typeof atv.getDamageConfig === "function") {
          const cfg = atv.getDamageConfig({});
          for (const r of cfg?.rolls ?? []) rolagens.push({ partes: r.parts ?? [], dados: r.data ?? {} });
        }
        if (atv.type === "attack" && typeof atv.getAttackData === "function") {
          const { parts, data } = atv.getAttackData({});
          rolagens.push({ partes: parts ?? [], dados: data ?? {} });
        }
        const RollClass = globalThis.Roll?.defaultImplementation ?? globalThis.Roll;
        const faltas = [];
        for (const r of rolagens) {
          for (const parte of r.partes) {
            const f = referenciasAusentes(parte, r.dados, ler);
            if (f.length) faltas.push({ parte, ausentes: f });
          }
          // Montar o Roll (sem avaliar) também passa os "@" pelo Foundry.
          if (RollClass && r.partes.length) new RollClass(r.partes.join(" + "), r.dados);
        }
        return faltas;
      });
      for (const f of sim.valor ?? []) {
        add({ parte: "simulacao", fato: true, item: item.name, item_id: item.id, atividade: atv.name || atv.type, atividade_id: atv.id, valor: f.parte, ausentes: f.ausentes, o_que: `na rolagem simulada falta: ${f.ausentes.join(", ")}` });
        for (const t of f.ausentes) anotarEscala(t, { item: item.name, atividade: atv.name, campo: "rolagem" });
      }
      for (const a of sim.avisos) if (avisoInteressa(a.texto)) add({ parte: "simulacao", fato: true, item: item.name, atividade: atv.name || atv.type, o_que: a.texto, nivel: a.nivel });
      if (sim.erro) add({ parte: "simulacao", fato: true, item: item.name, atividade: atv.name || atv.type, o_que: `a simulação falhou: ${sim.erro}` });
    }

    // 5. O item × o oficial da mesma edição.
    let oficial = null;
    if (ctx.indice && item.system?.identifier) {
      oficial = await oficialDe(ctx.indice, edicao, item.system.identifier, item.type, ctx.cache);
      if (oficial) {
        const of = oficial.doc.toObject();
        const difs = diferencasDeAtividades(Object.values(fonte.system?.activities ?? {}), Object.values(of.system?.activities ?? {}));
        const efP = mudancasDosEfeitos(fonte.effects);
        const efO = mudancasDosEfeitos(of.effects);
        if (JSON.stringify(efP) !== JSON.stringify(efO)) difs.push({ campo: "efeitos.mudancas", personagem: efP, oficial: efO });
        const usoP = fonte.system?.uses?.max || null;
        const usoO = of.system?.uses?.max || null;
        if (usoP !== usoO) difs.push({ campo: "system.uses.max", personagem: usoP, oficial: usoO });
        if (difs.length) add({ parte: "item_x_oficial", fato: true, item: item.name, item_id: item.id, edicao, oficial: oficial.uuid, diferencas: difs, o_que: `${difs.length} diferença(s) com o oficial` });
      } else if (edicao) {
        ctx.semOficial.push({ ator: ator.name, item: item.name, tipo: item.type, identificador: item.system.identifier, edicao });
      }
    }

    fotoItens.push({
      id: item.id,
      nome: item.name,
      tipo: item.type,
      identificador: item.system?.identifier ?? null,
      edicao,
      equipado: typeof item.system?.equipped === "boolean" ? item.system.equipped : null,
      quantidade: item.system?.quantity ?? null,
      sintonia: item.system?.attuned ?? null,
      companion_item_id: item.getFlag?.("companion-foundry-bridge", "item_id") ?? null,
      atividades,
      efeitos: Array.from(item.effects ?? []).map((e) => ({ id: e.id, nome: e.name, transfer: e.transfer !== false, desligado: e.disabled === true, mudancas: mudancasDoEfeito(e).map((c) => ({ chave: c.key, tipo: tipoDaMudanca(c), valor: c.value })) })),
      oficial: oficial?.uuid ?? null,
    });
  }

  // 5. Edição misturada (só reporta).
  if (edicoes[2014] && edicoes[2024]) add({ parte: "edicao_misturada", fato: true, o_que: `itens de 2014 (${edicoes[2014]}) e de 2024 (${edicoes[2024]}) no mesmo personagem`, edicoes });

  // 1c. @scale ausente × a classe oficial.
  for (const [termo, onde] of escalasAusentes) {
    const { classe, id } = partesDaEscala(termo);
    const doAtor = ator.items.find((i) => ["class", "subclass"].includes(i.type) && i.identifier === classe);
    const temNoAtor = doAtor ? escalasDosAvancos(doAtor.toObject().system?.advancement) : null;
    let noOficial = null;
    let uuidOficial = null;
    if (doAtor && ctx.indice) {
      const of = await oficialDe(ctx.indice, edicaoDoItem(doAtor), classe, doAtor.type, ctx.cache);
      if (of) {
        noOficial = escalasDosAvancos(of.doc.toObject().system?.advancement);
        uuidOficial = of.uuid;
      }
    }
    add({
      parte: "escala_ausente", fato: true, termo, onde,
      classe_no_ator: doAtor ? { nome: doAtor.name, tipo: doAtor.type, edicao: edicaoDoItem(doAtor), escalas: temNoAtor } : null,
      oficial: uuidOficial, escalas_oficiais: noOficial,
      existe_no_oficial: Array.isArray(noOficial) ? noOficial.includes(id) : null,
      o_que: !doAtor ? `nenhuma classe/subclasse com o identificador "${classe}" no ator` : Array.isArray(noOficial) && noOficial.includes(id) ? `a escala "${id}" existe na classe oficial e falta na do ator` : `a escala "${id}" não está na classe do ator nem foi achada na oficial`,
    });
  }

  // 4. Condições conhecidas que o dnd5e soma sem olhar (com a fonte no relatório).
  const condicoes = condicoesIgnoradas(ator, fotoEfeitos);
  for (const c of condicoes) add({ parte: "condicao_ignorada", ...c });

  const sys = ator.system ?? {};
  return {
    problemas,
    foto: {
      id: ator.id,
      nome: ator.name,
      tipo: ator.type,
      nivel: sys.details?.level ?? null,
      deslocamento: foundry.utils.deepClone(sys.attributes?.movement ?? null),
      ca: sys.attributes?.ac?.value ?? null,
      pv_max: sys.attributes?.hp?.max ?? null,
      bonus: foundry.utils.deepClone(sys.bonuses ?? null),
      edicoes,
      efeitos: fotoEfeitos,
      itens: fotoItens,
    },
  };
}

/**
 * As condições que o dnd5e não aplica e que a auditoria sabe olhar (cada uma
 * com a fonte). Só olha; quem decide a correção é o relatório.
 */
function condicoesIgnoradas(ator, fotoEfeitos) {
  const out = [];
  const equipados = ator.items.filter((i) => i.system?.equipped === true);
  const armadura = equipados.find((i) => i.type === "equipment" && ["light", "medium", "heavy"].includes(i.system?.type?.value));
  const escudo = equipados.find((i) => i.type === "equipment" && i.system?.type?.value === "shield");
  // Unarmored Movement: "while you aren't wearing armor or wielding a Shield"
  // (texto do item oficial, dnd5e.classes24 phbmnkUnarmoredM). O efeito oficial
  // é incondicional (o mesmo item, effects[0]): o dnd5e não suprime.
  for (const ef of fotoEfeitos) {
    const doUM = ef.mudancas.some((c) => String(c.valor ?? "").includes("unarmored-movement")) || /unarmored movement/i.test(ef.nome ?? "");
    if (doUM && ef.ativo && (armadura || escudo)) {
      out.push({ fato: true, efeito: ef.nome, o_que: `Unarmored Movement ativo com ${armadura ? `armadura (${armadura.name})` : ""}${armadura && escudo ? " e " : ""}${escudo ? `escudo (${escudo.name})` : ""}`, fonte: "texto do item oficial (dnd5e.classes24 / classfeatures): só sem armadura e sem escudo" });
    }
  }
  // Bônus de cura do ator: o dnd5e soma a TODA cura (base-activity.mjs:772-776).
  const bonusCura = ler(ator, "system.bonuses.heal.damage");
  if (bonusCura) {
    // A regra na rolagem é a v1.14.0 do módulo (PR #12); a versão instalada vai no topo do relatório.
    out.push({ fato: true, o_que: `bônus de cura no ator ("${bonusCura}"), que o dnd5e soma a toda cura`, versao_do_modulo: game.modules.get("companion-foundry-bridge")?.version ?? null, fonte: "PHB 2024 Disciple of Life: só magia lançada com espaço que restaura PV" });
  }
  return out;
}

/** O relatório inteiro. */
export async function auditar({ atores = null, compendio = true, baixar = false } = {}) {
  const modulosAtivos = new Set(game.modules.filter((m) => m.active).map((m) => m.id));
  const ctx = { modulosAtivos, indice: null, cache: new Map(), semOficial: [] };
  if (compendio) ctx.indice = await indiceOficial();

  const filtro = Array.isArray(atores) && atores.length ? new Set(atores) : null;
  const alvo = game.actors.filter((a) => ["character", "npc"].includes(a.type) && (!filtro || filtro.has(a.name) || filtro.has(a.id)));

  const ActiveEffectClass = CONFIG.ActiveEffect?.documentClass;
  const relatorio = {
    gerado_em: new Date().toISOString(),
    foundry: game.version ?? null,
    dnd5e: game.system?.version ?? null,
    modulo: game.modules.get("companion-foundry-bridge")?.version ?? null,
    bonus_de_cura_como_formula: ActiveEffectClass?.FORMULA_FIELDS instanceof Set ? ActiveEffectClass.FORMULA_FIELDS.has("system.bonuses.heal.damage") : null,
    modulos: game.modules.filter((m) => m.active).map((m) => ({ id: m.id, titulo: m.title, versao: m.version ?? null, verificado: m.compatibility?.verified ?? null, maximo: m.compatibility?.maximum ?? null })),
    atores: [],
    problemas: [],
    sem_oficial: ctx.semOficial,
  };
  for (const a of alvo) {
    const r = await auditarAtor(a, ctx);
    relatorio.atores.push(r.foto);
    relatorio.problemas.push(...r.problemas);
  }
  relatorio.resumo = relatorio.problemas.reduce((acc, p) => ((acc[p.parte] = (acc[p.parte] ?? 0) + 1), acc), {});

  if (baixar) {
    const salvar = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
    if (typeof salvar === "function") salvar(JSON.stringify(relatorio, null, 2), "application/json", `auditoria-${relatorio.gerado_em.slice(0, 10)}.json`);
    else relatorio.baixar = "saveDataToFile não achado: copie com copy(JSON.stringify(r))";
  }
  return relatorio;
}
