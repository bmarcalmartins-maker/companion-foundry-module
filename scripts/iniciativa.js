import { donoDoAtor } from "./magias.js";

/**
 * A INICIATIVA FALADA (v1.23.0, 07/11/2026). O Mestre diz "iniciativa" na mesa
 * (ou aperta o botão da Mesa do Companion); o Companion mostra um cartão com
 * quem vai entrar e, quando ele confirma, o combate abre aqui. Cada jogador
 * rola a SUA: na janela "Rolar iniciativa?" que abre no navegador dele, ou no
 * botão da Mesa do Companion — vale o primeiro.
 *
 * O caminho: banco do Companion → edge iniciativa-foundry → ponte
 * (POST /combate) → o GM ATIVO, op `combate.comando` (iniciativa-foundry.js):
 *   cena     a lista dos tokens da cena ativa (os personagens, os outros, os
 *            selecionados pelo Mestre agora, o combate que já existe);
 *   abrir    cria o combate (ou usa o de agora), adiciona os marcados, rola os
 *            que não são personagens e pergunta a cada jogador;
 *   rolar    o jogador apertou no Companion: rola no navegador dele sem
 *            perguntar; sem ele no Foundry, o GM rola por ele ("rolado pelo
 *            Companion" na mensagem);
 *   comecar  a rodada 1 (startCombat);
 *   parar    para de vigiar a seleção do Mestre.
 * Quem rolou volta ao Companion pelo gancho updateCombatant (edge
 * foundry-combate, op iniciativa.rolou), venha a rolagem de onde vier.
 *
 * As regras daqui não tocam o Foundry direto: recebem `game` e as funções que
 * criam e rolam (test/iniciativa.test.js usa um Foundry de mentira).
 *
 * O dnd5e 5.3: a rolagem de cada combatente sai de Combatant5e#getInitiativeRoll
 * → actor.getInitiativeRoll(), SEM diálogo e com a vantagem automática da
 * ficha (documents/combatant.mjs e actor/actor.mjs da release-5.3.0). Não se
 * usa actor.rollInitiativeDialog(): ele rola no combate que o usuário está
 * VENDO e cria combatente se não houver.
 */

/** O nome da pergunta, com o prefixo do módulo, como o Foundry exige (CONFIG.queries). */
export const QUERY_ROLAR_INICIATIVA = "companion-foundry-bridge.rolarIniciativa";

/** Quanto o GM espera a janela do jogador (ela continua aberta depois). */
export const ESPERA_DA_JANELA_MS = 600_000;

/** Quanto o GM espera o navegador do jogador rolar pelo Companion (sem janela). */
export const ESPERA_DO_ROLAR_MS = 15_000;

/** Até quantos outros tokens vão ao cartão (as miniaturas pesam). */
export const MAX_OUTROS = 60;

/** Até quantos selecionados vão ao Companion. */
export const MAX_SELECIONADOS = 150;

/** Quanto tempo o GM vigia a seleção depois de mandar a lista. */
export const VIGIA_MS = 15 * 60_000;

const numero = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const lista = (v) => (Array.isArray(v) ? v : v ? [...v] : []);

/** O combate desta cena: o ativo, senão o último criado. */
export function combateDaCena(game, cenaId) {
  const daCena = lista(game?.combats).filter((c) => (c?.scene?.id ?? c?._source?.scene ?? null) === cenaId);
  return daCena.find((c) => c.active) ?? daCena.at(-1) ?? null;
}

/** Os ids dos tokens selecionados pelo usuário deste navegador, se ele está vendo a cena `cenaId`. */
export function selecionadosNaCena(canvas, cenaId) {
  if (!canvas?.scene || canvas.scene.id !== cenaId) return [];
  return [...new Set(lista(canvas.tokens?.controlled).map((t) => t?.document?.id ?? t?.id).filter(Boolean))].slice(0, MAX_SELECIONADOS);
}

const imagemDoToken = (t) => t?.texture?.src ?? t?.img ?? null;

/**
 * A lista da cena ativa para o cartão do Companion (op `cena`). `pcs` são os
 * personagens do Companion com ator no Foundry (`do_mestre`: o PC da conta do
 * Mestre, o PC Teste, que só aparece se tem token na cena). `miniatura(src)`
 * devolve a imagem pequena (data URL) ou nulo.
 */
export async function listarCena({ game, canvas, pcs = [], miniatura = async () => null }) {
  const cena = game?.scenes?.active;
  if (!cena) return { erro: "sem_cena_ativa" };
  const selecionados = selecionadosNaCena(canvas, cena.id);
  const sel = new Set(selecionados);
  const combate = combateDaCena(game, cena.id);
  const noCombate = new Set(lista(combate?.combatants).map((c) => c?.tokenId).filter(Boolean));
  const tokens = lista(cena.tokens);
  const usados = new Set();

  const saidaPcs = [];
  for (const pc of lista(pcs)) {
    if (!pc?.actor_id) continue;
    const doAtor = tokens.filter((t) => t?.actorId === pc.actor_id);
    const tok = doAtor.find((t) => t.actorLink) ?? doAtor[0] ?? null;
    if (!tok && pc.do_mestre) continue;
    if (tok) usados.add(tok.id);
    saidaPcs.push({
      character_id: pc.character_id ?? null,
      actor_id: pc.actor_id,
      nome: pc.nome ?? tok?.name ?? null,
      token_id: tok?.id ?? null,
      token_nome: tok?.name ?? null,
      img: tok ? await miniatura(imagemDoToken(tok)) : null,
      escondido: tok?.hidden === true,
      no_combate: tok ? noCombate.has(tok.id) : false,
      do_mestre: pc.do_mestre === true,
    });
  }

  // os selecionados primeiro: com mais de MAX_OUTROS tokens na cena, eles não ficam de fora
  const resto = tokens.filter((t) => t?.id && !usados.has(t.id)).sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)));
  const outros = [];
  for (const t of resto.slice(0, MAX_OUTROS)) {
    outros.push({
      token_id: t.id,
      nome: t.name ?? t.actor?.name ?? "?",
      img: await miniatura(imagemDoToken(t)),
      escondido: t.hidden === true,
      tipo: t.actor?.type ?? null,
      actor_id: t.actorId ?? null,
      no_combate: noCombate.has(t.id),
    });
  }

  return {
    cena: { id: cena.id, nome: cena.name ?? null },
    vendo: canvas?.scene?.id === cena.id,
    combate: combate
      ? { id: combate.id, comecado: combate.started === true, rodada: numero(combate.round) ?? 0, combatentes: lista(combate.combatants).length }
      : null,
    pcs: saidaPcs,
    outros,
    total_tokens: tokens.length,
    selecionados,
  };
}

/**
 * No GM: pergunta "Rolar iniciativa?" ao jogador dono do combatente, sem
 * esperar a resposta (o que ele fizer volta pelo updateCombatant). Devolve se
 * havia jogador conectado para receber.
 */
export function perguntarAoJogador({ combate, combatente, pedido_id }, { game }) {
  const usuario = combatente?.actor ? donoDoAtor(combatente.actor, game.users) : null;
  if (!usuario) return { entregue: false, usuario: null };
  const dados = { combate_id: combate.id, combatant_id: combatente.id, pedido_id: pedido_id ?? null, perguntar: true };
  Promise.resolve()
    .then(() => usuario.query(QUERY_ROLAR_INICIATIVA, dados, { timeout: ESPERA_DA_JANELA_MS }))
    .catch(() => {});
  return { entregue: true, usuario: usuario.name ?? null };
}

/**
 * No GM ATIVO, op `abrir`: o combate (novo ou o de agora), os marcados
 * adicionados, os outros rolados e a pergunta a cada jogador. Responde na hora.
 *
 * `criarCombate(cena)` cria e devolve o combate; `rolar(combate, ids)` rola
 * como o GM (os outros); `perguntar({combate, combatente, pedido_id})` é
 * perguntarAoJogador com o game.
 */
export async function abrirCombate(payload, { game, criarCombate, rolar, perguntar }) {
  const cena = (payload?.cena_id && game.scenes?.get(payload.cena_id)) || game.scenes?.active;
  if (!cena) throw new Error("sem_cena_ativa");
  let combate;
  if (payload?.modo === "adicionar") {
    combate = payload.combate_id ? game.combats?.get(payload.combate_id) : null;
    if (!combate) throw new Error("combate_sumiu");
  } else {
    combate = await criarCombate(cena);
  }

  const pedidos = lista(payload?.pcs);
  const tokens = [...new Set(lista(payload?.tokens))].map((id) => cena.tokens?.get?.(id)).filter(Boolean);
  const novos = tokens.filter((t) => !combate.getCombatantsByToken(t.id).length);
  if (novos.length) {
    await combate.createEmbeddedDocuments(
      "Combatant",
      novos.map((t) => ({ tokenId: t.id, sceneId: cena.id, actorId: t.actorId ?? null, hidden: t.hidden === true })),
    );
  }

  // os marcados que não são personagens do Companion: o Foundry rola agora
  const tokensDePc = new Set(pedidos.map((p) => p?.token_id).filter(Boolean));
  const outrosIds = [
    ...new Set(
      tokens
        .filter((t) => !tokensDePc.has(t.id))
        .flatMap((t) => combate.getCombatantsByToken(t.id))
        .filter((c) => numero(c?.initiative) === null)
        .map((c) => c.id),
    ),
  ];
  if (outrosIds.length) await rolar(combate, outrosIds);

  const pcs = [];
  for (const p of pedidos) {
    const c = (p?.token_id && combate.getCombatantsByToken(p.token_id)[0]) || (p?.actor_id && combate.getCombatantsByActor(p.actor_id)[0]) || null;
    if (!c) {
      pcs.push({ pedido_id: p?.pedido_id ?? null, combatant_id: null, motivo: "o token não entrou no combate" });
      continue;
    }
    const iniciativa = numero(c.initiative);
    const r = iniciativa === null ? perguntar({ combate, combatente: c, pedido_id: p.pedido_id }) : { entregue: false, usuario: null };
    pcs.push({ pedido_id: p.pedido_id ?? null, combatant_id: c.id, iniciativa, entregue: r.entregue, usuario: r.usuario });
  }

  return {
    combate_id: combate.id,
    cena_id: cena.id,
    comecado: combate.started === true,
    combatentes: lista(combate.combatants).length,
    adicionados: novos.length,
    outros_rolados: outrosIds.length,
    pcs,
  };
}

/**
 * No GM ATIVO, op `rolar`: o jogador apertou "Rolar iniciativa" no Companion.
 * Rola no navegador dele, sem perguntar; sem ele no Foundry (ou se o navegador
 * dele não rolar), o GM rola por ele. Responde na hora.
 *
 * `rolarNoGm(combate, combatente)` rola como o GM, com "rolado pelo Companion";
 * `reportarFalha(pedido_id, motivo)` devolve o botão ao jogador.
 */
export function rolarPeloCompanion(payload, { game, rolarNoGm, reportarFalha }) {
  const combate = game.combats?.get(payload?.combate_id);
  if (!combate) throw new Error("combate_sumiu");
  const c = combate.combatants?.get(payload?.combatant_id);
  if (!c) throw new Error("combatente_sumiu");
  const valor = numero(c.initiative);
  if (valor !== null) return { ja_rolou: true, valor };

  const pedido_id = payload.pedido_id ?? null;
  const peloGm = () =>
    Promise.resolve()
      .then(() => (numero(c.initiative) === null ? rolarNoGm(combate, c) : null))
      .catch((e) => reportarFalha(pedido_id, `o Foundry não rolou: ${String(e?.message ?? e).slice(0, 200)}`));
  const usuario = c.actor ? donoDoAtor(c.actor, game.users) : null;
  if (!usuario) {
    void peloGm();
    return { entregue: true, por: "mestre" };
  }
  const dados = { combate_id: combate.id, combatant_id: c.id, pedido_id, perguntar: false, pelo_companion: true };
  Promise.resolve()
    .then(() => usuario.query(QUERY_ROLAR_INICIATIVA, dados, { timeout: ESPERA_DO_ROLAR_MS }))
    .then((r) => (r && r.ok === true ? null : peloGm()))
    .catch(() => peloGm());
  return { entregue: true, por: "jogador", usuario: usuario.name ?? null };
}

/** Os combatentes rolando agora NESTE navegador (o primeiro toque vale). */
const rolandoAqui = new Set();

/**
 * No navegador do JOGADOR (o handler da pergunta): com `perguntar`, a janela
 * "Rolar iniciativa?"; sem (veio do botão do Companion), rola direto. Nunca
 * rola duas vezes: o que já tem iniciativa, ou está rolando, fica.
 *
 * `perguntar({combate, combatente})` devolve true só com "Rolar" (e fecha
 * sozinha se a iniciativa chegar por outro caminho); `rolar(combate,
 * combatente, {pelo_companion})` rola como este usuário.
 */
export async function rolarNoJogador(dados, { game, perguntar, rolar }) {
  const combate = game.combats?.get(dados?.combate_id);
  const c = combate?.combatants?.get(dados?.combatant_id);
  if (!c) return { ok: false, motivo: "combatente_sumiu" };
  if (!c.isOwner) return { ok: false, motivo: "nao_e_dono" };
  if (numero(c.initiative) !== null) return { ok: true, rolou: false, motivo: "ja_rolou", valor: c.initiative };
  if (dados?.perguntar) {
    const sim = await perguntar({ combate, combatente: c });
    if (numero(c.initiative) !== null) return { ok: true, rolou: false, motivo: "ja_rolou", valor: c.initiative };
    if (sim !== true) return { ok: true, rolou: false, motivo: "recusou" };
  }
  if (rolandoAqui.has(c.id)) return { ok: true, rolou: false, motivo: "ja_rolando" };
  rolandoAqui.add(c.id);
  try {
    await rolar(combate, c, { pelo_companion: dados?.pelo_companion === true });
  } finally {
    rolandoAqui.delete(c.id);
  }
  return { ok: true, rolou: true, valor: numero(c.initiative) };
}

/**
 * O gancho updateCombatant (todo navegador; quem manda é o GM ativo): um
 * combatente de PERSONAGEM ganhou iniciativa? Devolve o corpo da op
 * `iniciativa.rolou`, ou nulo. `pelo_gm`: quem gravou é um GM.
 */
export function eventoDeRolagem(combatente, mudanca, userId, game) {
  if (!mudanca || !Object.prototype.hasOwnProperty.call(mudanca, "initiative")) return null;
  const valor = numero(mudanca.initiative);
  if (valor === null) return null;
  const ator = combatente?.actor;
  if (ator?.type !== "character") return null;
  const combateId = combatente?.parent?.id ?? combatente?.combat?.id ?? null;
  const actorId = combatente?.actorId ?? ator?.id ?? null;
  if (!combateId || !combatente?.id || !actorId) return null;
  return {
    op: "iniciativa.rolou",
    combate_id: combateId,
    combatant_id: combatente.id,
    actor_id: actorId,
    valor,
    pelo_gm: game?.users?.get?.(userId)?.isGM === true,
  };
}

/**
 * O texto da mensagem do chat quando a rolagem veio do Companion (decisão do
 * Bruno, 07/11: "deixe claro que foi pelo Companion"). `t` é o i18n.
 */
export function textoDaRolagem({ nome, pelo_gm }, t) {
  const chave = pelo_gm ? "CFB.Iniciativa.RoladoPeloCompanionMestre" : "CFB.Iniciativa.RoladoPeloCompanion";
  return t(chave).replace("{nome}", String(nome ?? ""));
}

/** O texto da janela "Rolar iniciativa?", já escapado (o nome vem do mundo). */
export function textoDaJanela({ nome }, t) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return [
    `<p>${t("CFB.Iniciativa.Pergunta").replace("{nome}", `<strong>${esc(nome ?? "")}</strong>`)}</p>`,
    `<p class="hint">${t("CFB.Iniciativa.Dica")}</p>`,
  ].join("");
}
