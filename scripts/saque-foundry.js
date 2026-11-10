import { MODULE_ID } from "./settings.js";
import { postInbound } from "./equip-sync.js";
import { donoDoAtor } from "./magias.js";
import {
  ESPERA_DA_DECISAO_MS,
  ESPERA_DA_JANELA_MS,
  QUERY_ABRIR_SAQUE,
  QUERY_DECIDIR_SAQUE,
  corpoDaDecisao,
  corpoDoAtor,
  criarMemoriaDeMortes,
  dadosDaJanela,
  depoisDaDecisao,
  estadoInicial,
  fraseDaFalha,
  htmlDaJanela,
  htmlDoCartaoDeEncerrada,
  htmlDoCartaoDeMorte,
  htmlDoCartaoDePedido,
  htmlDoCartaoDeResultado,
  htmlDoCartaoDeRolar,
  htmlDoCartaoResolvido,
  htmlDoCartaoSemAtor,
  mandarComRetentativa,
  morreuPeloDano,
  mortoPeloCombatente,
  mortoPeloEfeito,
  rolagemDoSaque,
  validarComando,
} from "./saque.js";

/**
 * O SAQUE ligado ao Foundry (v1.25.0; as regras e os desenhos em saque.js; o
 * contrato e as HIPÓTESES em docs/SAQUE.md).
 *
 * - Em TODO navegador, no `init` (`registerSaqueQueries`): as duas perguntas
 *   (CONFIG.queries) e o clique dos botões dos cartões (renderChatMessageHTML).
 *   No navegador do jogador roda só: o botão "Rolar Investigação" (a rolagem
 *   NATIVA do dnd5e, como ele mesmo) e a janela de pergaminho.
 * - No GM ATIVO, no `ready` (`registerSaqueSync`): os três sinais de morte de
 *   um NPC e a mensagem da Investigação, pela edge foundry-saque.
 * - No GM ATIVO (bridge-client.js, op `saque.comando`): `receberComandoDeSaque`.
 *
 * Só o GM ATIVO fala com a edge (é quem tem a chave de entrada). O critério é
 * o de main.js (`souOGmAtivo`), NÃO o `isReportingGm()` de equip-sync.js, que
 * devolve verdadeiro quando não há GM ativo: todo jogador se acharia "o GM".
 *
 * Liga e desliga: a configuração "O saque no Companion" (do mundo).
 */

const ROTA = "foundry-saque";

function souOGmAtivo() {
  return !!game.user?.isGM && game.users?.activeGM?.id === game.user.id;
}
const ligado = () => game.settings.get(MODULE_ID, "saqueAoCompanion") !== false;
const enviar = (corpo) => postInbound(corpo, { rota: ROTA });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const avisar = (frase) => ui.notifications?.warn(frase);
const idsDosGms = () => [...(game.users ?? [])].filter((u) => u?.isGM).map((u) => u.id);

/* -------------------------------------------- */
/*  Os cartões do chat                          */
/* -------------------------------------------- */

/**
 * Cria o cartão SUSSURRADO a `para` (ids de usuário). Nas flags só ids (o
 * jogador lê as flags de toda mensagem que recebe): nada do conteúdo do saque.
 *
 * `CONFIG.ChatMessage.documentClass.create`: o mesmo jeito que o módulo já
 * cria o combate (iniciativa-foundry.js, CONFIG.Combat.documentClass). Os
 * campos `content`, `whisper` (ids), `speaker.alias` e `flags`: tipos v14,
 * common/documents/chat-message.d.mts:349-360.
 * HIPÓTESE (sem teste no Foundry): que a limpeza do HTML do `content` guarde
 * o <button> e os atributos data-*.
 */
async function criarCartao(html, { para, tipo, corpo_id = null, revista_id = null }) {
  if (!html) return null;
  try {
    return await CONFIG.ChatMessage.documentClass.create({
      content: html,
      whisper: [...new Set(para)],
      speaker: { alias: "Companion" },
      flags: { [MODULE_ID]: { saque_cartao: { tipo, corpo_id, revista_id } } },
    });
  } catch (err) {
    console.error(`${MODULE_ID} | saque: não consegui criar o cartão (${tipo})`, err);
    return null;
  }
}

/** Troca o conteúdo de um cartão pelo estado novo, sem botões (só o GM consegue). */
async function resolverCartao(mensagem, frase) {
  try {
    await mensagem?.update?.({ content: htmlDoCartaoResolvido(frase) });
  } catch (err) {
    console.warn(`${MODULE_ID} | saque: o cartão não foi atualizado`, err);
  }
}

/** O último cartão do saque com este tipo e esta chave (`game.messages.contents`, uma Collection). */
function acharCartao(tipo, campo, valor) {
  const todas = game.messages?.contents ?? [];
  for (let i = todas.length - 1; i >= 0; i--) {
    const c = todas[i]?.flags?.[MODULE_ID]?.saque_cartao;
    if (c?.tipo === tipo && c[campo] === valor) return todas[i];
  }
  return null;
}

/* -------------------------------------------- */
/*  Os três sinais de morte (GM ativo)          */
/* -------------------------------------------- */

const mortes = criarMemoriaDeMortes();

async function avisarMorte(ator, { nomeDoToken = null } = {}) {
  // O ator de base tem o MESMO id do ator do token sem vínculo (tipos v14,
  // client/documents/actor.d.mts:1248 e :1263): o nome dele vem do mundo.
  const corpo = corpoDoAtor(ator, { nomeDoToken, nomeDeBase: game.actors?.get(ator?.id)?.name ?? null });
  if (!corpo || !mortes.nova(corpo.ator_uuid)) return;
  const res = await mandarComRetentativa(corpo, { enviar, esperar });
  if (!res?.ok) {
    // não chegou, ou não há o que fazer agora (sem sessão, desligado no
    // Companion): o próximo sinal deste corpo tenta de novo. Nada na tela.
    mortes.esquecer(corpo.ator_uuid);
    console.log(`${MODULE_ID} | saque: ${corpo.nome} caiu, mas o Companion não abriu o corpo (${res?.motivo ?? res?.error ?? res?.status ?? "sem resposta"})`);
    return;
  }
  if (res.ja_existia || !res.corpo_id) return;
  await criarCartao(
    htmlDoCartaoDeMorte({ corpo_id: res.corpo_id, nome: res.nome ?? corpo.nome, pcs: res.pcs, sem_ficha: res.alvo_tipo == null }),
    { para: idsDosGms(), tipo: "morte", corpo_id: res.corpo_id },
  );
}

/** No `ready` do GM. Cada gancho decide NA HORA se este navegador é o GM ativo. */
export function registerSaqueSync() {
  const vale = () => ligado() && souOGmAtivo();
  const tentar = (ator, extra) => void avisarMorte(ator, extra).catch((err) => console.error(`${MODULE_ID} | saque: o aviso de morte falhou`, err));

  // (a) dnd5e.damageActor(actor, changes, update, userId): dnd5e 5.3.3,
  // module/data/actor/templates/attributes.mjs:532-566 (já usado em combate-sync.js).
  // HIPÓTESE: que dispare para o ator de um token SEM vínculo.
  Hooks.on("dnd5e.damageActor", (ator, changes) => {
    if (vale() && morreuPeloDano(ator, changes)) tentar(ator);
  });

  // (b) createActiveEffect(efeito, opções, userId) (tipos v14,
  // client/hooks.d.mts:126 e :1903-1907; já usado em main.js) com o estado de
  // derrotado: CONFIG.specialStatusEffects.DEFEATED (client/config.d.mts:3534;
  // "dead" no dnd5e 5.3.3, module/config.mjs:3837-3840).
  Hooks.on("createActiveEffect", (efeito) => {
    if (!vale()) return;
    const ator = mortoPeloEfeito(efeito, CONFIG.specialStatusEffects?.DEFEATED);
    if (ator) tentar(ator);
  });

  // (c) updateCombatant(combatente, mudança, opções, userId) (já usado em
  // iniciativa-foundry.js) com `defeated: true`. O nome é o do token do
  // combatente (Combatant#token, client/documents/combatant.d.mts:1023).
  Hooks.on("updateCombatant", (combatente, mudanca) => {
    if (!vale()) return;
    const ator = mortoPeloCombatente(combatente, mudanca);
    if (ator) tentar(ator, { nomeDoToken: combatente.token?.name ?? null });
  });

  // A Investigação da revista: a mensagem com a nossa flag e o total.
  const mandadas = new Set();
  Hooks.on("createChatMessage", (msg) => {
    if (!souOGmAtivo()) return;
    const corpo = rolagemDoSaque(msg);
    if (!corpo || mandadas.has(corpo.mensagem_id)) return;
    mandadas.add(corpo.mensagem_id);
    void mandarComRetentativa(corpo, { enviar, esperar })
      .then((res) => {
        if (res?.ok) {
          const cartao = acharCartao("rolar", "revista_id", corpo.revista_id);
          if (cartao) void resolverCartao(cartao, `Investigação rolada: ${corpo.total}. O Mestre vê o resultado.`);
        } else {
          avisar(`Saque: ${fraseDaFalha(res)}`);
        }
      })
      .catch((err) => console.error(`${MODULE_ID} | saque: a rolagem não chegou ao Companion`, err));
  });

  console.log(`${MODULE_ID} | saque: mortes de NPC e a Investigação da revista → Companion registrados`);
}

/* -------------------------------------------- */
/*  O comando da ponte (GM ativo)               */
/* -------------------------------------------- */

const avisosVistos = new Set();

/** No GM ativo: a op `saque.comando` da ponte. Responde NA HORA; o resto vem depois. */
export function receberComandoDeSaque(payload) {
  if (!ligado()) return { recebido: false, motivo: "desligado" };
  const v = validarComando(payload);
  if (!v.ok) return { recebido: false, motivo: v.motivo };
  // o mesmo aviso reenviado pelo Companion não vira dois cartões
  const aviso = typeof payload.aviso_id === "string" ? payload.aviso_id : null;
  if (aviso) {
    if (avisosVistos.has(aviso)) return { recebido: true, repetido: true };
    avisosVistos.add(aviso);
  }
  Promise.resolve()
    .then(() => tratarComando(payload))
    .catch((err) => console.error(`${MODULE_ID} | saque: o comando ${payload.acao} falhou`, err));
  return { recebido: true };
}

async function tratarComando(payload) {
  const { acao, corpo, pc, revista } = payload;
  const gms = idsDosGms();
  const ator = pc?.foundry_actor_id ? game.actors?.get(pc.foundry_actor_id) : null;
  switch (acao) {
    case "pedido":
      await criarCartao(htmlDoCartaoDePedido({ corpo, pc }), { para: gms, tipo: "pedido", corpo_id: corpo.id });
      return;
    case "liberada": {
      // os donos JOGADORES do ator (conectados ou não: o cartão fica no chat).
      // Document#testUserPermission: já usado em magias.js (donoDoAtor).
      const donos = ator ? [...(game.users ?? [])].filter((u) => u && !u.isGM && ator.testUserPermission?.(u, "OWNER")) : [];
      if (!ator || !donos.length) {
        await criarCartao(htmlDoCartaoSemAtor({ corpo, pc }), { para: gms, tipo: "sem_ator", corpo_id: corpo.id, revista_id: revista.id });
        return;
      }
      // HIPÓTESE: que o sussurro chegue só aos usuários da lista (servidor do Foundry).
      await criarCartao(htmlDoCartaoDeRolar({ corpo, pc, revista, ator_id: ator.id }), {
        para: [...donos.map((u) => u.id), ...gms],
        tipo: "rolar",
        corpo_id: corpo.id,
        revista_id: revista.id,
      });
      return;
    }
    case "resultado":
      await criarCartao(htmlDoCartaoDeResultado({ corpo, pc, revista, achados: payload.achados }), {
        para: gms,
        tipo: "resultado",
        corpo_id: corpo.id,
        revista_id: revista.id,
      });
      return;
    case "revelada": {
      // revelado pelo Companion (e não pelo botão daqui): o cartão do resultado perde o botão
      const cartao = acharCartao("resultado", "revista_id", revista.id);
      if (cartao?.content?.includes?.("saque-revelar")) void resolverCartao(cartao, `Revelado a ${pc.nome ?? "?"}.`);
      // o dono ATIVO do ator (magias.js): um jogador conectado, dono dele
      const dono = ator ? donoDoAtor(ator, game.users) : null;
      const fora = `${pc.nome ?? "O jogador"} não está no Foundry: ele pega pelo Companion.`;
      if (!dono) {
        avisar(fora);
        return;
      }
      try {
        // User#query: tipos v14, client/documents/user.d.mts:1227-1231 (já usado em magias.js)
        await dono.query(QUERY_ABRIR_SAQUE, dadosDaJanela(payload), { timeout: ESPERA_DA_JANELA_MS });
      } catch (err) {
        console.warn(`${MODULE_ID} | saque: a janela não abriu no navegador de ${dono.name}`, err);
        avisar(fora);
      }
      return;
    }
    case "encerrada":
      await criarCartao(htmlDoCartaoDeEncerrada({ pegou: payload.pegou }), { para: gms, tipo: "encerrada", corpo_id: corpo.id });
      return;
    default:
  }
}

/* -------------------------------------------- */
/*  Os botões dos cartões (todo navegador)      */
/* -------------------------------------------- */

/** As ações do GM: a op da edge e a frase do cartão depois que deu certo. */
const ACOES_DO_GM = {
  "saque-liberar": (d) => ({ corpo: { op: "saque.liberar", corpo_id: d.corpo, pc_id: d.pc }, frase: `Liberado para ${d.pcNome || "o personagem"}.` }),
  "saque-fechar": (d) => ({ corpo: { op: "saque.fechar", corpo_id: d.corpo }, frase: "Sem saque." }),
  "saque-revelar": (d) => ({ corpo: { op: "saque.revelar", revista_id: d.revista }, frase: `Revelado a ${d.pcNome || "o personagem"}.` }),
};

/**
 * A Investigação NATIVA do dnd5e, no navegador de quem clicou (o diálogo, a
 * vantagem e os bônus da ficha). A mensagem leva a nossa flag com a revista.
 * FATO, dnd5e 5.3.3 (module/documents/actor/actor.mjs): `rollSkill(config,
 * dialog, message)` (:1209); o próprio sistema passa `{ data }` com flags do
 * mesmo jeito no pedido de teste em grupo (:1193-1197), e `#rollSkillTool`
 * funde `message.data.flags` com as dele (:1312-1330). "inv" é a
 * Investigação (module/config.mjs:219-222).
 */
async function rolarInvestigacao(evento, d) {
  const ator = game.actors?.get(d.ator);
  if (!ator?.isOwner) {
    avisar("Só quem controla este personagem rola a Investigação dele.");
    return;
  }
  if (typeof ator.rollSkill !== "function" || !d.revista) return;
  await ator.rollSkill({ skill: "inv", event: evento }, {}, { data: { flags: { [MODULE_ID]: { saque: d.revista } } } });
}

async function aoClicar(evento, mensagem, botao) {
  evento.preventDefault();
  const d = botao.dataset;
  const acao = d.cfbAcao;
  if (acao === "saque-rolar") {
    try {
      await rolarInvestigacao(evento, d);
    } catch (err) {
      console.error(`${MODULE_ID} | saque: a Investigação falhou`, err);
    }
    return;
  }
  const monta = ACOES_DO_GM[acao];
  if (!monta) return;
  if (!souOGmAtivo()) {
    avisar("Só o Mestre ativo decide o saque.");
    return;
  }
  const { corpo, frase } = monta(d);
  const botoes = [...(botao.closest(".cfb-saque-cartao")?.querySelectorAll("button") ?? [botao])];
  for (const b of botoes) b.disabled = true;
  const res = await enviar(corpo);
  if (res?.ok) {
    await resolverCartao(mensagem, frase);
    return;
  }
  for (const b of botoes) b.disabled = false;
  avisar(`Saque: ${fraseDaFalha(res)}`);
}

/* -------------------------------------------- */
/*  A janela de pergaminho (jogador)            */
/* -------------------------------------------- */

const janelas = new Map(); // revista_id -> janela
let ClasseDaJanela = null;

/**
 * A classe nasce no primeiro uso (o `foundry` não existe quando o teste importa
 * este arquivo). ApplicationV2 como em status-app.js: DEFAULT_OPTIONS,
 * `actions` (data-action; a ação roda com `this` = a janela e recebe
 * `(evento, alvo)`: tipos v14, client/applications/api/application.d.mts:364-372),
 * `_renderHTML`/`_replaceHTML` (:786, :795), `window.contentClasses` (:248-249),
 * `render({ force })` (:717), `close()` (:838), `bringToFront()` (:934).
 */
function classeDaJanela() {
  if (ClasseDaJanela) return ClasseDaJanela;
  const { ApplicationV2 } = foundry.applications.api;
  ClasseDaJanela = class JanelaDoSaque extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["companion-foundry-bridge", "cfb-saque-app"],
      tag: "div",
      // o título é fixo: o nome do corpo (texto de fora) vai escapado no miolo
      window: { title: "O saque", icon: "fa-solid fa-coins", resizable: true, contentClasses: ["cfb-saque-perg"] },
      position: { width: 600, height: "auto" },
      actions: {
        pegar: function (_ev, alvo) {
          return this.decidir(alvo?.dataset?.achado, true);
        },
        deixar: function (_ev, alvo) {
          return this.decidir(alvo?.dataset?.achado, false);
        },
        fechar: function () {
          return this.close();
        },
      },
    };

    constructor(dados) {
      super({ id: `cfb-saque-${String(dados.revista_id).replace(/[^A-Za-z0-9-]/g, "-")}` });
      this.dados = dados;
      this.estado = estadoInicial();
    }

    /** Os dados chegaram de novo (o Mestre revelou outra vez): as escolhas já feitas aqui ficam. */
    atualizar(dados) {
      this.dados = dados;
      this.estado = { ...this.estado, esperando: {}, erros: {}, aviso: null, tudo: false };
    }

    async _renderHTML() {
      const div = document.createElement("div");
      // foundry.utils.getRoute: já usado em trilhas-foundry.js (o prefixo de rota do servidor)
      const rota = (c) => (foundry.utils?.getRoute ? foundry.utils.getRoute(c) : c);
      div.innerHTML = htmlDaJanela(this.dados, this.estado, { rota });
      return div;
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }

    async decidir(achadoId, pegar) {
      if (!achadoId || this.estado.esperando[achadoId]) return;
      const gm = game.users?.activeGM;
      if (!gm) {
        this.estado = depoisDaDecisao(this.estado, achadoId, pegar, { ok: false, error: "O Mestre não está conectado." });
        await this.render();
        return;
      }
      this.estado = { ...this.estado, esperando: { ...this.estado.esperando, [achadoId]: true } };
      await this.render();
      let resposta;
      try {
        resposta = await gm.query(
          QUERY_DECIDIR_SAQUE,
          { revista_id: this.dados.revista_id, achado_id: achadoId, pegar },
          { timeout: ESPERA_DA_DECISAO_MS },
        );
      } catch {
        resposta = { ok: false, error: "O Mestre não respondeu. Tente de novo." };
      }
      this.estado = depoisDaDecisao(this.estado, achadoId, pegar, resposta);
      await this.render();
    }

    async close(opcoes) {
      janelas.delete(this.dados?.revista_id);
      return super.close(opcoes);
    }
  };
  return ClasseDaJanela;
}

/** No navegador do jogador: abre (ou traz para a frente) a janela desta revista. Responde logo. */
function abrirJanela(dados) {
  if (!dados || typeof dados.revista_id !== "string" || !Array.isArray(dados.achados)) return { aberta: false, motivo: "dados_invalidos" };
  let janela = janelas.get(dados.revista_id);
  if (janela) janela.atualizar(dados);
  else {
    janela = new (classeDaJanela())(dados);
    janelas.set(dados.revista_id, janela);
  }
  void Promise.resolve(janela.render({ force: true }))
    .then(() => janela.bringToFront?.())
    .catch((err) => console.error(`${MODULE_ID} | saque: a janela não abriu`, err));
  return { aberta: true };
}

/** No GM ativo: o "Pegar"/"Deixar" que o navegador do jogador perguntou. */
async function decidirNoGm(dados) {
  if (!souOGmAtivo()) return { ok: false, error: "O Mestre não está conectado." };
  const corpo = corpoDaDecisao(dados);
  if (!corpo) return { ok: false, error: "Pedido inválido." };
  const res = await enviar(corpo);
  if (res?.ok) return { ok: true, pendentes: typeof res.pendentes === "number" ? res.pendentes : null };
  return { ok: false, error: fraseDaFalha(res) };
}

/**
 * No `init`, em TODO navegador. Foundry sem CONFIG.queries (v12): sem as
 * perguntas (a janela não abre; o jogador pega pelo Companion).
 */
export function registerSaqueQueries() {
  if (CONFIG.queries) {
    // (dados, opções) → resposta: tipos v14, client/config.d.mts:1829-1835
    CONFIG.queries[QUERY_ABRIR_SAQUE] = (dados) => abrirJanela(dados);
    CONFIG.queries[QUERY_DECIDIR_SAQUE] = (dados) => decidirNoGm(dados);
  }
  // renderChatMessageHTML(mensagem, html: HTMLElement): tipos v14, client/hooks.d.mts:1397-1401.
  Hooks.on("renderChatMessageHTML", (mensagem, html) => {
    const botoes = html?.querySelectorAll?.('[data-cfb-acao^="saque-"]') ?? [];
    for (const b of botoes) b.addEventListener("click", (ev) => void aoClicar(ev, mensagem, b));
  });
}
