/**
 * O COMBATE COMEÇOU OU ACABOU → Companion (v1.21.0; TRANCHE R, parte 1: a
 * trilha pelo clima). As regras, sem Foundry (testadas em
 * test/combate-estado.test.js); quem ouve os ganchos é combate-sync.js.
 *
 * O Companion troca a música para uma de combate NA HORA quando o combate
 * começa, e volta ao clima 1 min depois que ele acaba (quem decide é o banco,
 * trilha_combate). Daqui sai só o fato:
 *   { op: "combate.estado", combate_id, fase: "inicio" | "fim" }
 *
 * - "Começou" = o combate passou a ter rodada (Combat#started, round > 0),
 *   visto no gancho updateCombat (dispara em todo navegador DEPOIS da
 *   gravação; o combatStart dispara só no navegador de quem clicou, antes).
 * - "Acabou" = o combate começado foi apagado (o "Encerrar combate" do
 *   Foundry apaga o encontro: Combat#endCombat) ou voltou a não ter rodada.
 * - Ao abrir o mundo, os combates já começados entram como conhecidos, SEM
 *   mandar nada (o Companion já soube, ou a sessão nem existia).
 * - Cada fato vai uma vez; rede, 429 ou 5xx: tenta de novo até 3 vezes.
 */

export const TENTATIVAS = 3;
export const ESPERA_ERRO_MS = 3_000;

/** A decisão depois do envio (a mesma regra de combate.js). */
export function depoisDoEnvioDoEstado(res) {
  if (res?.ok) return "pronto";
  if (res?.status === 400 || res?.status === 401 || res?.status === 413) return "descarta";
  return "repete";
}

/**
 * A vigia dos combates. `enviar(corpo)` devolve a resposta da entrada (ou
 * nulo); `esperar(ms)` é o setTimeout em promessa (no teste, imediato).
 */
export function criarVigiaDoCombate({ enviar, esperar }) {
  const comecados = new Set();

  async function mandar(combateId, fase) {
    const corpo = { op: "combate.estado", combate_id: combateId, fase };
    for (let i = 1; i <= TENTATIVAS; i++) {
      const res = await enviar(corpo);
      const d = depoisDoEnvioDoEstado(res);
      if (d === "pronto") return res;
      if (d === "descarta" || i === TENTATIVAS) return res ?? null;
      await esperar(ESPERA_ERRO_MS * i);
    }
    return null;
  }

  return {
    /** Ao abrir o mundo: os já começados viram conhecidos, sem mandar. */
    conhecer(combates) {
      for (const c of combates ?? []) if (c?.id && c.started) comecados.add(c.id);
    },
    /** updateCombat: começou ou voltou a não ter rodada? */
    aoAtualizar(combat) {
      if (!combat?.id) return null;
      if (combat.started && !comecados.has(combat.id)) {
        comecados.add(combat.id);
        return mandar(combat.id, "inicio");
      }
      if (!combat.started && comecados.has(combat.id)) {
        comecados.delete(combat.id);
        return mandar(combat.id, "fim");
      }
      return null;
    },
    /** deleteCombat: o começado que foi apagado acabou. */
    aoApagar(combat) {
      if (!combat?.id || !comecados.has(combat.id)) return null;
      comecados.delete(combat.id);
      return mandar(combat.id, "fim");
    },
    comecados: () => [...comecados],
  };
}
