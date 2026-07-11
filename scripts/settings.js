import { BridgeStatusApp } from "./status-app.js";

/** Module id — also the namespace for settings and item flags. */
export const MODULE_ID = "companion-foundry-bridge";

/** Default bridge endpoint (the deployed Cloudflare Worker). */
export const DEFAULT_BRIDGE_URL = "wss://bridge.companion-products.org/ws";

/** Default da porta de entrada Foundry→Companion (edge function foundry-inbound). */
export const DEFAULT_INBOUND_URL = "https://leziqtoarclocroaqwsp.supabase.co/functions/v1/foundry-inbound";

/** Register world-scoped settings + the connection-status menu. Called on `init`. */
export function registerSettings() {
  game.settings.register(MODULE_ID, "bridgeUrl", {
    name: "CFB.Settings.BridgeUrl.Name",
    hint: "CFB.Settings.BridgeUrl.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_BRIDGE_URL,
  });

  game.settings.register(MODULE_ID, "apiKey", {
    name: "CFB.Settings.ApiKey.Name",
    hint: "CFB.Settings.ApiKey.Hint",
    scope: "world",
    config: true,
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

  game.settings.register(MODULE_ID, "inboundKey", {
    name: "CFB.Settings.InboundKey.Name",
    hint: "CFB.Settings.InboundKey.Hint",
    scope: "world",
    config: true,
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
