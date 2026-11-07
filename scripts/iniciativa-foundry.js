import { MODULE_ID } from "./settings.js";
import { isReportingGm, postInbound } from "./equip-sync.js";
import { depoisDoEnvio } from "./combate.js";
import {
  QUERY_ROLAR_INICIATIVA,
  VIGIA_MS,
  abrirCombate,
  eventoDeRolagem,
  listarCena,
  perguntarAoJogador,
  rolarNoJogador,
  rolarPeloCompanion,
  selecionadosNaCena,
  textoDaJanela,
  textoDaRolagem,
} from "./iniciativa.js";

/**
 * A INICIATIVA FALADA ligada ao Foundry (v1.23.0; as regras em iniciativa.js).
 *
 * - Em TODO navegador, no `init`: o handler da pergunta
 *   `companion-foundry-bridge.rolarIniciativa` (CONFIG.queries), que abre a
 *   janela "Rolar iniciativa?" no navegador do jogador (ou rola direto, quando
 *   o pedido veio do botão do Companion); e a marca "rolado pelo Companion" na
 *   mensagem do chat.
 * - No GM ATIVO (bridge-client.js, op `combate.comando`): `comandoDeCombate`.
 * - No GM ATIVO, no `ready`: a seleção de tokens (controlToken) enquanto um
 *   cartão está aberto, quem rolou (updateCombatant) e o combate apagado
 *   (deleteCombat), pela edge foundry-combate.
 */

const t = (k) => game.i18n.localize(k);
const RETENTATIVAS = 3;
const ESPERA_ERRO_MS = 3_000;

/* -------------------------------------------- */
/*  Rolar (no navegador de quem rola)           */
/* -------------------------------------------- */

/**
 * Rola a iniciativa de UM combatente como o usuário deste navegador. Vindo do
 * Companion, a mensagem diz "rolado pelo Companion" (e o GM que rola por
 * quem não está no Foundry diz também que foi ele).
 */
function rolarNoFoundry(combate, combatente, { pelo_companion = false } = {}) {
  if (!pelo_companion) return combate.rollInitiative([combatente.id]);
  const pelo_gm = game.user?.isGM === true;
  return combate.rollInitiative([combatente.id], {
    messageOptions: {
      flavor: textoDaRolagem({ nome: combatente.name, pelo_gm }, t),
      flags: { [MODULE_ID]: { iniciativa: { pelo_companion: true, pelo_gm } } },
    },
  });
}

/** A janela "Rolar iniciativa?"; fecha sozinha se a iniciativa chega por outro caminho. */
async function perguntarNoFoundry({ combate, combatente }) {
  const { DialogV2 } = foundry.applications.api;
  let janela = null;
  const fechar = () => {
    try {
      void janela?.close();
    } catch {
      /* já fechada */
    }
  };
  const ganchos = [
    ["updateCombatant", Hooks.on("updateCombatant", (doc, mudanca) => {
      if (doc?.id === combatente.id && typeof mudanca?.initiative === "number") fechar();
    })],
    ["deleteCombatant", Hooks.on("deleteCombatant", (doc) => { if (doc?.id === combatente.id) fechar(); })],
    ["deleteCombat", Hooks.on("deleteCombat", (doc) => { if (doc?.id === combate.id) fechar(); })],
  ];
  try {
    return await DialogV2.confirm({
      window: { title: t("CFB.Iniciativa.Titulo"), icon: "fa-solid fa-dice-d20" },
      content: textoDaJanela({ nome: combatente.name }, t),
      yes: { label: t("CFB.Iniciativa.Rolar"), icon: "fa-solid fa-dice-d20", default: true },
      no: { label: t("CFB.Iniciativa.AgoraNao") },
      rejectClose: false,
      render: (_ev, d) => {
        janela = d;
      },
    });
  } finally {
    for (const [nome, id] of ganchos) Hooks.off(nome, id);
  }
}

/** No `init`, em todo navegador. Foundry sem CONFIG.queries (v12): nada. */
export function registerIniciativaQuery() {
  if (CONFIG.queries) {
    CONFIG.queries[QUERY_ROLAR_INICIATIVA] = (dados) =>
      rolarNoJogador(dados, { game, perguntar: perguntarNoFoundry, rolar: rolarNoFoundry });
  }
  // A marca "rolado pelo Companion" na mensagem, se o Foundry não tiver usado
  // o flavor pedido (HIPÓTESE até o teste: o core usa o messageOptions.flavor).
  Hooks.on("preCreateChatMessage", (msg) => {
    const marca = msg?.flags?.[MODULE_ID]?.iniciativa;
    if (!marca?.pelo_companion) return;
    if (String(msg.flavor ?? "").includes("Companion")) return;
    const nome = msg.speaker?.alias ?? "";
    msg.updateSource({ flavor: textoDaRolagem({ nome, pelo_gm: marca.pelo_gm === true }, t) });
  });
}

/* -------------------------------------------- */
/*  O GM ativo: os comandos e a vigia           */
/* -------------------------------------------- */

/** Um cartão aberto no Companion: o GM manda a seleção dele enquanto durar. */
let vigia = null; // { rodadaId, cenaId, ate, ultima }
let timerDaSelecao = null;

function pararDeVigiar(rodadaId) {
  if (!vigia || !rodadaId || vigia.rodadaId === rodadaId) {
    vigia = null;
    clearTimeout(timerDaSelecao);
  }
}

async function miniatura(src) {
  if (!src) return null;
  const helper = foundry.helpers?.media?.ImageHelper ?? globalThis.ImageHelper;
  if (!helper?.createThumbnail) return null;
  try {
    const r = await Promise.race([
      helper.createThumbnail(src, { width: 48, height: 48, format: "image/webp", quality: 0.7 }),
      new Promise((resolve) => setTimeout(() => resolve(null), 3_000)),
    ]);
    return typeof r?.thumb === "string" && r.thumb.length < 20_000 ? r.thumb : null;
  } catch {
    return null;
  }
}

const deps = () => ({
  game,
  // CONFIG.Combat.documentClass: o Combat5e do dnd5e
  criarCombate: (cena) => CONFIG.Combat.documentClass.create({ scene: cena.id, active: true }),
  rolar: (combate, ids) => combate.rollInitiative(ids),
  perguntar: (args) => perguntarAoJogador(args, { game }),
  rolarNoGm: (combate, combatente) => rolarNoFoundry(combate, combatente, { pelo_companion: true }),
  reportarFalha: (pedido_id, motivo) => mandar({ op: "iniciativa.falhou", pedido_id, motivo }),
});

/** No GM ativo: a op `combate.comando` da ponte (iniciativa.js). */
export async function comandoDeCombate(payload) {
  switch (payload?.acao) {
    case "cena": {
      const cena = await listarCena({ game, canvas: globalThis.canvas, pcs: payload.pcs, miniatura });
      if (!cena.erro && payload.rodada_id) {
        vigia = { rodadaId: payload.rodada_id, cenaId: cena.cena.id, ate: Date.now() + VIGIA_MS, ultima: cena.selecionados.join(",") };
      }
      return { cena };
    }
    case "abrir":
      pararDeVigiar(payload.rodada_id);
      return abrirCombate(payload, deps());
    case "rolar":
      return rolarPeloCompanion(payload, deps());
    case "comecar": {
      const combate = game.combats?.get(payload.combate_id);
      if (!combate) throw new Error("combate_sumiu");
      if (combate.started) return { ja_comecado: true };
      await combate.startCombat();
      return { comecou: true };
    }
    case "parar":
      pararDeVigiar(payload.rodada_id);
      return { parado: true };
    default:
      throw new Error(`acao_desconhecida: ${payload?.acao}`);
  }
}

/** Manda à edge foundry-combate, com até 3 tentativas (rede, 429, 5xx). */
async function mandar(corpo, tentativa = 1) {
  const res = await postInbound(corpo, { silencioso404: true, rota: "foundry-combate" });
  if (depoisDoEnvio(res) === "repete" && tentativa < RETENTATIVAS) {
    await new Promise((r) => setTimeout(r, ESPERA_ERRO_MS * tentativa));
    return mandar(corpo, tentativa + 1);
  }
  if (!res?.ok) console.warn(`${MODULE_ID} | iniciativa: ${corpo.op} não chegou ao Companion`, res?.status ?? "");
  return res;
}

function mandarSelecao() {
  if (!vigia || Date.now() > vigia.ate) {
    vigia = null;
    return;
  }
  const ids = selecionadosNaCena(globalThis.canvas, vigia.cenaId);
  if (globalThis.canvas?.scene?.id !== vigia.cenaId) return; // o Mestre está vendo outra cena
  const chave = ids.join(",");
  if (chave === vigia.ultima) return;
  vigia.ultima = chave;
  void mandar({ op: "iniciativa.selecao", rodada_id: vigia.rodadaId, cena_id: vigia.cenaId, selecionados: ids });
}

/** No `ready` do GM. */
export function registerIniciativaSync() {
  Hooks.on("controlToken", () => {
    if (!vigia || !isReportingGm()) return;
    clearTimeout(timerDaSelecao);
    timerDaSelecao = setTimeout(mandarSelecao, 500);
  });
  Hooks.on("updateCombatant", (combatente, mudanca, _opcoes, userId) => {
    if (!isReportingGm()) return;
    const ev = eventoDeRolagem(combatente, mudanca, userId, game);
    if (ev) void mandar(ev);
  });
  Hooks.on("deleteCombat", (combate) => {
    if (!isReportingGm() || !combate?.id) return;
    void mandar({ op: "iniciativa.combate_fim", combate_id: combate.id });
  });
  console.log(`${MODULE_ID} | iniciativa falada: seleção, rolagens e fim do combate → Companion registrados`);
}
