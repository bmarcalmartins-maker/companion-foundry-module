import { MODULE_ID } from "./settings.js";
import { postInbound } from "./equip-sync.js";
import { QUERY_LANCAR_MAGIA, eLancar, lancarMagiaNoJogador, pedirMagiaAoJogador, textoDaPergunta } from "./magias.js";

/**
 * A MAGIA FALADA ligada ao Foundry (v1.12.0; as regras em magias.js).
 *
 * - Em TODO navegador (jogador e GM), no `init`: o handler da pergunta
 *   `companion-foundry-bridge.lancarMagia` em CONFIG.queries. É o único código
 *   do módulo que roda no navegador do jogador: ele só mostra a pergunta e,
 *   com o "Lançar", usa a magia como o próprio jogador faria.
 * - No GM ATIVO (bridge-client.js, op `magia.pedir`): `pedirMagia`.
 *
 * O resultado (lançou, recusou, sem combate…) volta ao Companion pela entrada
 * de sempre (`op: "magia.resultado"`), só do navegador do GM, que é o que tem
 * a chave de entrada.
 */

const t = (k) => game.i18n.localize(k);

/** "Lançar X em Y?" ou "Usar X, depois Z?": true só com o "Lançar"/"Usar". O padrão do Enter é o "Agora não". */
async function confirmarNoFoundry({ itens, alvos, falado }) {
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.confirm({
    window: { title: t("CFB.Magia.Titulo"), icon: "fa-solid fa-wand-sparkles" },
    content: textoDaPergunta({ itens, alvos, falado }, t),
    yes: { label: t(eLancar(itens) ? "CFB.Magia.Lancar" : "CFB.Magia.Usar"), icon: "fa-solid fa-wand-sparkles", default: false },
    no: { label: t("CFB.Magia.AgoraNao"), default: true },
    rejectClose: false,
  });
}

/** No `init`, em todo navegador. Foundry sem CONFIG.queries (v12): nada. */
export function registerMagiaFalada() {
  if (!CONFIG.queries) return;
  CONFIG.queries[QUERY_LANCAR_MAGIA] = (dados) => lancarMagiaNoJogador(dados, { game, confirmar: confirmarNoFoundry });
}

/** No GM ativo: a op `magia.pedir` da ponte. */
export function pedirMagia(cmd) {
  return pedirMagiaAoJogador(cmd, {
    game,
    reportar: (r) => {
      void postInbound({ op: "magia.resultado", actor_id: cmd.actor_id, ...r }, { silencioso404: true }).then((res) => {
        // null: sem rede ou sem a configuração; { ok: false }: a edge recusou
        if (!res || res.ok === false) console.warn(`${MODULE_ID} | magia falada: o resultado do pedido ${r?.pedido_id} não chegou ao Companion`, res?.status ?? "");
      });
    },
  });
}
