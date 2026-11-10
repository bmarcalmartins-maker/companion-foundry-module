/**
 * O SAQUE (v1.25.0). As regras e os textos, sem Foundry e sem DOM (testados em
 * test/saque.test.js); quem ouve os ganchos, cria os cartões e abre a janela é
 * saque-foundry.js.
 *
 * O inimigo (ator do tipo "npc") derrotado vira um "corpo" no Companion; o
 * Mestre libera a revista para UM personagem; o jogador rola Investigação (a
 * nativa do dnd5e); o Companion sorteia; o resultado vai só ao GM; o GM
 * revela; o jogador vê a janela de pergaminho e escolhe Pegar ou Deixar.
 * TUDO o que é regra mora no banco do Companion: daqui só saem os fatos
 * (morreu, rolou, clicou) e os desenhos (cartões e janela).
 *
 * Os textos do saque vão em português direto aqui (o que vem do Companion,
 * as frases de recusa, a faixa, a raridade, já chega em português); só a
 * configuração tem as duas línguas (languages/).
 *
 * Contrato inteiro e as HIPÓTESES: docs/SAQUE.md.
 */

/** O id do módulo (o de settings.js, repetido para este arquivo não puxar o Foundry). */
const MODULE_ID = "companion-foundry-bridge";

/** GM → navegador do dono do ator: abre a janela do que foi revelado. */
export const QUERY_ABRIR_SAQUE = "companion-foundry-bridge.saqueAbrir";
/** Navegador do jogador → GM ativo: "Pegar" ou "Deixar" um achado. */
export const QUERY_DECIDIR_SAQUE = "companion-foundry-bridge.saqueDecidir";

/** Quanto o GM espera o navegador do jogador abrir a janela, e o jogador a resposta do GM. */
export const ESPERA_DA_JANELA_MS = 15_000;
export const ESPERA_DA_DECISAO_MS = 30_000;

export const TENTATIVAS = 3;
export const ESPERA_ERRO_MS = 3_000;

export const ACOES_DO_COMANDO = ["pedido", "liberada", "resultado", "revelada", "encerrada"];

/* -------------------------------------------- */
/*  Texto seguro                                */
/* -------------------------------------------- */

/** Todo texto que vem de fora (nome de token, de item, descrição) passa por aqui. */
export function escapar(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const texto = (v, teto = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, teto) : null);
const eId = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const inteiro = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** Número ou texto curto vira texto; o resto, nulo (nunca "[object Object]"). */
function valorEmTexto(v, teto = 200) {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return texto(v, teto);
}

/**
 * A descrição em TEXTO PURO: as marcas de HTML saem (parágrafo e <br> viram
 * quebra de linha) e o que sobra é escapado por quem desenha. Nada de HTML
 * vindo de fora entra no cartão nem na janela.
 */
export function textoPuro(v, teto = 4_000) {
  if (typeof v !== "string") return "";
  return v
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, teto);
}

/* -------------------------------------------- */
/*  Os três sinais de morte                     */
/* -------------------------------------------- */

const eNpc = (ator) => !!ator && ator.type === "npc" && typeof ator.uuid === "string" && !!ator.uuid;

/**
 * Sinal 1, o gancho dnd5e.damageActor(actor, changes): o NPC passou de PV
 * acima de 0 para 0 ou menos. O gancho roda DEPOIS da gravação
 * (dnd5e 5.3.3, module/data/actor/templates/attributes.mjs:532-566): o PV de
 * agora está no ator, e `changes.hp` = agora − antes (:540-544).
 */
export function morreuPeloDano(ator, changes) {
  if (!eNpc(ator)) return false;
  const depois = inteiro(ator.system?.attributes?.hp?.value);
  const mudou = inteiro(changes?.hp);
  if (depois === null || mudou === null) return false;
  const antes = depois - mudou;
  return antes > 0 && depois <= 0;
}

/**
 * Sinal 2, o gancho createActiveEffect: o efeito com o estado de derrotado
 * (`statusDeMorto` = CONFIG.specialStatusEffects.DEFEATED, "dead" no dnd5e
 * 5.3.3: module/config.mjs:3837-3840) num NPC. Devolve o ator ou nulo.
 * `ActiveEffect#statuses` é um Set (tipos v14,
 * common/documents/active-effect.d.mts:393).
 */
export function mortoPeloEfeito(efeito, statusDeMorto) {
  if (!efeito || typeof statusDeMorto !== "string" || !statusDeMorto) return null;
  const st = efeito.statuses;
  const tem = st instanceof Set ? st.has(statusDeMorto) : Array.isArray(st) ? st.includes(statusDeMorto) : false;
  if (!tem) return null;
  const ator = efeito.parent;
  return eNpc(ator) ? ator : null;
}

/**
 * Sinal 3, o gancho updateCombatant: o "derrotado" do Combat Tracker
 * (`defeated: true` na mudança; tipos v14, common/documents/combatant.d.mts:346-349).
 * Devolve o ator do combatente (Combatant#actor, client/documents/combatant.d.mts:1020) ou nulo.
 */
export function mortoPeloCombatente(combatente, mudanca) {
  if (mudanca?.defeated !== true) return null;
  const ator = combatente?.actor;
  return eNpc(ator) ? ator : null;
}

/**
 * O que vai na op `saque.morreu`. A chave do corpo é o `uuid` do ator do
 * TOKEN (dois goblins do mesmo ator são dois corpos); `nome` é o do token
 * (senão o do ator) e `nome_ator` o do ator de base (`nomeDeBase`, que quem
 * chama lê do mundo; sem ele, o do próprio ator).
 */
export function corpoDoAtor(ator, { nomeDoToken = null, nomeDeBase = null } = {}) {
  if (!eNpc(ator)) return null;
  const nomeAtor = texto(nomeDeBase) ?? texto(ator.name) ?? "?";
  return {
    op: "saque.morreu",
    ator_uuid: ator.uuid,
    ator_id: typeof ator.id === "string" ? ator.id : null,
    nome: texto(nomeDoToken) ?? texto(ator.token?.name) ?? texto(ator.name) ?? nomeAtor,
    nome_ator: nomeAtor,
  };
}

/**
 * A memória deste navegador: cada `actor.uuid` avisa UMA vez (o dano, depois o
 * HUD, depois o Combat Tracker são o mesmo corpo). `esquecer` é para o aviso
 * que não chegou ao Companion: o próximo sinal tenta de novo.
 */
export function criarMemoriaDeMortes() {
  const vistos = new Set();
  return {
    /** true só na primeira vez de cada uuid. */
    nova(uuid) {
      if (typeof uuid !== "string" || !uuid || vistos.has(uuid)) return false;
      vistos.add(uuid);
      return true;
    },
    esquecer(uuid) {
      vistos.delete(uuid);
    },
    tamanho: () => vistos.size,
  };
}

/* -------------------------------------------- */
/*  A edge foundry-saque                        */
/* -------------------------------------------- */

/**
 * O que fazer com a resposta da edge (a de `postInbound`: o corpo do 200, ou
 * `{ ok: false, status }` no erro HTTP, ou nulo sem rede):
 *   "pronto"    ok
 *   "recusado"  HTTP 200 com ok falso: a regra do Companion disse não
 *               (`error`, a frase em português) ou não há o que fazer
 *               (`motivo`: sem_sessao, desligado). Não repete.
 *   "descarta"  400, 401, 404, 413: repetir não muda nada
 *   "repete"    rede, 429, 5xx
 */
export function depoisDoEnvioDoSaque(res) {
  if (res?.ok) return "pronto";
  if (res && typeof res === "object" && res.status === undefined) return "recusado";
  if ([400, 401, 403, 404, 413].includes(res?.status)) return "descarta";
  return "repete";
}

/** Manda com até `tentativas` voltas (só o "repete" volta). `esperar(ms)` é o setTimeout em promessa. */
export async function mandarComRetentativa(corpo, { enviar, esperar, tentativas = TENTATIVAS }) {
  let res = null;
  for (let i = 1; i <= tentativas; i++) {
    res = await enviar(corpo);
    if (depoisDoEnvioDoSaque(res) !== "repete" || i === tentativas) return res ?? null;
    await esperar(ESPERA_ERRO_MS * i);
  }
  return res ?? null;
}

/** A frase para o Mestre quando a edge não fez o que foi pedido. */
export function fraseDaFalha(res) {
  if (texto(res?.error)) return texto(res.error, 300);
  if (res?.motivo === "sem_sessao") return "Não há sessão em andamento no Companion.";
  if (res?.motivo === "desligado") return "O saque está desligado no Companion.";
  if (res?.status === 401) return "O Companion recusou a chave de entrada deste navegador.";
  return "O Companion não respondeu. Tente de novo.";
}

/* -------------------------------------------- */
/*  A rolagem de Investigação                   */
/* -------------------------------------------- */

/**
 * A mensagem do chat é a Investigação de uma revista? A nossa flag
 * (`flags["companion-foundry-bridge"].saque` = id da revista, posta em
 * `actor.rollSkill(..., { data: { flags } })`) e o total da primeira rolagem.
 * Devolve o corpo da op `saque.rolou` ou nulo.
 */
export function rolagemDoSaque(msg) {
  const revista = msg?.flags?.[MODULE_ID]?.saque;
  if (!eId(revista) || typeof msg?.id !== "string" || !msg.id) return null;
  const rolls = Array.isArray(msg.rolls) ? msg.rolls : [];
  const total = rolls[0]?.total;
  if (typeof total !== "number" || !Number.isFinite(total)) return null;
  return { op: "saque.rolou", revista_id: revista, total: Math.round(total), mensagem_id: msg.id };
}

/* -------------------------------------------- */
/*  O comando da ponte                          */
/* -------------------------------------------- */

/**
 * Confere o `payload` de `saque.comando`. Devolve `{ ok: true }` ou
 * `{ ok: false, motivo }`. A ação que não existe sai como
 * "acao_desconhecida: <x>" (é o que a ponte devolve ao Companion).
 */
export function validarComando(payload) {
  const acao = payload?.acao;
  if (!ACOES_DO_COMANDO.includes(acao)) return { ok: false, motivo: `acao_desconhecida: ${String(acao).slice(0, 60)}` };
  if (!eId(payload?.corpo?.id)) return { ok: false, motivo: "sem_corpo" };
  if (acao !== "encerrada") {
    if (!eId(payload?.pc?.id)) return { ok: false, motivo: "sem_pc" };
  }
  if (["liberada", "resultado", "revelada"].includes(acao) && !eId(payload?.revista?.id)) return { ok: false, motivo: "sem_revista" };
  if (acao === "revelada" && !Array.isArray(payload?.achados)) return { ok: false, motivo: "sem_achados" };
  if (payload?.achados != null && !Array.isArray(payload.achados)) return { ok: false, motivo: "achados_invalidos" };
  return { ok: true };
}

/* -------------------------------------------- */
/*  Os textos                                   */
/* -------------------------------------------- */

/** As moedas do dnd5e nas siglas da mesa, da maior para a menor. */
const SIGLAS = [
  ["pp", "pl"],
  ["gp", "po"],
  ["ep", "pe"],
  ["sp", "pp"],
  ["cp", "pc"],
];

/** `{ gp: 3, sp: 8 }` → "3 po, 8 pp". Só as maiores que zero; nada: "". */
export function textoDasMoedas(moedas) {
  if (!moedas || typeof moedas !== "object") return "";
  const partes = [];
  for (const [chave, sigla] of SIGLAS) {
    const n = inteiro(typeof moedas[chave] === "string" ? Number(moedas[chave]) : moedas[chave]);
    if (n !== null && n > 0) partes.push(`${n} ${sigla}`);
  }
  return partes.join(", ");
}

/** Só as chaves do próprio mapa ("constructor" não é raridade). */
const de = (mapa, chave) => (typeof chave === "string" && Object.hasOwn(mapa, chave) ? mapa[chave] : "");

const RARIDADES = { comum: "Comum", incomum: "Incomum", raro: "Raro", muito_raro: "Muito raro", lendario: "Lendário" };
/** A raridade do Companion em português; a que não existe: "". */
export function raridadeEmPortugues(r) {
  return de(RARIDADES, r);
}
/** A classe de cor da raridade (só as cinco conhecidas). */
export const classeDaRaridade = (r) => (de(RARIDADES, r) ? `cfb-saque-raridade--${r.replace("_", "-")}` : "");

const FAIXAS = { baixa: "baixa", media: "média", boa: "boa", alta: "alta" };
export function faixaEmPortugues(f) {
  return de(FAIXAS, f);
}

const FONTES = { moedas: "moedas", usava: "usava", bolso: "no bolso", tabela: "tabela do Mestre", sempre: "sempre com ele" };
export function fonteEmPalavras(f) {
  return de(FONTES, f);
}

/**
 * As propriedades do item, que chegam como texto, lista ou objeto: sempre uma
 * linha de texto (ou ""). Lista: textos, ou objetos com nome/name/label.
 * Objeto: as chaves ligadas (`{ fin: true }` → "fin") e "chave: valor".
 */
export function textoDasPropriedades(p) {
  if (typeof p === "string") return p.trim().slice(0, 400);
  const nomeDe = (v) => {
    if (typeof v === "string" || typeof v === "number") return String(v).trim();
    if (v && typeof v === "object") return texto(v.nome) ?? texto(v.name) ?? texto(v.label) ?? "";
    return "";
  };
  if (Array.isArray(p)) return p.map(nomeDe).filter(Boolean).join(", ").slice(0, 400);
  if (p && typeof p === "object") {
    const partes = [];
    for (const [k, v] of Object.entries(p)) {
      if (v === true) partes.push(k);
      else if (typeof v === "string" && v.trim()) partes.push(`${k}: ${v.trim()}`);
      else if (typeof v === "number" && Number.isFinite(v)) partes.push(`${k}: ${v}`);
    }
    return partes.join(", ").slice(0, 400);
  }
  return "";
}

/** A sintonia: true → "Exige sintonia"; texto → "Sintonia: <texto>". */
export function textoDaSintonia(s) {
  if (s === true) return "Exige sintonia";
  const t = texto(s);
  return t ? `Sintonia: ${t}` : "";
}

/**
 * O endereço da imagem do achado: `imagem_url` só se for https; senão `img`,
 * um caminho do Foundry (sem esquema: nada de "javascript:" nem "data:"),
 * passado por `rota` (no Foundry, foundry.utils.getRoute). Nenhum: nulo.
 */
export function imagemDoAchado(a, rota = (c) => c) {
  const url = texto(a?.imagem_url, 2_000);
  if (url && /^https:\/\/[^\s"'<>]+$/i.test(url)) return url;
  const img = texto(a?.img, 500);
  if (img && !/^[a-z][a-z0-9+.-]*:/i.test(img) && !img.startsWith("//") && !/[\s"'<>]/.test(img)) return rota(img);
  return null;
}

const nomeDoAchado = (a) => texto(a?.nome) ?? "Item";
const vezes = (a) => {
  const q = inteiro(a?.quantidade);
  return q !== null && q > 1 ? ` x${q}` : "";
};
const moedasDoAchado = (a) => texto(a?.moedas_texto) ?? (textoDasMoedas(a?.moedas) || "moedas");

/* -------------------------------------------- */
/*  Os cartões do chat                          */
/* -------------------------------------------- */

/**
 * Os botões levam `data-cfb-acao`, NÃO `data-action`: o ChatLog é uma
 * ApplicationV2 e trata os `data-action` dele (tipos v14,
 * client/applications/sidebar/tabs/chat.d.mts:33-41). Quem liga o clique é o gancho
 * renderChatMessageHTML (saque-foundry.js).
 */
function botao(acao, rotulo, dados = {}) {
  const attrs = Object.entries(dados)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ` data-${k}="${escapar(v)}"`)
    .join("");
  return `<button type="button" class="cfb-saque-botao" data-cfb-acao="${escapar(acao)}"${attrs}>${escapar(rotulo)}</button>`;
}

const cartao = (miolo) => `<div class="cfb-saque-cartao">${miolo}</div>`;

/** "<nome> caiu." + um botão por personagem + "Sem saque" (só os GMs veem). */
export function htmlDoCartaoDeMorte({ corpo_id, nome, pcs, sem_ficha = false }) {
  const lista = (Array.isArray(pcs) ? pcs : []).filter((p) => eId(p?.id));
  const botoes = lista.map((p) => botao("saque-liberar", p.nome ?? "?", { corpo: corpo_id, pc: p.id, "pc-nome": p.nome ?? "" })).join("");
  return cartao(
    `<p><strong>${escapar(nome)}</strong> caiu.</p>` +
      (sem_ficha
        ? `<p class="cfb-saque-aviso">O Companion não achou a ficha desta criatura: escolha qual é no Companion (Mesa) antes de revelar.</p>`
        : "") +
      (lista.length ? `<p>Liberar a revista para:</p>` : `<p>Nenhum personagem no Companion para revistar.</p>`) +
      `<div class="cfb-saque-botoes">${botoes}${botao("saque-fechar", "Sem saque", { corpo: corpo_id })}</div>`,
  );
}

/** "<pc> quer revistar <corpo>" + "Liberar para <pc>" (só os GMs veem). */
export function htmlDoCartaoDePedido({ corpo, pc }) {
  return cartao(
    `<p><strong>${escapar(pc?.nome ?? "?")}</strong> quer revistar <strong>${escapar(corpo?.nome ?? "?")}</strong>.</p>` +
      `<div class="cfb-saque-botoes">${botao("saque-liberar", `Liberar para ${pc?.nome ?? "?"}`, { corpo: corpo?.id, pc: pc?.id, "pc-nome": pc?.nome ?? "" })}</div>`,
  );
}

/** "<pc> revista <corpo>. Role Investigação." + o botão (os donos do ator e os GMs veem). */
export function htmlDoCartaoDeRolar({ corpo, pc, revista, ator_id }) {
  return cartao(
    `<p><strong>${escapar(pc?.nome ?? "?")}</strong> revista <strong>${escapar(corpo?.nome ?? "?")}</strong>. Role Investigação.</p>` +
      `<div class="cfb-saque-botoes">${botao("saque-rolar", "Rolar Investigação", { revista: revista?.id, ator: ator_id })}</div>`,
  );
}

/** O personagem sem ator (ou sem dono jogador) no Foundry: só os GMs veem. */
export function htmlDoCartaoSemAtor({ corpo, pc }) {
  return cartao(
    `<p><strong>${escapar(pc?.nome ?? "?")}</strong> revista <strong>${escapar(corpo?.nome ?? "?")}</strong>.</p>` +
      `<p class="cfb-saque-aviso">${escapar(pc?.nome ?? "O personagem")} não tem ator ligado no Foundry: peça o total e digite no Companion.</p>`,
  );
}

/** Uma linha do resultado, na visão do MESTRE. */
function linhaDoMestre(a) {
  if (a?.tipo === "moedas") return `<li>${escapar(moedasDoAchado(a))}</li>`;
  const partes = [];
  const naoIdentificado = a?.identificado === false;
  const real = texto(a?.nome_real);
  let nome = `<strong>${escapar(nomeDoAchado(a))}</strong>${escapar(vezes(a))}`;
  if (naoIdentificado && real) nome += ` (de verdade: ${escapar(real)})`;
  else if (naoIdentificado) nome += ` (não identificado)`;
  const raridade = raridadeEmPortugues(a?.raridade);
  if (raridade) partes.push(escapar(raridade.toLowerCase()));
  const fonte = fonteEmPalavras(a?.fonte);
  if (fonte) partes.push(escapar(fonte));
  if (a?.quebra_regra) partes.push(`<span class="cfb-saque-fora">⚠ fora da regra</span>`);
  return `<li>${nome}${partes.length ? ` <span class="cfb-saque-detalhe">· ${partes.join(" · ")}</span>` : ""}</li>`;
}

/** "O que <corpo> tinha (<pc> tirou <total>, faixa <faixa>)" + "Revelar a <pc>" (só os GMs veem). */
export function htmlDoCartaoDeResultado({ corpo, pc, revista, achados }) {
  const nome = escapar(corpo?.nome ?? "?");
  if (corpo?.sem_ficha && !Array.isArray(achados)) {
    return cartao(
      `<p><strong>${nome}</strong>: ${escapar(pc?.nome ?? "?")} rolou.</p>` +
        `<p class="cfb-saque-aviso">Escolha a criatura deste corpo no Companion: o sorteio sai na hora.</p>`,
    );
  }
  const total = inteiro(revista?.total);
  const faixa = faixaEmPortugues(revista?.faixa);
  const entre = [total !== null ? `${escapar(pc?.nome ?? "?")} tirou ${total}` : escapar(pc?.nome ?? "?"), faixa ? `faixa ${escapar(faixa)}` : ""]
    .filter(Boolean)
    .join(", ");
  const lista = Array.isArray(achados) ? achados : [];
  return cartao(
    `<p>O que <strong>${nome}</strong> tinha (${entre}):</p>` +
      (lista.length ? `<ul class="cfb-saque-lista">${lista.map(linhaDoMestre).join("")}</ul>` : `<p>Nada.</p>`) +
      `<div class="cfb-saque-botoes">${botao("saque-revelar", `Revelar a ${pc?.nome ?? "?"}`, { revista: revista?.id, "pc-nome": pc?.nome ?? "" })}</div>`,
  );
}

/** O fim: "Guldrum revistou Goblin e pegou: 3 po, Adaga" (só os GMs veem). Sem texto: nulo. */
export function htmlDoCartaoDeEncerrada({ pegou }) {
  const t = texto(pegou, 600);
  return t ? cartao(`<p>${escapar(t)}</p>`) : null;
}

/** O cartão depois do clique que deu certo: o estado novo, sem botões. */
export function htmlDoCartaoResolvido(frase) {
  return cartao(`<p>${escapar(frase)}</p>`);
}

/* -------------------------------------------- */
/*  A janela de pergaminho do jogador           */
/* -------------------------------------------- */

/** Os campos de um achado que a janela usa; do NÃO identificado, só a fachada. */
const CAMPOS_DA_FACHADA = ["id", "tipo", "quantidade", "moedas", "decisao", "pego", "nome", "identificado", "tipo_item", "img", "imagem_url", "descricao"];
const CAMPOS_DO_ACHADO = [...CAMPOS_DA_FACHADA, "raridade", "subtipo", "dano", "tipo_dano", "ca", "alcance", "propriedades", "peso", "sintonia"];

/**
 * O que a op `revelada` manda ao navegador do jogador: só o que a janela usa.
 * O Companion já manda a visão do jogador; aqui é a segunda trava: campo que
 * não é da janela (o nome de verdade, a fonte, a faixa) não passa, e o item
 * não identificado vai só com a fachada, venha o que vier.
 */
export function dadosDaJanela(payload) {
  const limpo = (a) => {
    const campos = a?.identificado === false ? CAMPOS_DA_FACHADA : CAMPOS_DO_ACHADO;
    const saida = {};
    for (const c of campos) if (a?.[c] !== undefined) saida[c] = a[c];
    return saida;
  };
  return {
    revista_id: payload?.revista?.id ?? null,
    corpo: texto(payload?.corpo?.nome) ?? "?",
    pc: texto(payload?.pc?.nome) ?? "",
    achados: (Array.isArray(payload?.achados) ? payload.achados : []).slice(0, 60).map(limpo),
  };
}

/** A decisão de uma linha: "pegou", "deixou" ou nula (a escolhida na janela vence a que veio). */
export function decisaoDoAchado(a, decisoes = {}) {
  const local = decisoes && typeof a?.id === "string" && Object.hasOwn(decisoes, a.id) ? decisoes[a.id] : null;
  if (local === "pegou" || local === "deixou") return local;
  if (a?.decisao === "pegou" || a?.decisao === "deixou") return a.decisao;
  if (a?.pego === true) return "pegou";
  return null;
}

/** Quantos achados ainda esperam a escolha. */
export function pendentesDaJanela(dados, estado = {}) {
  return (Array.isArray(dados?.achados) ? dados.achados : []).filter((a) => eId(a?.id) && !decisaoDoAchado(a, estado.decisoes)).length;
}

/**
 * O clique "Pegar"/"Deixar" vira o corpo da op da edge (no GM ativo, que
 * recebe a pergunta do navegador do jogador). Dados ruins: nulo.
 */
export function corpoDaDecisao(dados) {
  if (!eId(dados?.revista_id) || !eId(dados?.achado_id) || typeof dados?.pegar !== "boolean") return null;
  return { op: dados.pegar ? "saque.pegar" : "saque.deixar", revista_id: dados.revista_id, achado_id: dados.achado_id };
}

/** O estado novo da janela vazia. */
export const estadoInicial = () => ({ decisoes: {}, esperando: {}, erros: {}, aviso: null, tudo: false });

/**
 * A resposta do Mestre a um "Pegar"/"Deixar" muda o estado da janela (devolve
 * um estado NOVO): ok → a linha vira "Você pegou."/"Você deixou."
 * (`pendentes` 0 → "Tudo decidido."); senão, a frase do erro na linha.
 */
export function depoisDaDecisao(estado, achadoId, pegar, resposta) {
  const novo = {
    ...estado,
    decisoes: { ...estado.decisoes },
    esperando: { ...estado.esperando },
    erros: { ...estado.erros },
  };
  delete novo.esperando[achadoId];
  if (resposta?.ok === true) {
    novo.decisoes[achadoId] = pegar ? "pegou" : "deixou";
    delete novo.erros[achadoId];
    if (resposta.pendentes === 0) novo.tudo = true;
  } else {
    novo.erros[achadoId] = texto(resposta?.error, 300) ?? "O Mestre não respondeu. Tente de novo.";
  }
  return novo;
}

function rodapeDaLinha(a, estado, rotuloPegar) {
  const decisao = decisaoDoAchado(a, estado.decisoes);
  if (decisao) return `<p class="cfb-saque-decidido">${decisao === "pegou" ? "Você pegou." : "Você deixou."}</p>`;
  const esperando = estado.esperando?.[a.id] === true;
  const desligado = esperando ? " disabled" : "";
  const erro = texto(estado.erros?.[a.id], 300);
  return (
    `<div class="cfb-saque-botoes">` +
    `<button type="button" class="cfb-saque-botao cfb-saque-botao--pegar" data-action="pegar" data-achado="${escapar(a.id)}"${desligado}>${escapar(rotuloPegar)}</button>` +
    `<button type="button" class="cfb-saque-botao cfb-saque-botao--deixar" data-action="deixar" data-achado="${escapar(a.id)}"${desligado}>Deixar</button>` +
    `</div>` +
    (erro ? `<p class="cfb-saque-erro" role="alert">${escapar(erro)}</p>` : "")
  );
}

function linhaDeMoedas(a, estado) {
  return (
    `<li class="cfb-saque-linha cfb-saque-linha--moedas">` +
    `<div class="cfb-saque-corpo"><h3 class="cfb-saque-nome">${escapar(textoDasMoedas(a?.moedas) || texto(a?.moedas_texto) || "Moedas")}</h3>` +
    `<p class="cfb-saque-meta">Moedas</p>` +
    rodapeDaLinha(a, estado, "Pegar as moedas") +
    `</div></li>`
  );
}

function linhaDeItem(a, estado, rota) {
  const identificado = a?.identificado !== false;
  const src = imagemDoAchado(a, rota);
  const imagem = src ? `<img class="cfb-saque-imagem" src="${escapar(src)}" alt="" loading="lazy">` : "";
  const meta = [];
  if (identificado) {
    const raridade = raridadeEmPortugues(a?.raridade);
    if (raridade) meta.push(`<span class="cfb-saque-raridade ${classeDaRaridade(a.raridade)}">${escapar(raridade)}</span>`);
  } else {
    meta.push(`<span class="cfb-saque-nao-identificado">Não identificado</span>`);
  }
  const tipo = [texto(a?.tipo_item), identificado ? texto(a?.subtipo) : null].filter(Boolean).join(" · ");
  if (tipo) meta.push(escapar(tipo));

  const fatos = [];
  if (identificado) {
    const dano = [valorEmTexto(a?.dano), texto(a?.tipo_dano)].filter(Boolean).join(" ");
    if (dano && valorEmTexto(a?.dano)) fatos.push(["Dano", dano]);
    const ca = valorEmTexto(a?.ca);
    if (ca) fatos.push(["CA", ca]);
    const alcance = valorEmTexto(a?.alcance);
    if (alcance) fatos.push(["Alcance", alcance]);
    const props = textoDasPropriedades(a?.propriedades);
    if (props) fatos.push(["Propriedades", props]);
    const peso = valorEmTexto(a?.peso);
    if (peso) fatos.push(["Peso", peso]);
  }
  const sintonia = identificado ? textoDaSintonia(a?.sintonia) : "";
  const descricao = textoPuro(a?.descricao);
  return (
    `<li class="cfb-saque-linha${imagem ? " cfb-saque-linha--com-imagem" : ""}">` +
    imagem +
    `<div class="cfb-saque-corpo">` +
    `<h3 class="cfb-saque-nome">${escapar(nomeDoAchado(a))}${escapar(vezes(a))}</h3>` +
    (meta.length ? `<p class="cfb-saque-meta">${meta.join(" · ")}</p>` : "") +
    (fatos.length
      ? `<dl class="cfb-saque-fatos">${fatos.map(([k, v]) => `<div><dt>${escapar(k)}</dt><dd>${escapar(v)}</dd></div>`).join("")}</dl>`
      : "") +
    (sintonia ? `<p class="cfb-saque-sintonia">${escapar(sintonia)}</p>` : "") +
    (descricao ? `<p class="cfb-saque-descricao">${escapar(descricao)}</p>` : "") +
    rodapeDaLinha(a, estado, "Pegar") +
    `</div></li>`
  );
}

/**
 * O miolo da janela "O que você achou em <corpo>", PURO: os dados que vieram
 * (`dadosDaJanela`) e o estado da janela (`decisoes` por achado, `esperando`
 * a resposta do Mestre, `erros` por achado, `aviso` geral). As moedas
 * primeiro, depois os itens. Todo texto de fora sai escapado.
 * `rota(caminho)` ajusta o caminho de imagem do Foundry.
 */
export function htmlDaJanela(dados, estado = {}, { rota = (c) => c } = {}) {
  const achados = (Array.isArray(dados?.achados) ? dados.achados : []).filter((a) => eId(a?.id));
  const moedas = achados.filter((a) => a.tipo === "moedas");
  const itens = achados.filter((a) => a.tipo !== "moedas");
  const linhas = [...moedas.map((a) => linhaDeMoedas(a, estado)), ...itens.map((a) => linhaDeItem(a, estado, rota))];
  const tudo = achados.length > 0 && (estado.tudo === true || pendentesDaJanela({ achados }, estado) === 0);
  const aviso = texto(estado.aviso, 300);
  return (
    `<div class="cfb-saque-folha">` +
    `<h2 class="cfb-saque-titulo">O que você achou em ${escapar(dados?.corpo ?? "?")}</h2>` +
    (achados.length ? `<ul class="cfb-saque-achados">${linhas.join("")}</ul>` : `<p class="cfb-saque-vazio">Nada.</p>`) +
    (aviso ? `<p class="cfb-saque-erro" role="alert">${escapar(aviso)}</p>` : "") +
    (tudo || !achados.length
      ? `<div class="cfb-saque-rodape">${tudo ? `<p class="cfb-saque-decidido">Tudo decidido.</p>` : ""}` +
        `<button type="button" class="cfb-saque-botao cfb-saque-botao--deixar" data-action="fechar">Fechar</button></div>`
      : "") +
    `</div>`
  );
}
