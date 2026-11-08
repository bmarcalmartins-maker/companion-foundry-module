/**
 * A ORDEM DO COMBATE (v1.24.0; Companion, migration 20261108100000). As regras
 * puras, sem Foundry, para o teste (test/ordem.test.js); quem liga aos ganchos
 * e manda é o ordem-foundry.js.
 *
 * - `combateParaMostrar(game)`: o combate COMEÇADO na cena ativa (o ativo dela,
 *   senão o último); sem um, o combate começado que não é de cena nenhuma.
 * - `fotoDoCombate(combate)`: a FOTO que vai ao Companion, na ordem do Foundry
 *   (`combat.turns`, a mesma do Combat Tracker e do Carousel): quem, a
 *   iniciativa (nula = não rolou), o escondido (o combatente e o token), o
 *   derrotado, o tipo do ator e a vida (dnd5e: hp.value, o máximo efetivo e o
 *   temporário). O Companion tira a vida e os escondidos do que o jogador lê.
 * - `comandoDeTurno` / `focarCombatente`: o "Próximo turno", o "Turno anterior"
 *   e o "Selecionar" do Mestre (ação combate.comando da ponte).
 */
export const MAX_COMBATENTES = 100;
/** Cada envio espera 0,4 s depois do último gancho (dez ganchos juntos = um envio). */
export const ESPERA_DA_FOTO_MS = 400;
/** Sem gancho nenhum, a foto é comparada a cada 4 s (a vida do token não ligado). */
export const COMPARA_MS = 4_000;
/** O "estou vivo": a mesma foto de novo, enquanto houver combate. */
export const VIVO_MS = 30_000;

const numero = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const lista = (v) => (Array.isArray(v) ? v : v ? [...v] : []);
const cenaDe = (c) => c?.scene?.id ?? c?._source?.scene ?? null;

/** O combate que a ordem mostra, ou nulo. */
export function combateParaMostrar(game) {
  const comecados = lista(game?.combats).filter((c) => c?.started === true);
  if (!comecados.length) return null;
  const cenaAtiva = game?.scenes?.active?.id ?? null;
  const daCena = cenaAtiva ? comecados.filter((c) => cenaDe(c) === cenaAtiva) : [];
  if (daCena.length) return daCena.find((c) => c.active) ?? daCena.at(-1);
  const semCena = comecados.filter((c) => !cenaDe(c));
  return semCena.find((c) => c.active) ?? semCena.at(-1) ?? null;
}

/** A vida do ator (dnd5e 5.3: attributes.mjs), ou nulo. */
export function vidaDoAtor(ator) {
  const hp = ator?.system?.attributes?.hp;
  const valor = numero(hp?.value);
  if (valor === null) return null;
  const max = numero(hp.effectiveMax) ?? numero(hp.max);
  const temp = numero(hp.temp);
  const v = { valor };
  if (max !== null) v.max = max;
  if (temp) v.temp = temp;
  return v;
}

const imagemDe = (c) => {
  const src = c?.img ?? c?.token?.texture?.src ?? c?.actor?.img ?? null;
  return typeof src === "string" && src && !/^\s*data:/i.test(src) ? src : null;
};

/** A foto do combate, ou nulo sem combate. */
export function fotoDoCombate(combate) {
  if (!combate) return null;
  const combatentes = lista(combate.turns)
    .slice(0, MAX_COMBATENTES)
    .filter((c) => c?.id)
    .map((c) => {
      const f = {
        id: c.id,
        token_id: c.tokenId ?? c.token?.id ?? null,
        actor_id: c.actorId ?? c.actor?.id ?? null,
        nome: c.name ?? c.token?.name ?? c.actor?.name ?? "?",
        img: imagemDe(c),
        iniciativa: numero(c.initiative),
        escondido: c.hidden === true,
        token_escondido: c.token?.hidden === true,
        derrotado: c.isDefeated === true,
        tipo: c.actor?.type ?? null,
        pv: vidaDoAtor(c.actor),
      };
      return f;
    });
  return {
    id: combate.id,
    cena: combate.scene ? { id: combate.scene.id, nome: combate.scene.name ?? null } : null,
    rodada: numero(combate.round) ?? 0,
    turno: numero(combate.turn),
    vez: combate.combatant?.id ?? null,
    combatentes,
  };
}

/** A chave de comparação (a foto + as versões): muda = manda. */
export function chaveDoEnvio(foto, modulo) {
  return JSON.stringify([foto ?? null, modulo ?? null]);
}

/**
 * Decide o que fazer agora, a partir da última vez que mandou:
 *   "manda" (a foto mudou), "vivo" (a mesma, mas faz 30 s), ou nulo.
 * `ultima` = { chave, em, ativo } do último envio que deu certo (ou nulo).
 */
export function oQueMandar(chave, ativo, ultima, agora) {
  if (!ultima) return "manda";
  if (chave !== ultima.chave) return "manda";
  if (ativo && agora - ultima.em >= VIVO_MS) return "vivo";
  return null;
}

/**
 * "Próximo turno" e "Turno anterior". Só passa se o combate ainda está na vez
 * que o Mestre viu (dois cliques não pulam dois turnos). A recusa vai com 200
 * (`recusado`): não é erro da ponte.
 */
export async function comandoDeTurno(payload, { game, passarTurno, voltarTurno }) {
  const combate = game?.combats?.get?.(payload?.combate_id);
  if (!combate) throw new Error("combate_sumiu");
  if (!combate.started) return { recusado: "nao_comecado" };
  if (payload?.vez_vista && (combate.combatant?.id ?? null) !== payload.vez_vista) return { recusado: "a_vez_mudou" };
  if (payload?.acao === "anterior") await voltarTurno(combate);
  else await passarTurno(combate);
  return { passou: true, vez: combate.combatant?.id ?? null, rodada: numero(combate.round) ?? 0 };
}

/** "Selecionar": o token do combatente e a câmera nele (no navegador do GM). */
export async function focarCombatente(payload, { game, focar }) {
  const combate = game?.combats?.get?.(payload?.combate_id);
  if (!combate) throw new Error("combate_sumiu");
  const c = combate.combatants?.get?.(payload?.combatant_id);
  if (!c) throw new Error("combatente_sumiu");
  const cena = c.token?.parent ?? combate.scene ?? null;
  if (!c.token || !cena) return { recusado: "sem_token" };
  const r = await focar(cena, c.token);
  return r?.recusado ? r : { focado: true };
}

/**
 * As versões do módulo para o Companion: a que o Foundry diz ter instalada
 * (do servidor, nunca do cache), a DESTE código e a de cada navegador
 * conectado (nula = não respondeu: o código dele é anterior ao 1.24.0).
 */
export function versoesDoModulo({ servidor, codigo, navegadores }) {
  return {
    servidor: typeof servidor === "string" ? servidor : null,
    codigo: typeof codigo === "string" ? codigo : null,
    navegadores: lista(navegadores)
      .filter((n) => n && typeof n.usuario === "string")
      .slice(0, 30)
      .map((n) => ({ usuario: n.usuario.slice(0, 60), gm: n.gm === true, codigo: typeof n.codigo === "string" ? n.codigo : null })),
  };
}
