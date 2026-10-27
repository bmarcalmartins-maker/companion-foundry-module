/**
 * CORREÇÕES CANÔNICAS (v1.16.0) — a parte que grava no Foundry.
 *
 * Roda no GM ATIVO, sozinha no `ready` (pedido do Bruno, 27/10: "já aplica
 * tudo, deixe tudo pronto"), e pela API. É idempotente: o que já está igual ao
 * oficial não muda. Cada item mudado guarda o "antes" na flag
 * `companion-foundry-bridge.canonico` (a primeira vez só), e
 * `api.desfazerCanonico()` volta tudo.
 *
 * O que faz:
 *  1. as habilidades decididas pelo Bruno (canonico.js, CORRECOES_DECIDIDAS)
 *     ficam iguais ao item oficial da MESMA edição — efeitos e atividades. A
 *     edição é a do item (`system.source.rules`); sem ela, a da classe ou
 *     subclasse do personagem (declarado no relatório como "pela classe");
 *     sem nenhuma, não decide;
 *  2. a escala `@scale.<classe>.<id>` que uma fórmula do personagem usa, que
 *     falta na classe dele e EXISTE na classe oficial da mesma edição, é
 *     copiada de lá (createAdvancement do dnd5e, item.mjs:965).
 *
 * As APIs do dnd5e 5.3.0 usadas: Item5e#deleteActivity (item.mjs:944, apaga
 * nos v13 e v14) e a gravação de `system.activities.<id>` que o próprio
 * createActivity faz (item.mjs:918).
 */

import { MODULE_ID } from "./settings.js";
import { CORRECOES_DECIDIDAS, antesDoItem, escalasQueFaltam, planoDoItem } from "./canonico.js";
import { PACOTES_OFICIAIS, edicaoDoItem } from "./auditoria.js";
import { auditar } from "./auditoria-foundry.js";

const FLAG = "canonico";

/** O item oficial pelo identificador, tipo e edição (o primeiro achado nos pacotes da edição). */
async function oficial(identificador, tipo, edicao) {
  for (const id of PACOTES_OFICIAIS[edicao] ?? []) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    const idx = await pack.getIndex({ fields: ["system.identifier"] });
    const e = idx.find((x) => x.type === tipo && foundry.utils.getProperty(x, "system.identifier") === identificador);
    if (e) return pack.getDocument(e._id);
  }
  return null;
}

/** A edição do item; sem ela, a da classe/subclasse do ator. */
function edicaoPara(item) {
  const propria = edicaoDoItem(item);
  if (propria) return { edicao: propria, pela: "item" };
  for (const tipo of ["subclass", "class"]) {
    const c = item.parent?.items?.find((i) => i.type === tipo && edicaoDoItem(i));
    if (c) return { edicao: edicaoDoItem(c), pela: `classe (${c.name})` };
  }
  return { edicao: null, pela: null };
}

/** Guarda o "antes" (só na primeira mudança, para o desfazer voltar ao original). */
async function guardarAntes(item, extra) {
  if (item.getFlag(MODULE_ID, FLAG)) return;
  await item.setFlag(MODULE_ID, FLAG, { em: new Date().toISOString(), ...extra });
}

/** 1. As habilidades decididas, iguais ao oficial. */
async function corrigirHabilidades({ simular }) {
  const feito = [];
  for (const ator of game.actors.filter((a) => ["character", "npc"].includes(a.type))) {
    for (const item of ator.items.filter((i) => CORRECOES_DECIDIDAS.includes(i.identifier))) {
      const linha = { ator: ator.name, item: item.name, item_id: item.id, identificador: item.identifier };
      const { edicao, pela } = edicaoPara(item);
      if (!edicao) { feito.push({ ...linha, resultado: "sem_edicao", o_que: "o item e a classe não dizem a edição: não decido" }); continue; }
      const of = await oficial(item.identifier, item.type, edicao);
      if (!of) { feito.push({ ...linha, edicao, resultado: "sem_oficial", o_que: `não há "${item.identifier}" ${edicao} no compêndio do dnd5e` }); continue; }
      const fonte = item.toObject();
      const plano = planoDoItem(fonte, of.toObject());
      if (plano.igual) { feito.push({ ...linha, edicao, oficial: of.uuid, resultado: "ja_igual" }); continue; }
      const resumo = { ...linha, edicao, edicao_pela: pela, oficial: of.uuid, apagou_efeitos: plano.apagarEfeitos.length, criou_efeitos: plano.criarEfeitos.length, apagou_atividades: plano.apagarAtividades.length, criou_atividades: Object.keys(plano.criarAtividades).length };
      if (simular) { feito.push({ ...resumo, resultado: "simulado" }); continue; }
      await guardarAntes(item, { tipo: "item", oficial: of.uuid, antes: antesDoItem(fonte) });
      if (plano.apagarEfeitos.length) await item.deleteEmbeddedDocuments("ActiveEffect", plano.apagarEfeitos);
      if (plano.criarEfeitos.length) await item.createEmbeddedDocuments("ActiveEffect", plano.criarEfeitos.map((e) => ({ ...e, origin: item.uuid })), { keepId: true });
      for (const id of plano.apagarAtividades) await item.deleteActivity(id);
      const criar = Object.entries(plano.criarAtividades);
      if (criar.length) await item.update(Object.fromEntries(criar.map(([id, dados]) => [`system.activities.${id}`, dados])));
      feito.push({ ...resumo, resultado: "corrigido" });
    }
  }
  return feito;
}

/** 2. As escalas que faltam e existem na classe oficial. */
async function corrigirEscalas({ simular }) {
  const feito = [];
  const r = await auditar({ compendio: true });
  const porClasse = new Map(); // `${ator}|${classe}` -> { ator, classeItem, oficialUuid, ids }
  for (const p of r.problemas.filter((x) => x.parte === "escala_ausente" && x.existe_no_oficial === true && x.oficial)) {
    const ator = game.actors.find((a) => a.name === p.ator);
    const classe = ator?.items.find((i) => ["class", "subclass"].includes(i.type) && i.name === p.classe_no_ator?.nome);
    if (!classe) continue;
    const k = `${ator.id}|${classe.id}`;
    if (!porClasse.has(k)) porClasse.set(k, { ator, classe, oficialUuid: p.oficial, termos: [] });
    porClasse.get(k).termos.push(p.termo);
  }
  for (const { ator, classe, oficialUuid, termos } of porClasse.values()) {
    const of = await fromUuid(oficialUuid);
    if (!of) continue;
    const faltam = escalasQueFaltam(classe.toObject().system?.advancement, of.toObject().system?.advancement)
      .filter((a) => termos.some((t) => t.endsWith(`.${a.configuration?.identifier ?? a.identifier}`)));
    for (const a of faltam) {
      const ident = a.configuration?.identifier ?? a.identifier;
      const linha = { ator: ator.name, classe: classe.name, escala: ident, oficial: oficialUuid };
      if (simular) { feito.push({ ...linha, resultado: "simulado" }); continue; }
      await guardarAntes(classe, { tipo: "classe", oficial: oficialUuid, escalas_criadas: [] });
      const { _id, ...dados } = a;
      await classe.createAdvancement("ScaleValue", dados, { renderSheet: false });
      const flag = classe.getFlag(MODULE_ID, FLAG) ?? {};
      if (Array.isArray(flag.escalas_criadas)) {
        const criada = classe.advancement?.byType?.ScaleValue?.find((x) => x.identifier === ident);
        await classe.setFlag(MODULE_ID, FLAG, { ...flag, escalas_criadas: [...flag.escalas_criadas, criada?.id].filter(Boolean) });
      }
      feito.push({ ...linha, resultado: "corrigido" });
    }
  }
  return feito;
}

/** Aplica tudo o que tem fonte canônica clara. `{ simular: true }` só diz o que faria. */
export async function aplicarCanonico({ simular = false } = {}) {
  const habilidades = await corrigirHabilidades({ simular });
  const escalas = await corrigirEscalas({ simular });
  const corrigidos = [...habilidades, ...escalas].filter((x) => x.resultado === "corrigido");
  const naoDecidido = habilidades.filter((x) => x.resultado === "sem_edicao" || x.resultado === "sem_oficial");
  if (corrigidos.length) {
    console.log(`${MODULE_ID} | correções canônicas:`, corrigidos);
    ui.notifications?.info(`Companion: ${corrigidos.length} correção(ões) canônica(s) aplicada(s) (veja o console).`);
  }
  if (naoDecidido.length) console.warn(`${MODULE_ID} | sem fonte para decidir:`, naoDecidido);
  return { simular, habilidades, escalas };
}

/** Volta ao "antes" guardado: as habilidades (efeitos e atividades) e as escalas criadas. */
export async function desfazerCanonico() {
  const feito = [];
  for (const ator of game.actors) {
    for (const item of ator.items) {
      const f = item.getFlag(MODULE_ID, FLAG);
      if (!f) continue;
      if (f.tipo === "item" && f.antes) {
        const ids = Array.from(item.effects ?? []).map((e) => e.id);
        if (ids.length) await item.deleteEmbeddedDocuments("ActiveEffect", ids);
        if (f.antes.effects?.length) await item.createEmbeddedDocuments("ActiveEffect", f.antes.effects, { keepId: true });
        for (const a of Array.from(item.system?.activities ?? [])) await item.deleteActivity(a.id);
        const atv = Object.entries(f.antes.activities ?? {});
        if (atv.length) await item.update(Object.fromEntries(atv.map(([id, d]) => [`system.activities.${id}`, d])));
      }
      if (f.tipo === "classe") for (const id of f.escalas_criadas ?? []) await item.deleteAdvancement(id);
      await item.unsetFlag(MODULE_ID, FLAG);
      feito.push({ ator: ator.name, item: item.name, tipo: f.tipo });
    }
  }
  console.log(`${MODULE_ID} | correções canônicas desfeitas:`, feito);
  return feito;
}
