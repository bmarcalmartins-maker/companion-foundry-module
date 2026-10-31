import { MODULE_ID } from "./settings.js";
import { isReportingGm, postInbound } from "./equip-sync.js";
import { depoisDoEnvio, enfileirar, eventoDaMensagem, eventoDaVida } from "./combate.js";
import { criarVigiaDoCombate } from "./combate-estado.js";

/**
 * OS ACERTOS E O DANO → Companion (v1.11.0; as regras em combate.js). Só no
 * navegador do GM ATIVO (isReportingGm): os ganchos createChatMessage e
 * dnd5e.damageActor disparam em todo navegador, e um só manda.
 *
 * Cada personagem tem a sua fila: os eventos se juntam por 2 s e vão num
 * pedido só (`op: "combate.evento"`, até 50), para não gastar o limite da
 * edge (60 pedidos por minuto por actor). Rede, 429 ou 5xx: tenta de novo até
 * 3 vezes, esperando mais a cada vez; o id de cada evento faz o reenvio não
 * duplicar. Sem sessão em andamento no Companion, a edge não grava nada (e diz
 * "sem_sessao"): os eventos não voltam para a fila.
 *
 * Liga e desliga: a configuração "Acertos e dano ao Companion" (do mundo).
 */

const ESPERA_MS = 2_000;
const ESPERA_ERRO_MS = 5_000;
const RETENTATIVAS = 3;
const POR_PEDIDO = 50;

const filas = new Map(); // actorId -> eventos
const timers = new Map(); // actorId -> timeout
const tentativas = new Map(); // actorId -> nº de tentativas da rodada
const emVoo = new Set();

const ligado = () => game.settings.get(MODULE_ID, "combateAoCompanion") !== false;
const combateAtual = () => (game.combat?.started ? game.combat.id : null);

function agendar(actorId, ms = ESPERA_MS) {
  clearTimeout(timers.get(actorId));
  timers.set(
    actorId,
    setTimeout(() => {
      timers.delete(actorId);
      void enviar(actorId);
    }, ms),
  );
}

function guardar(actorId, evento) {
  filas.set(actorId, enfileirar(filas.get(actorId) ?? [], evento));
  if (!emVoo.has(actorId)) agendar(actorId);
}

async function enviar(actorId) {
  const fila = filas.get(actorId) ?? [];
  if (!fila.length || emVoo.has(actorId)) return;
  const lote = fila.slice(0, POR_PEDIDO);
  emVoo.add(actorId);
  let res;
  try {
    res = await postInbound({ op: "combate.evento", actor_id: actorId, eventos: lote }, { silencioso404: true });
  } finally {
    emVoo.delete(actorId);
  }
  const decisao = depoisDoEnvio(res);
  if (decisao === "repete") {
    const n = (tentativas.get(actorId) ?? 0) + 1;
    if (n <= RETENTATIVAS) {
      tentativas.set(actorId, n);
      agendar(actorId, ESPERA_ERRO_MS * n);
      return;
    }
    console.warn(`${MODULE_ID} | combate: ${lote.length} evento(s) de ${actorId} não chegaram ao Companion depois de ${RETENTATIVAS} tentativas`);
  } else if (decisao === "descarta" && res?.code !== "actor_nao_vinculado") {
    console.error(`${MODULE_ID} | combate: a edge recusou ${lote.length} evento(s) (${res?.status})`);
  } else if (res?.motivo === "sem_sessao") {
    console.log(`${MODULE_ID} | combate: nenhuma sessão em andamento no Companion — ${lote.length} evento(s) não gravados`);
  }
  tentativas.delete(actorId);
  // tira o lote que foi (ou desistiu); o que chegou durante o envio fica
  const ids = new Set(lote.map((e) => e.id));
  const resto = (filas.get(actorId) ?? []).filter((e) => !ids.has(e.id));
  if (resto.length) {
    filas.set(actorId, resto);
    agendar(actorId);
  } else {
    filas.delete(actorId);
  }
}

export function registerCombateSync() {
  const tipoDoAtor = (id) => game.actors.get(id)?.type ?? null;

  Hooks.on("createChatMessage", (msg) => {
    if (!ligado() || !isReportingGm()) return;
    const r = eventoDaMensagem(msg, { tipoDoAtor, combateId: combateAtual() });
    if (r) guardar(r.actorId, r.evento);
  });

  Hooks.on("dnd5e.damageActor", (actor, changes) => {
    if (!ligado() || !isReportingGm()) return;
    const r = eventoDaVida(actor, changes, { novoId: () => foundry.utils.randomID(16), combateId: combateAtual() });
    if (r) guardar(r.actorId, r.evento);
  });

  // v1.21.0 (TRANCHE R, a trilha pelo clima): o combate começou ou acabou,
  // pela edge foundry-combate (a mesma chave de entrada; a URL é a da entrada
  // com o nome trocado). Só o GM ativo manda; a mesma configuração liga e desliga.
  const vigia = criarVigiaDoCombate({
    enviar: (corpo) => postInbound(corpo, { silencioso404: true, rota: "foundry-combate" }),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  vigia.conhecer(game.combats?.contents ?? []);
  Hooks.on("updateCombat", (combat) => {
    if (!ligado() || !isReportingGm()) return;
    void vigia.aoAtualizar(combat);
  });
  Hooks.on("deleteCombat", (combat) => {
    if (!ligado() || !isReportingGm()) return;
    void vigia.aoApagar(combat);
  });

  console.log(`${MODULE_ID} | acertos, dano e início/fim do combate → Companion registrados`);
}
