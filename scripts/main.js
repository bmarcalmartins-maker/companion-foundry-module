import { MODULE_ID, registerSettings } from "./settings.js";
import { BridgeClient } from "./bridge-client.js";
import { registerEquipWatcher, syncActorInventory, resetActorLink } from "./equip-sync.js";
import { listItems, listPacks } from "./compendium.js";

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
    // Sync inicial Foundry→Companion (macro/console):
    // game.modules.get("companion-foundry-bridge").api.syncInventory(actor)
    syncInventory: (actor) => syncActorInventory(actor),
    // Solta o vínculo deste actor (apaga cópias do bridge, limpa crachás) para
    // poder reenviar o inventário do zero. Rodar ANTES de zerar o Companion:
    // game.modules.get("companion-foundry-bridge").api.resetLink(actor)
    resetLink: (actor) => resetActorLink(actor),
    // LEITURA do compêndio (FASE 1). Expostas aqui além do protocolo WS para
    // dar um caminho de inspeção que NÃO depende do Worker nem da edge estarem
    // publicados — dá pra conferir o que o Foundry devolve direto no console:
    //   const api = game.modules.get("companion-foundry-bridge").api;
    //   await api.compendiumPacks();
    //   await api.compendiumItems({ packs: ["dnd5e.items"], offset: 0, limit: 5 });
    compendiumPacks: () => listPacks(),
    compendiumItems: (query) => listItems(query ?? {}),
  };

  if (game.settings.get(MODULE_ID, "autoConnect")) client.connect();

  // Foundry→Companion (bidirecional): observa equip/desequip de itens synced.
  // GM-only por estar dentro deste bloco — clientes de jogador nunca registram.
  registerEquipWatcher();
});
