/**
 * A MAGIA FALADA (v1.12.0). O jogador diz a magia na mesa; o Companion acha o
 * nome entre as magias do ATOR dele (as que vão no actor.snapshot, abaixo) e
 * pede, pela ponte, que ela seja usada. O GM ativo recebe o pedido
 * (`magia.pedir`) e o passa ao navegador do JOGADOR dono do ator, por
 * `User#query` (Foundry v13+). Lá abre a pergunta "Lançar X?", e só com o
 * "Lançar" o dnd5e usa a magia (o diálogo dele abre quando há espaço ou
 * escolha a fazer). NUNCA lança sem o toque: um truque simples, no dnd5e
 * 5.3.3, não abre diálogo nenhum (activity/mixin.mjs:225 e :660-667), por isso
 * a pergunta é nossa.
 *
 * v1.13.0 (21/10, pedido do Bruno: "deixe cada um configurar como quer"):
 *   - além das magias, as AÇÕES do ator (armas, habilidades e consumíveis com
 *     algo a usar no dnd5e) vão no snapshot e podem ser pedidas pela fala;
 *   - o pedido pode ser um ATALHO do jogador: uma lista de até 5 itens, usados
 *     em ordem depois de UM toque; para no primeiro que ele cancelar no dnd5e;
 *   - sem trava de combate: o que decide é a fala que ele configurou no app.
 *     A pergunta continua: nada é usado sem o toque.
 *
 * Lógica pura, sem `game` (test/magias.test.js): quem liga ao Foundry é
 * magia-falada.js.
 */

/** O nome da pergunta, com o prefixo do módulo, como o Foundry exige (CONFIG.queries). */
export const QUERY_LANCAR_MAGIA = "companion-foundry-bridge.lancarMagia";

/** Quanto o GM espera o jogador decidir (o diálogo continua aberto depois). */
export const ESPERA_DO_JOGADOR_MS = 120_000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** As ações (v1.13.0): armas, habilidades e consumíveis. */
export const TIPOS_DE_ACAO = new Set(["weapon", "feat", "consumable"]);

/** Até quantos itens um atalho usa (a mesma trava do banco, magia_falada_atalhos_itens). */
export const MAX_ITENS_DO_ATALHO = 5;

/**
 * Tem algo a usar no dnd5e? `system.activities` é uma Collection do dnd5e 5.x;
 * `isActive` é `activities.size > 0` (data/item/templates/activities.mjs:122-124).
 * Habilidade passiva, sem atividade, fica de fora.
 */
function temAtividade(i) {
  const a = i?.system?.activities;
  return typeof a?.size === "number" && a.size > 0;
}

/**
 * As magias do ator para o snapshot: o Companion casa o nome falado com elas.
 * `metodo` (spell, pact, innate, atwill, ritual) e `preparada` (0, 1, 2) são do
 * SpellData do dnd5e 5.x (data/item/spell.mjs:45-53); não filtram nada aqui.
 */
export function magiasDoAtor(itens) {
  const out = [];
  for (const i of itens ?? []) {
    if (i?.type !== "spell") continue;
    out.push({
      id: i.id,
      uuid: i.uuid ?? null,
      name: i.name,
      nivel: num(i.system?.level),
      metodo: typeof i.system?.method === "string" ? i.system.method : null,
      preparada: num(i.system?.prepared),
    });
  }
  return out;
}

/**
 * As ações do ator para o snapshot (v1.13.0): armas, habilidades e consumíveis
 * com alguma atividade. `tipo` é o type do item no dnd5e.
 */
export function acoesDoAtor(itens) {
  const out = [];
  for (const i of itens ?? []) {
    if (!TIPOS_DE_ACAO.has(i?.type) || !temAtividade(i)) continue;
    out.push({ id: i.id, uuid: i.uuid ?? null, name: i.name, tipo: i.type });
  }
  return out;
}

/**
 * Os itens do pedido, em ordem: o atalho manda `tipo: "atalho"` e `itens`; o
 * pedido de um item só (e o de antes da 1.13.0) manda só `item_id`.
 */
export function itensDoPedido(payload) {
  const lista = Array.isArray(payload?.itens)
    ? payload.itens.filter((id) => typeof id === "string" && id).slice(0, MAX_ITENS_DO_ATALHO)
    : [];
  if (payload?.tipo === "atalho" && lista.length) return lista;
  return typeof payload?.item_id === "string" && payload.item_id ? [payload.item_id] : [];
}

/**
 * Os itens do ator que a fala pode usar, na ordem pedida (o que sumiu fica de
 * fora): a magia, como na 1.12.0; a ação, só com algo a usar.
 */
function itensUsaveis(ator, ids) {
  return ids
    .map((id) => ator?.items?.get(id))
    .filter((i) => i && (i.type === "spell" || (TIPOS_DE_ACAO.has(i.type) && temAtividade(i))));
}

/**
 * Quem recebe o pedido: um usuário que NÃO é GM, dono do ator e conectado.
 * Vence quem tem o ator como personagem (User#character); depois, qualquer
 * dono conectado. Nenhum: o jogador não está no Foundry.
 */
export function donoDoAtor(ator, usuarios) {
  const donos = [...(usuarios ?? [])].filter((u) => u && !u.isGM && u.active && ator?.testUserPermission?.(u, "OWNER"));
  return donos.find((u) => u.character?.id === ator.id) ?? donos[0] ?? null;
}

/**
 * No GM ATIVO (op `magia.pedir` da ponte): passa o pedido ao jogador e
 * responde NA HORA, sem esperar o toque (a ponte espera só 10 s). O que o
 * jogador decidir volta depois, por `reportar` (op `magia.resultado`).
 */
export function pedirMagiaAoJogador({ actor_id, payload }, { game, reportar }) {
  const ator = game.actors?.get(actor_id);
  if (!ator) throw new Error(`actor not found: ${actor_id}`);
  const usaveis = itensUsaveis(ator, itensDoPedido(payload));
  if (!usaveis.length) return { data: { entregue: false, motivo: "magia_nao_achada" } };
  const usuario = donoDoAtor(ator, game.users);
  if (!usuario) return { data: { entregue: false, motivo: "jogador_fora" } };
  const pedido_id = payload?.pedido_id ?? null;
  const dados = {
    actor_id,
    item_id: usaveis[0].id,
    itens: usaveis.map((i) => i.id),
    pedido_id,
    falado: typeof payload?.falado === "string" ? payload.falado.slice(0, 300) : null,
  };
  Promise.resolve()
    .then(() => usuario.query(QUERY_LANCAR_MAGIA, dados, { timeout: ESPERA_DO_JOGADOR_MS }))
    .then((r) => reportar({ pedido_id, ...(r && typeof r === "object" ? r : { ok: false, motivo: "resposta_vazia" }) }))
    .catch((e) => reportar({ pedido_id, ok: false, motivo: "sem_resposta", erro: String(e?.message ?? e).slice(0, 200) }));
  return { data: { entregue: true, usuario: usuario.name ?? null } };
}

/**
 * No navegador do JOGADOR (o handler da pergunta): confere que os itens são
 * dele, mostra "Lançar X?" (ou "Usar X, depois Y?") com os alvos que ELE
 * marcou e só então usa cada um, em ordem. `confirmar` devolve true só com o
 * "Lançar"/"Usar". Desde a 1.13.0 não exige combate (decisão do Bruno, 21/10):
 * quem decide é a fala que ele configurou.
 *
 * O dnd5e devolve nada quando o jogador cancela o diálogo dele: aí para, e o
 * que já foi usado fica (`usados`). O Companion lê "recusou".
 */
export async function lancarMagiaNoJogador(dados, { game, confirmar }) {
  const ator = game.actors?.get(dados?.actor_id);
  const ids = Array.isArray(dados?.itens) && dados.itens.length ? dados.itens.slice(0, MAX_ITENS_DO_ATALHO) : [dados?.item_id];
  const itens = itensUsaveis(ator, ids);
  if (!itens.length) return { ok: false, motivo: "magia_nao_achada" };
  if (itens.some((i) => !i.isOwner)) return { ok: false, motivo: "nao_e_dono" };
  const alvos = [...(game.user?.targets ?? [])].map((t) => t?.name).filter(Boolean);
  const sim = await confirmar({ itens: itens.map((i) => ({ nome: i.name, tipo: i.type })), alvos, falado: dados?.falado ?? null });
  if (sim !== true) return { ok: true, lancou: false, motivo: "recusou" };
  let usados = 0;
  for (const item of itens) {
    const r = await item.use();
    if (r == null) return { ok: true, lancou: false, motivo: "cancelou_no_dnd5e", usados };
    usados += 1;
  }
  return { ok: true, lancou: true, motivo: null };
}

/** "Lançar" quando é uma magia só; "Usar" no resto (arma, poção, atalho). */
export function eLancar(itens) {
  return itens?.length === 1 && itens[0]?.tipo === "spell";
}

/**
 * O texto da pergunta, já escapado (os nomes dos itens e dos alvos vêm do
 * mundo): "Lançar X em Y?" para uma magia só; "Usar X em Y?" e "Usar X, depois
 * Z em Y?" no resto.
 */
export function textoDaPergunta({ itens, alvos, falado }, t) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const alvo = alvos?.length ? alvos.map(esc).join(", ") : t("CFB.Magia.SemAlvo");
  const nomes = (itens ?? []).map((i) => `<strong>${esc(i?.nome ?? "")}</strong>`).join(t("CFB.Magia.Depois"));
  const chave = eLancar(itens) ? "CFB.Magia.Pergunta" : "CFB.Magia.PerguntaUsar";
  const linhas = [`<p>${t(chave).replace("{magia}", nomes).replace("{alvo}", `<strong>${alvo}</strong>`)}</p>`];
  if (falado) linhas.push(`<p class="hint">${t("CFB.Magia.Ouvido").replace("{falado}", esc(falado))}</p>`);
  return linhas.join("");
}
