import { MODULE_ID, migrarChavesParaONavegador, registerSettings } from "./settings.js";
import { BridgeClient } from "./bridge-client.js";
import { registerEquipWatcher, syncActorInventory, resetActorLink } from "./equip-sync.js";
import { listItems, listPacks } from "./compendium.js";
import { registerLiveSync } from "./live-sync.js";
import { registerMoedasSync } from "./moedas-sync.js";
import { registerCombateSync } from "./combate-sync.js";
import { registerMagiaFalada } from "./magia-falada.js";
import { registerMusica } from "./trilhas-foundry.js";
import { registrarRegrasDeCura } from "./efeitos-dnd5e.js";
import { auditar } from "./auditoria-foundry.js";
import { agendarCanonico, aplicarCanonico, desfazerCanonico } from "./canonico-foundry.js";

Hooks.once("init", () => {
  registerSettings();
  // v1.14.0: bônus de cura do D&D Beyond (Disciple of Life) como fórmula e
  // com a regra canônica na rolagem, em TODO navegador, antes de qualquer
  // ficha ser preparada (efeitos-dnd5e.js). O init do dnd5e roda antes deste
  // (o sistema carrega antes dos módulos) e já trocou
  // CONFIG.ActiveEffect.documentClass por ActiveEffect5e (dnd5e.mjs:73).
  registrarRegrasDeCura(CONFIG.ActiveEffect?.documentClass ?? globalThis.dnd5e?.documents?.ActiveEffect5e, Hooks);
  // v1.12.0: a magia falada. Em TODO navegador (o do jogador também): é o
  // handler da pergunta que o GM manda ao dono do ator (magia-falada.js).
  registerMagiaFalada();
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
    // v1.15.0: a AUDITORIA Foundry × canônico (só leitura; auditoria-foundry.js):
    //   const r = await game.modules.get("companion-foundry-bridge").api.auditar({ baixar: true });
    auditar: (opcoes) => auditar(opcoes ?? {}),
    // v1.16.0: as correções canônicas (canonico-foundry.js). Rodam sozinhas no
    // ready do GM ativo; à mão: aplicarCanonico({ simular: true }) diz o que faria.
    aplicarCanonico: (opcoes) => aplicarCanonico(opcoes ?? {}),
    desfazerCanonico: () => desfazerCanonico(),
  };

  // Só o GM ATIVO conecta. Com dois GMs (ou duas janelas), cada um abria o
  // seu socket; a ponte agora fica só com o mais novo e fecha o outro.
  if (game.settings.get(MODULE_ID, "autoConnect") && souOGmAtivo()) client.connect();
  // v1.16.0 (Bruno, 27/10: "já aplica tudo"): o GM ativo deixa as habilidades
  // decididas iguais ao oficial e completa as escalas que faltam. Idempotente;
  // o "antes" fica na flag do item (api.desfazerCanonico()).
  if (souOGmAtivo()) {
    aplicarCanonico().catch((err) => console.error(`${MODULE_ID} | correções canônicas falharam`, err));
  }
  // v1.17.0: item ou efeito novo num personagem (importação do D&D Beyond,
  // loja, Companion) passa pelas mesmas correções, em lote (agendarCanonico).
  const emPersonagem = (doc) => {
    const ator = doc?.parent instanceof Actor ? doc.parent : doc?.parent?.parent;
    return ator instanceof Actor && ["character", "npc"].includes(ator.type);
  };
  Hooks.on("createItem", (item) => { if (souOGmAtivo() && emPersonagem(item)) agendarCanonico(); });
  Hooks.on("createActiveEffect", (ef) => { if (souOGmAtivo() && emPersonagem(ef)) agendarCanonico(); });
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
  // v1.9.0: as moedas, nos dois sentidos (moedas-sync.js).
  registerMoedasSync();
  // v1.11.0: os acertos e o dano, para o relatório do fim da sessão (combate-sync.js).
  registerCombateSync();
  // v1.19.0: a música do Companion (trilhas-foundry.js): o que muda na
  // playlist "Companion — Trilhas" e o que toca ao abrir vão ao Companion.
  registerMusica();
});
