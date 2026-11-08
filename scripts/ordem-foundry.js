import { MODULE_ID } from "./settings.js";
import { isReportingGm, postInbound } from "./equip-sync.js";
import { depoisDoEnvio } from "./combate.js";
import {
  COMPARA_MS,
  ESPERA_DA_FOTO_MS,
  chaveDoEnvio,
  combateParaMostrar,
  comandoDeTurno,
  focarCombatente,
  fotoDoCombate,
  oQueMandar,
  versoesDoModulo,
} from "./ordem.js";
import { VERSAO_DO_CODIGO } from "./versao.js";

/**
 * A ORDEM DO COMBATE ligada ao Foundry (v1.24.0; as regras em ordem.js).
 *
 * - Em TODO navegador, no `init`: responde a versão DESTE código à pergunta do
 *   GM (`companion-foundry-bridge.versao`, CONFIG.queries); no `ready`, avisa na
 *   tela se o código carregado é mais velho que o módulo instalado (o cache de
 *   4 h do Foundry): "recarregue com Ctrl+Shift+R".
 * - No GM ATIVO, no `ready`: a FOTO do combate começado na cena ativa vai à
 *   edge foundry-combate (op combate.ordem) quando muda e a cada 30 s (o "estou
 *   vivo"); cada gancho só agenda uma comparação para daqui a 0,4 s, e a cada 4 s
 *   uma comparação local pega o que nenhum gancho avisou. Um envio por vez.
 * - No GM ATIVO (iniciativa-foundry.js, op combate.comando): "proximo",
 *   "anterior" (sem os eventos de turno: o dnd5e não recupera nada ao voltar) e
 *   "focar" (o token selecionado e a câmera nele).
 */

export const QUERY_VERSAO = "companion-foundry-bridge.versao";
const ESPERA_ERRO_MS = 5_000;
const PERGUNTA_VERSAO_MS = 5 * 60_000;
const ESPERA_RESPOSTA_MS = 5_000;
const ESPERA_CENA_MS = 10_000;

const ligado = () => game.settings.get(MODULE_ID, "ordemAoCompanion") !== false;

/* -------------------------------------------- */
/*  A versão (todo navegador)                   */
/* -------------------------------------------- */

export function registerVersaoQuery() {
  if (CONFIG.queries) CONFIG.queries[QUERY_VERSAO] = () => ({ codigo: VERSAO_DO_CODIGO });
}

/** No `ready` de todo navegador: o código velho no cache avisa na tela. */
export function avisarCodigoVelho() {
  const servidor = game.modules.get(MODULE_ID)?.version ?? null;
  if (!servidor || servidor === VERSAO_DO_CODIGO) return;
  const texto = game.i18n.format("CFB.Versao.Recarregue", { servidor, codigo: VERSAO_DO_CODIGO });
  console.warn(`${MODULE_ID} | ${texto}`);
  ui.notifications?.warn(texto, { permanent: true });
}

/* -------------------------------------------- */
/*  A foto do combate (GM ativo)                */
/* -------------------------------------------- */

let ultima = null; // { chave, em, ativo } do último envio que o Companion recebeu
let emVoo = false;
let deNovo = false;
let timer = null;
let navegadores = [];
let perguntando = false;

function versoes() {
  return versoesDoModulo({ servidor: game.modules.get(MODULE_ID)?.version ?? null, codigo: VERSAO_DO_CODIGO, navegadores });
}

function agendar(ms = ESPERA_DA_FOTO_MS) {
  clearTimeout(timer);
  timer = setTimeout(() => void comparar(), ms);
}

async function comparar() {
  if (!ligado() || !isReportingGm()) return;
  if (emVoo) {
    deNovo = true;
    return;
  }
  const foto = fotoDoCombate(combateParaMostrar(game));
  const modulo = versoes();
  const chave = chaveDoEnvio(foto, modulo);
  if (!oQueMandar(chave, !!foto, ultima, Date.now())) return;
  emVoo = true;
  let res;
  try {
    res = await postInbound({ op: "combate.ordem", combate: foto, modulo }, { silencioso404: true, rota: "foundry-combate" });
  } finally {
    emVoo = false;
  }
  const decisao = depoisDoEnvio(res);
  if (decisao === "repete") {
    agendar(ESPERA_ERRO_MS); // rede, 429, 5xx: a próxima comparação manda de novo
  } else {
    if (decisao === "descarta") console.warn(`${MODULE_ID} | ordem do combate: a edge recusou (${res?.status ?? "?"})`);
    // recusado também conta como mandado: sem isso, a cada 4 s o mesmo erro
    ultima = { chave, em: Date.now(), ativo: !!foto };
  }
  if (deNovo) {
    deNovo = false;
    agendar();
  }
}

/** Pergunta a versão do código a cada navegador conectado (quem não responde roda código anterior ao 1.24.0). */
async function perguntarVersoes() {
  if (perguntando || !isReportingGm()) return;
  perguntando = true;
  try {
    const outros = game.users.filter((u) => u.active && u.id !== game.user.id);
    const respostas = await Promise.all(
      outros.map(async (u) => {
        let codigo = null;
        try {
          const r = await u.query(QUERY_VERSAO, {}, { timeout: ESPERA_RESPOSTA_MS });
          codigo = typeof r?.codigo === "string" ? r.codigo : null;
        } catch {
          codigo = null;
        }
        return { usuario: u.name, gm: u.isGM === true, codigo };
      }),
    );
    navegadores = [{ usuario: game.user.name, gm: true, codigo: VERSAO_DO_CODIGO }, ...respostas];
  } finally {
    perguntando = false;
  }
  agendar();
}

/* -------------------------------------------- */
/*  Os comandos do Mestre (GM ativo)            */
/* -------------------------------------------- */

let voltandoSemEventos = null; // o id do combate que o Companion está voltando

/** O gancho combatTurn/combatRound pode mudar as opções antes de gravar (o Foundry 14). */
function semEventosAoVoltar(combate, _dados, opcoes) {
  if (voltandoSemEventos && combate?.id === voltandoSemEventos && opcoes && opcoes.direction === -1) {
    opcoes.turnEvents = false;
  }
}

async function voltarTurno(combate) {
  voltandoSemEventos = combate.id;
  try {
    await combate.previousTurn();
  } finally {
    voltandoSemEventos = null;
  }
}

/** O token selecionado e a câmera nele; com o GM noutra cena, só a visão DELE vai até lá. */
async function focar(cena, tokenDoc) {
  if (globalThis.canvas?.scene?.id !== cena.id) {
    let idDoGancho = null;
    const pronto = new Promise((resolve) => {
      idDoGancho = Hooks.once("canvasReady", () => resolve(true));
      setTimeout(() => resolve(false), ESPERA_CENA_MS);
    });
    await cena.view();
    if (globalThis.canvas?.scene?.id !== cena.id) await pronto;
    if (idDoGancho !== null) Hooks.off("canvasReady", idDoGancho);
  }
  const token = tokenDoc.object ?? globalThis.canvas?.tokens?.get?.(tokenDoc.id);
  if (!token) return { recusado: "sem_token" };
  token.control({ releaseOthers: true });
  const centro = token.center;
  await globalThis.canvas.animatePan({ x: centro.x, y: centro.y, duration: 500 });
  return { focado: true };
}

const deps = () => ({ game, passarTurno: (c) => c.nextTurn(), voltarTurno, focar });

/** No GM ativo: as ações da ordem na op combate.comando (iniciativa-foundry.js). */
export function comandoDaOrdem(payload) {
  if (payload?.acao === "focar") return focarCombatente(payload, deps());
  return comandoDeTurno(payload, deps());
}

/* -------------------------------------------- */
/*  O registro (GM, no ready)                   */
/* -------------------------------------------- */

export function registerOrdemSync() {
  const gancho = () => {
    if (ligado() && isReportingGm()) agendar();
  };
  for (const nome of [
    "createCombat",
    "updateCombat",
    "deleteCombat",
    "combatTurnChange",
    "createCombatant",
    "updateCombatant",
    "deleteCombatant",
    "updateActor",
    "updateActorDelta",
    "updateToken",
    "dnd5e.damageActor",
    "canvasReady",
  ]) {
    Hooks.on(nome, gancho);
  }
  Hooks.on("updateScene", (_cena, mudanca) => {
    if (mudanca && "active" in mudanca) gancho();
  });
  Hooks.on("combatTurn", semEventosAoVoltar);
  Hooks.on("combatRound", semEventosAoVoltar);
  Hooks.on("userConnected", () => setTimeout(() => void perguntarVersoes(), 3_000));
  setInterval(() => {
    if (ligado() && isReportingGm()) void comparar();
  }, COMPARA_MS);
  setInterval(() => void perguntarVersoes(), PERGUNTA_VERSAO_MS);
  void perguntarVersoes(); // e manda a primeira foto (ou "sem combate")
  console.log(`${MODULE_ID} | ordem do combate → Companion registrada (código ${VERSAO_DO_CODIGO})`);
}
