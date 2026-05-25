import { BridgeStatusApp } from "./status-app.js";

/** Module id — also the namespace for settings and item flags. */
export const MODULE_ID = "companion-foundry-bridge";

/** Default bridge endpoint (the deployed Cloudflare Worker). */
export const DEFAULT_BRIDGE_URL = "wss://bridge.companion-products.org/ws";

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
