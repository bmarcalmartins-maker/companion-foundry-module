/**
 * OS ACERTOS E O DANO para o relatório do fim da sessão do Companion (v1.11.0;
 * AUTOMAÇÕES DA TRANSCRIÇÃO, item 12b). As regras, sem Foundry (testadas em
 * test/combate.test.js); quem ouve os ganchos e manda é combate-sync.js.
 *
 * De cada PERSONAGEM (actor do tipo "character"), quatro eventos:
 *   ataque       a mensagem de rolagem de ataque do dnd5e
 *                (flags.dnd5e.roll.type = "attack"). O acerto só se sabe com UM
 *                alvo marcado: o dnd5e põe a CA dele na rolagem
 *                (options.target) só nesse caso (attack.mjs da 5.3.3); com
 *                nenhum ou vários, `acertou` vai nulo. Crítico e falha sempre.
 *   dano         o dano que ele ROLOU (roll.type = "damage"): a soma das
 *                rolagens, antes de resistência. O dnd5e não diz quem causou o
 *                dano que um ator perde.
 *   cura         a cura que ele rolou (roll.type = "healing").
 *   dano_tomado  os PV que ele perdeu (o gancho dnd5e.damageActor; o dnd5e não
 *                o dispara em descanso nem em avanço).
 */

export const TIPOS = ["ataque", "dano", "dano_tomado", "cura"];

const TIPO_DA_ROLAGEM = { attack: "ataque", damage: "dano", healing: "cura" };
const inteiro = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const nomeCurto = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);

/**
 * A mensagem do chat vira evento? Devolve `{ actorId, evento }` ou nulo.
 * `tipoDoAtor(id)` diz o tipo do actor do mundo ("character", "npc"…);
 * `combateId` é o do combate em andamento (ou nulo).
 */
export function eventoDaMensagem(msg, { tipoDoAtor, combateId = null } = {}) {
  const roll = msg?.flags?.dnd5e?.roll;
  const tipo = TIPO_DA_ROLAGEM[roll?.type];
  if (!tipo || !msg?.id) return null;
  const actorId = msg.speaker?.actor;
  if (!actorId || tipoDoAtor?.(actorId) !== "character") return null;
  const rolls = Array.isArray(msg.rolls) ? msg.rolls : [];
  if (!rolls.length) return null;
  const alvos = Array.isArray(msg.flags.dnd5e.targets) ? msg.flags.dnd5e.targets : [];
  const alvo = alvos.length === 1 ? nomeCurto(alvos[0]?.name) : null;
  const evento = { id: `m-${msg.id}`, tipo, alvo, combate_id: combateId };
  if (tipo === "ataque") {
    const r = rolls[0];
    const total = inteiro(r?.total);
    if (total === null) return null;
    const ca = inteiro(r?.options?.target);
    evento.valor = total;
    evento.acertou = ca === null ? null : total >= ca;
    evento.critico = r?.isCritical === true;
    evento.falha = r?.isFumble === true;
  } else {
    let soma = 0;
    for (const r of rolls) {
      const t = inteiro(r?.total);
      if (t === null) return null;
      soma += t;
    }
    evento.valor = Math.max(0, soma);
  }
  return { actorId, evento };
}

/**
 * O gancho dnd5e.damageActor (changes = { hp, temp, total }; total negativo =
 * perdeu). Só do personagem do mundo (o token sem vínculo é uma cópia); a cura
 * recebida não entra (a cura é a rolada, acima).
 */
export function eventoDaVida(ator, changes, { novoId, combateId = null } = {}) {
  if (!ator || ator.type !== "character" || ator.isToken) return null;
  const total = inteiro(changes?.total);
  if (total === null || total >= 0) return null;
  return { actorId: ator.id, evento: { id: `v-${novoId()}`, tipo: "dano_tomado", valor: -total, combate_id: combateId } };
}

/** A fila de um actor: no máximo `teto` eventos (os mais velhos saem primeiro). */
export function enfileirar(fila, evento, teto = 200) {
  const nova = [...fila, evento];
  return nova.length > teto ? nova.slice(nova.length - teto) : nova;
}

/** O que fazer com a resposta da foundry-inbound: "pronto", "descarta" ou "repete". */
export function depoisDoEnvio(res) {
  if (res?.ok) return "pronto"; // gravou, ou "sem_sessao" (nada a gravar: não repete)
  if (res?.code === "actor_nao_vinculado" || res?.status === 400 || res?.status === 401 || res?.status === 413) return "descarta";
  return "repete"; // rede, 429, 5xx
}

/**
 * O TESTE DE PERÍCIA (v1.22.0; A MÚSICA PELO CONTEXTO do Companion): a
 * mensagem do chat de um teste de perícia de um PERSONAGEM vira
 * `{ pericia, evento_id }` (o dnd5e 5.3 põe `flags.dnd5e.roll = { type:
 * "skill", skillId }` na mensagem; actor.mjs, #rollSkillTool). Quem decide se a
 * perícia vira "investigação" é o banco do Companion; aqui só sai o fato.
 */
export function testeDaMensagem(msg, { tipoDoAtor } = {}) {
  const roll = msg?.flags?.dnd5e?.roll;
  if (roll?.type !== "skill" || !msg?.id) return null;
  const pericia = typeof roll.skillId === "string" ? roll.skillId.trim() : "";
  if (!/^[a-z]{3}$/.test(pericia)) return null;
  const actorId = msg.speaker?.actor;
  if (!actorId || tipoDoAtor?.(actorId) !== "character") return null;
  return { pericia, evento_id: `m-${msg.id}` };
}
