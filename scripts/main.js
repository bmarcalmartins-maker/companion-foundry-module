import { MODULE_ID, registerSettings } from "./settings.js";
import { BridgeClient } from "./bridge-client.js";
import { registerEquipWatcher } from "./equip-sync.js";

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | initialized`);
});

Hooks.once("ready", () => {
  // Only the GM holds the bridge connection — it's the only client allowed to
  // create world actors, and a single connection avoids duplicate writes.
  if (!game.user.isGM) return;

  const client = new BridgeClient();
  const module = game.modules.get(MODULE_ID);
  module.api = {
    client,
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    reconnect: () => client.reconnect(),
    getStatus: () => client.status,
  };

  if (game.settings.get(MODULE_ID, "autoConnect")) client.connect();

  // Foundry→Companion (bidirecional): observa equip/desequip de itens synced.
  // GM-only por estar dentro deste bloco — clientes de jogador nunca registram.
  registerEquipWatcher();
});
