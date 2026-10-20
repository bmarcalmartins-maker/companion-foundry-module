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
 * Lógica pura, sem `game` (test/magias.test.js): quem liga ao Foundry é
 * magia-falada.js.
 */

/** O nome da pergunta, com o prefixo do módulo, como o Foundry exige (CONFIG.queries). */
export const QUERY_LANCAR_MAGIA = "companion-foundry-bridge.lancarMagia";

/** Quanto o GM espera o jogador decidir (o diálogo continua aberto depois). */
export const ESPERA_DO_JOGADOR_MS = 120_000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

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
  const itemId = payload?.item_id;
  const item = ator.items?.get(itemId);
  if (!item || item.type !== "spell") return { data: { entregue: false, motivo: "magia_nao_achada" } };
  const usuario = donoDoAtor(ator, game.users);
  if (!usuario) return { data: { entregue: false, motivo: "jogador_fora" } };
  const pedido_id = payload?.pedido_id ?? null;
  const dados = { actor_id, item_id: itemId, pedido_id, falado: typeof payload?.falado === "string" ? payload.falado.slice(0, 300) : null };
  Promise.resolve()
    .then(() => usuario.query(QUERY_LANCAR_MAGIA, dados, { timeout: ESPERA_DO_JOGADOR_MS }))
    .then((r) => reportar({ pedido_id, ...(r && typeof r === "object" ? r : { ok: false, motivo: "resposta_vazia" }) }))
    .catch((e) => reportar({ pedido_id, ok: false, motivo: "sem_resposta", erro: String(e?.message ?? e).slice(0, 200) }));
  return { data: { entregue: true, usuario: usuario.name ?? null } };
}

/**
 * No navegador do JOGADOR (o handler da pergunta): confere que a magia é dele
 * e que há combate, mostra "Lançar X?" com os alvos que ELE marcou e só então
 * usa a magia. `confirmar` devolve true só com o "Lançar".
 */
export async function lancarMagiaNoJogador(dados, { game, confirmar }) {
  const ator = game.actors?.get(dados?.actor_id);
  const item = ator?.items?.get(dados?.item_id);
  if (!item || item.type !== "spell") return { ok: false, motivo: "magia_nao_achada" };
  if (!item.isOwner) return { ok: false, motivo: "nao_e_dono" };
  if (!game.combat?.started) return { ok: false, motivo: "sem_combate" };
  const alvos = [...(game.user?.targets ?? [])].map((t) => t?.name).filter(Boolean);
  const sim = await confirmar({ magia: item.name, alvos, falado: dados?.falado ?? null });
  if (sim !== true) return { ok: true, lancou: false, motivo: "recusou" };
  const r = await item.use();
  return { ok: true, lancou: r != null, motivo: r != null ? null : "cancelou_no_dnd5e" };
}

/** O texto da pergunta, já escapado (o nome da magia e dos alvos vêm do mundo). */
export function textoDaPergunta({ magia, alvos, falado }, t) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const alvo = alvos?.length ? alvos.map(esc).join(", ") : t("CFB.Magia.SemAlvo");
  const linhas = [`<p>${t("CFB.Magia.Pergunta").replace("{magia}", `<strong>${esc(magia)}</strong>`).replace("{alvo}", `<strong>${alvo}</strong>`)}</p>`];
  if (falado) linhas.push(`<p class="hint">${t("CFB.Magia.Ouvido").replace("{falado}", esc(falado))}</p>`);
  return linhas.join("");
}
