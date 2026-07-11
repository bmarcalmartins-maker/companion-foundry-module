import { MODULE_ID } from "./settings.js";

/**
 * PASSO 1 (bidirecional Foundry→Companion) — detector de equipar/desequipar.
 *
 * Escuta o hook `updateItem` do Foundry: togglar equip na ficha dnd5e faz um
 * `item.update({"system.equipped": ...})` no item embutido, que dispara este
 * hook em todos os clientes com o diff em `changes.system.equipped`.
 * [HIPÓTESE só-teste: confirmar no console que o toggle da ficha chega aqui
 * com `changes.system.equipped` booleano.]
 *
 * Filtros (todos precisam passar):
 *  1. `changes.system.equipped` é boolean — ignora qualquer outro update de item.
 *  2. O item pertence a um Actor (item embutido, não item de mundo).
 *  3. O item carrega `flags.companion.item_id` — o "crachá" que o Companion
 *     grava ao sincronizar (mapping.ts, buildLootItem). Item sem crachá não é
 *     do Companion e é ignorado. Leitura por acesso direto ao objeto flags —
 *     NÃO usar `getFlag("companion", ...)`: o escopo "companion" não é um
 *     módulo instalado e o getFlag valida escopos.
 *  4. Só o GM "ativo" processa (evita POST duplicado se dois GMs estiverem
 *     logados; o hook dispara em todo cliente, mas só clientes GM registram
 *     este watcher — ver main.js).
 *
 * A validação de que o actor é um PC vinculado fica no servidor: a edge
 * function foundry-inbound confere `foundry_actor_id` e responde 404 pra
 * actor desconhecido. O módulo não tem (nem precisa ter) essa lista.
 */
export function registerEquipWatcher() {
  Hooks.on("updateItem", (item, changes, _options, _userId) => {
    const equipped = changes?.system?.equipped;
    if (typeof equipped !== "boolean") return;

    const actor = item?.parent;
    if (!(actor instanceof Actor)) return;

    const companionItemId = item?.flags?.companion?.item_id;
    if (typeof companionItemId !== "string" || !companionItemId) return;

    // Dois GMs logados → dois watchers; só o activeGM reporta. Se o Foundry
    // não expõe activeGM (undefined), segue — este cliente é GM (main.js).
    if (game.users.activeGM && game.users.activeGM.id !== game.user.id) return;

    // PASSO 1: só detecta e loga. O POST pra foundry-inbound entra no PASSO 2.
    console.log(
      `${MODULE_ID} | equip detectado: actor=${actor.id} item=${companionItemId} equipped=${equipped}`
    );
  });
  console.log(`${MODULE_ID} | equip watcher registrado`);
}
