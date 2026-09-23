import { MODULE_ID, migrarChavesParaONavegador, registerSettings } from "./settings.js";
import { BridgeClient } from "./bridge-client.js";
import { registerEquipWatcher, syncActorInventory, resetActorLink } from "./equip-sync.js";
import { listItems, listPacks } from "./compendium.js";
import { registerLiveSync } from "./live-sync.js";

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | initialized`);
});

/** Este navegador é o do GM ATIVO (o único que conecta e reporta)? */
function souOGmAtivo() {
  return !!game.user?.isGM && game.users.activeGM?.id === game.user.id;
}

Hooks.once("ready", async () => {
  // Only the GM holds the bridge connection — it's the only client allowed to
  // create world actors, and a single connection avoids duplicate writes.
  if (!game.user.isGM) return;

  // v1.7.2: as chaves saem do mundo (todo jogador as recebia) ANTES de
  // qualquer conexão usar a deste navegador.
  try {
    await migrarChavesParaONavegador();
  } catch (err) {
    console.error(`${MODULE_ID} | falha ao migrar as chaves para este navegador`, err);
  }

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

  // Só o GM ATIVO conecta. Com dois GMs (ou duas janelas), cada um abria o
  // seu socket; a ponte agora fica só com o mais novo e fecha o outro.
  if (game.settings.get(MODULE_ID, "autoConnect") && souOGmAtivo()) client.connect();
  // O GM ativo muda quando um GM entra ou sai: quem virou ativo conecta, quem
  // deixou de ser desconecta.
  Hooks.on("userConnected", () => {
    if (!game.settings.get(MODULE_ID, "autoConnect")) return;
    if (souOGmAtivo()) {
      if (client.status === "disconnected") client.connect();
    } else if (client.status !== "disconnected") {
      client.disconnect();
    }
  });

  // Foundry→Companion (bidirecional): observa equip/desequip de itens synced.
  // GM-only por estar dentro deste bloco — clientes de jogador nunca registram.
  registerEquipWatcher();
  // IMPL-47 v1.7.0: a ficha e os efeitos vão ao Companion quando mudam AQUI.
  registerLiveSync();
});
