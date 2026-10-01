/**
 * MOEDAS — as regras, sem Foundry (v1.9.0, frente OURO do Companion, 01/10).
 * Os testes estão em test/moedas.test.js; a parte que fala com o Foundry, em
 * moedas-sync.js.
 *
 * O ouro de cada personagem é o MESMO no Foundry e no Companion, nos dois
 * sentidos. No dnd5e são cinco moedas em `system.currency` — pp, gp, ep, sp, cp,
 * inteiros nunca negativos (dnd5e 5.3.0, module/data/shared/currency.mjs) — e o
 * Companion guarda as mesmas cinco (`wallets`).
 *
 * QUEM VENCE. Os dois lados guardam a última vez que concordaram: o Companion
 * numa VERSÃO da carteira (sobe a cada mudança, no banco) e o ator na flag
 * `moedas_sync = { pp, gp, ep, sp, cp, versao }`. Quando chega um envio do
 * Companion (`decidirMoedas`):
 *  - sem `moedas_sync` (primeiro contato): o FOUNDRY vence — as moedas daqui
 *    vão ao Companion, e nada daqui é sobrescrito;
 *  - as moedas daqui diferentes de `moedas_sync` (o Foundry mudou depois da
 *    última vez): o FOUNDRY vence;
 *  - versão do envio ≤ a de `moedas_sync`: envio velho, ignora;
 *  - senão, aplica as do Companion (ou só anota a versão, se já são iguais).
 */

export const MOEDAS = ["pp", "gp", "ep", "sp", "cp"];

/** O mesmo teto da edge e do banco (carteira_definir, foundry_inbound_moedas). */
const TETO = 1_000_000_000;

/** As cinco moedas como inteiros de 0 ao teto, ou null se faltar ou sobrar algo errado. */
export function moedasValidas(m) {
  if (!m || typeof m !== "object") return null;
  const saida = {};
  for (const k of MOEDAS) {
    const v = m[k];
    if (!Number.isInteger(v) || v < 0 || v > TETO) return null;
    saida[k] = v;
  }
  return saida;
}

export function mesmasMoedas(a, b) {
  return !!a && !!b && MOEDAS.every((k) => a[k] === b[k]);
}

/** A flag `moedas_sync` lida do ator: as cinco moedas e a versão, ou null. */
export function sincronizadoValido(s) {
  const m = moedasValidas(s);
  if (!m || !Number.isInteger(s.versao) || s.versao < 0) return null;
  return { ...m, versao: s.versao };
}

/**
 * O que fazer com as moedas de um envio do Companion.
 *   "invalido"      o envio não traz as cinco moedas e a versão;
 *   "foundry_vence" não aplica; as moedas daqui vão ao Companion;
 *   "antigo"        envio mais velho que o último acordo: ignora;
 *   "igual"         já são as mesmas: só anota a versão;
 *   "aplicar"       grava as do Companion no ator.
 */
export function decidirMoedas({ atual, sincronizado, recebido }) {
  const r = moedasValidas(recebido);
  if (!r || !Number.isInteger(recebido?.versao)) return "invalido";
  const s = sincronizadoValido(sincronizado);
  if (!s) return "foundry_vence";
  const a = moedasValidas(atual);
  if (!a || !mesmasMoedas(a, s)) return "foundry_vence";
  if (recebido.versao <= s.versao) return "antigo";
  if (mesmasMoedas(a, r)) return "igual";
  return "aplicar";
}

/** A mudança do ator (gancho updateActor) mexeu nas moedas? */
export function mudouMoedas(changes) {
  if (!changes || typeof changes !== "object") return false;
  if (changes.system && typeof changes.system === "object" && "currency" in changes.system) return true;
  return Object.keys(changes).some((k) => k === "system.currency" || k.startsWith("system.currency."));
}
