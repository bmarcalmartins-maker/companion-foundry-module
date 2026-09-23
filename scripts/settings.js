import { BridgeStatusApp } from "./status-app.js";

/** Module id — also the namespace for settings and item flags. */
export const MODULE_ID = "companion-foundry-bridge";

/** Default bridge endpoint (the deployed Cloudflare Worker). */
export const DEFAULT_BRIDGE_URL = "wss://bridge.companion-products.org/ws";

/** Default da porta de entrada Foundry→Companion (edge function foundry-inbound). */
export const DEFAULT_INBOUND_URL = "https://leziqtoarclocroaqwsp.supabase.co/functions/v1/foundry-inbound";

/** Registra as configurações + o menu de status da conexão. Chamado no `init`. */
export function registerSettings() {
  game.settings.register(MODULE_ID, "bridgeUrl", {
    name: "CFB.Settings.BridgeUrl.Name",
    hint: "CFB.Settings.BridgeUrl.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_BRIDGE_URL,
  });

  /*
   * AS DUAS CHAVES MORAM NO NAVEGADOR DO GM (scope "client"), não no mundo.
   *
   * Configuração de mundo "vale para todos os usuários e dispositivos
   * conectados ao mundo" (artigo Game Settings do Foundry): o valor chega ao
   * navegador de CADA jogador, e `game.settings.get` no console o mostra. Com
   * a chave da ponte, um jogador conectava no Worker; com a de entrada,
   * forjava equipar e ficha de qualquer PC. Até a v1.7.1 as duas eram de
   * mundo.
   *
   * Agora: "client" = localStorage deste navegador, nunca sai dele. Só o GM
   * usa (é quem conecta e quem reporta). Custo: cada navegador de GM digita as
   * chaves uma vez. As antigas de mundo continuam registradas (escondidas) só
   * para a migração abaixo esvaziá-las.
   */
  game.settings.register(MODULE_ID, "apiKeyLocal", {
    name: "CFB.Settings.ApiKey.Name",
    hint: "CFB.Settings.ApiKey.Hint",
    scope: "client",
    config: true,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "apiKey", {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  // Foundry→Companion (mão de volta): URL + segredo da edge foundry-inbound.
  // Config do DM, não hardcoded — key vazia desliga a mão de volta inteira.
  game.settings.register(MODULE_ID, "inboundUrl", {
    name: "CFB.Settings.InboundUrl.Name",
    hint: "CFB.Settings.InboundUrl.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_INBOUND_URL,
  });

  game.settings.register(MODULE_ID, "inboundKeyLocal", {
    name: "CFB.Settings.InboundKey.Name",
    hint: "CFB.Settings.InboundKey.Hint",
    scope: "client",
    config: true,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "inboundKey", {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, "autoConnect", {
    name: "CFB.Settings.AutoConnect.Name",
    hint: "CFB.Settings.AutoConnect.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.registerMenu(MODULE_ID, "statusMenu", {
    name: "CFB.Settings.StatusMenu.Name",
    label: "CFB.Settings.StatusMenu.Label",
    hint: "CFB.Settings.StatusMenu.Hint",
    icon: "fas fa-plug",
    type: BridgeStatusApp,
    restricted: true,
  });
}

/** Chave da ponte (Worker) — só a deste navegador. */
export function chaveDaPonte() {
  return game.settings.get(MODULE_ID, "apiKeyLocal") ?? "";
}

/** Chave da edge foundry-inbound — só a deste navegador. */
export function chaveDeEntrada() {
  return game.settings.get(MODULE_ID, "inboundKeyLocal") ?? "";
}

/**
 * Migração v1.7.2: tira as chaves do mundo (onde todo jogador as recebia) e
 * as traz para este navegador. Só o GM roda — só ele pode gravar config de
 * mundo, e é o navegador dele que precisa das chaves.
 *
 * Ordem: copia para o navegador ANTES de apagar do mundo, e só apaga o que foi
 * copiado (ou que este navegador já tinha). Outro GM em outro navegador vai
 * precisar digitar as chaves de novo — o aviso diz isso.
 */
export async function migrarChavesParaONavegador() {
  if (!game.user?.isGM) return;
  const pares = [
    ["apiKey", "apiKeyLocal"],
    ["inboundKey", "inboundKeyLocal"],
  ];
  let movidas = 0;
  for (const [mundo, local] of pares) {
    const antiga = game.settings.get(MODULE_ID, mundo);
    if (!antiga) continue;
    if (!game.settings.get(MODULE_ID, local)) await game.settings.set(MODULE_ID, local, antiga);
    if (game.settings.get(MODULE_ID, local)) {
      await game.settings.set(MODULE_ID, mundo, "");
      movidas++;
    }
  }
  if (movidas) {
    const msg = game.i18n.localize("CFB.Notify.ChavesMovidas");
    ui.notifications?.info(msg, { permanent: true });
    console.log(`${MODULE_ID} | ${movidas} chave(s) movida(s) do mundo para este navegador`);
  }
}
