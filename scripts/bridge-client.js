import { MODULE_ID } from "./settings.js";
import { listItems, listPacks } from "./compendium.js";

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const HEARTBEAT_MS = 45_000;
const MAX_LOGS = 50;
/** Show a reconnect toast on the 1st attempt of a down cycle, then every Nth. */
const NOTIFY_EVERY_ATTEMPTS = 5;
/** System SRD pack — wins name collisions when resolving `compendium_hint`. */
const SYSTEM_PACK = "dnd5e.items";

/** Normalize a name for exact compendium matching: lowercase, strip accents, spaces→hyphens. */
function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * WebSocket client that connects the Foundry GM session to the bridge Worker.
 *
 * - Authenticates with `?key=` (browsers can't set headers on a WebSocket).
 * - Reconnects with exponential backoff (1s → 30s).
 * - Sends a lightweight heartbeat so idle connections survive proxy timeouts.
 * - Executes `actor.{create,update,delete}` commands and replies, keyed by `request_id`.
 *
 * Payloads arrive already shaped as dnd5e v5 Actor data (built by the Companion
 * Edge Function from the npc/stat_block — see FOUNDRY-DND5E-V5-SCHEMA.md).
 */
export class BridgeClient {
  constructor() {
    this.ws = null;
    /** @type {"disconnected"|"connecting"|"connected"} */
    this.status = "disconnected";
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.logs = [];
    /** @type {Promise<Map<string, {pack: object, id: string}>>|null} lazy slug→entry index */
    this.compendiumIndex = null;
  }

  get bridgeUrl() {
    return game.settings.get(MODULE_ID, "bridgeUrl");
  }

  get apiKey() {
    return game.settings.get(MODULE_ID, "apiKey");
  }

  log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    this.logs.push(line);
    if (this.logs.length > MAX_LOGS) this.logs.shift();
    console.log(`${MODULE_ID} | ${message}`);
  }

  /* -------------------------------------------- */
  /*  Connection lifecycle                        */
  /* -------------------------------------------- */

  connect() {
    if (this.status === "connected" || this.status === "connecting") return;

    const key = this.apiKey;
    if (!key) {
      ui.notifications.warn(game.i18n.localize("CFB.Notify.NoApiKey"));
      this.log("no API key configured — aborting connect");
      return;
    }

    this.intentionalClose = false;
    this.status = "connecting";
    this.log(`connecting to ${this.bridgeUrl}`);

    let socket;
    try {
      socket = new WebSocket(`${this.bridgeUrl}?key=${encodeURIComponent(key)}`);
    } catch (err) {
      this.log(`connect error: ${err?.message ?? err}`);
      this.status = "disconnected";
      this.scheduleReconnect();
      return;
    }

    this.ws = socket;
    socket.addEventListener("open", () => this.#onOpen());
    socket.addEventListener("message", (ev) => this.#onMessage(ev));
    socket.addEventListener("close", (ev) => this.#onClose(ev));
    socket.addEventListener("error", () => this.log("websocket error"));
  }

  disconnect() {
    this.intentionalClose = true;
    this.#clearTimers();
    if (this.ws) {
      try {
        this.ws.close(1000, "client disconnect");
      } catch {
        /* already closing */
      }
    }
    this.ws = null;
    this.status = "disconnected";
    this.log("disconnected (manual)");
  }

  reconnect() {
    this.disconnect();
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.connect();
  }

  scheduleReconnect() {
    if (this.intentionalClose) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.reconnectAttempt, MAX_BACKOFF_MS);
    const seconds = Math.round(delay / 1000);
    // The internal log records every attempt, but the on-screen toast would spam
    // the GM during a long outage — so notify only on the first failure of a down
    // cycle (attempt 0, reset on connect/reconnect) and then every 5th attempt.
    this.log(`reconnecting in ${seconds}s (attempt ${this.reconnectAttempt + 1})`);
    if (this.reconnectAttempt % NOTIFY_EVERY_ATTEMPTS === 0) {
      ui.notifications.warn(game.i18n.format("CFB.Notify.Reconnecting", { seconds }));
    }
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  #onOpen() {
    this.status = "connected";
    this.reconnectAttempt = 0;
    this.log("connected");
    ui.notifications.info(game.i18n.localize("CFB.Notify.Connected"));
    this.#startHeartbeat();
  }

  #onClose(event) {
    this.#clearTimers();
    this.status = "disconnected";
    this.ws = null;
    if (this.intentionalClose) return;
    this.log(`connection closed (code ${event?.code ?? "?"})`);
    ui.notifications.warn(game.i18n.localize("CFB.Notify.Disconnected"));
    this.scheduleReconnect();
  }

  /* -------------------------------------------- */
  /*  Heartbeat / timers                          */
  /* -------------------------------------------- */

  #startHeartbeat() {
    this.#clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send("ping");
        } catch {
          /* will surface via close */
        }
      }
    }, HEARTBEAT_MS);
  }

  #clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  #clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  #clearTimers() {
    this.#clearHeartbeat();
    this.#clearReconnect();
  }

  /* -------------------------------------------- */
  /*  Messaging                                   */
  /* -------------------------------------------- */

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  async #onMessage(event) {
    const raw = event.data;
    if (typeof raw !== "string" || raw === "pong") return;

    let cmd;
    try {
      cmd = JSON.parse(raw);
    } catch {
      return;
    }
    if (cmd?.type === "pong") return;
    if (!cmd?.request_id || !cmd?.action) return;

    await this.#handleCommand(cmd);
  }

  async #handleCommand(cmd) {
    const { request_id, action, actor_id, payload, params } = cmd;
    this.log(`← ${action}${actor_id ? ` (${actor_id})` : ""}`);
    try {
      let result;
      switch (action) {
        case "actor.create":
          result = await this.#createActor(payload);
          break;
        case "actor.update":
          result = await this.#updateActor(actor_id, payload);
          break;
        case "actor.delete":
          result = await this.#deleteActor(actor_id);
          break;
        // LEITURA (FASE 1). Devolvem sob `data` — é o campo que o Durable
        // Object repassa ao Companion; `actor_id` (usado pelos actor.*) não
        // existe aqui e some do JSON sozinho.
        case "compendium.packs":
          result = { data: await listPacks() };
          break;
        case "compendium.items":
          result = { data: await listItems(params ?? {}) };
          break;
        default:
          throw new Error(`unknown action: ${action}`);
      }
      this.send({ request_id, ok: true, ...result });
      this.log(`→ ok ${action}${result?.actor_id ? ` (${result.actor_id})` : ""}`);
    } catch (err) {
      const message = err?.message ?? String(err);
      this.send({ request_id, ok: false, error: message });
      this.log(`→ error ${action}: ${message}`);
      console.error(`${MODULE_ID} |`, err);
    }
  }

  /* -------------------------------------------- */
  /*  Compendium resolution                       */
  /* -------------------------------------------- */

  /**
   * Build (lazily, once per session) a slug → {pack, id} index over every Item
   * compendium. The system SRD pack wins name collisions, other dnd5e packs come
   * next, world/module packs last. Reload (F5) picks up newly installed packs.
   */
  #getCompendiumIndex() {
    this.compendiumIndex ??= this.#buildCompendiumIndex().catch((err) => {
      this.compendiumIndex = null; // allow retry on next sync
      throw err;
    });
    return this.compendiumIndex;
  }

  async #buildCompendiumIndex() {
    const priority = (p) => (p.collection === SYSTEM_PACK ? 0 : p.metadata?.packageName === "dnd5e" ? 1 : 2);
    const packs = game.packs.filter((p) => p.documentName === "Item").sort((a, b) => priority(a) - priority(b));

    const index = new Map();
    for (const pack of packs) {
      try {
        for (const entry of await pack.getIndex()) {
          const slug = slugify(entry.name);
          if (slug && !index.has(slug)) index.set(slug, { pack, id: entry._id });
        }
      } catch (err) {
        this.log(`compendium index failed for ${pack.collection}: ${err?.message ?? err}`);
      }
    }
    this.log(`compendium index built (${index.size} items)`);
    return index;
  }

  /**
   * Resolve a payload item against the compendiums via its `compendium_hint`.
   * Exact slug match only — source_key first, then name (equipping the wrong
   * item is worse than a shell). On a match, returns the full compendium item
   * (system, ActiveEffects, activities) with the Companion's fields on top;
   * returns null to fall back to the payload shell.
   */
  async #resolveFromCompendium(item) {
    const hint = item?.flags?.[MODULE_ID]?.compendium_hint;
    if (!hint) return null;

    const index = await this.#getCompendiumIndex();
    const match =
      (hint.source_key ? index.get(slugify(hint.source_key)) : null) ??
      (hint.name ? index.get(slugify(hint.name)) : null);
    if (!match) return null;

    const doc = await match.pack.getDocument(match.id);
    if (!doc) return null;

    const data = doc.toObject();
    delete data._id;

    // Companion fields win over the compendium copy:
    if (item.name) data.name = item.name; // display name (may be PT)
    if (item.system?.quantity !== undefined && "quantity" in (data.system ?? {})) {
      data.system.quantity = item.system.quantity;
    }
    if (item.system?.equipped !== undefined && "equipped" in (data.system ?? {})) {
      data.system.equipped = item.system.equipped;
    }
    // Keep compendium art unless the Companion sent a non-placeholder image of its own.
    if (item.img && !item.img.startsWith("icons/svg/")) data.img = item.img;
    // Payload flags merge on top — item_id/synced markers drive idempotent re-sync.
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, item.flags ?? {}, { inplace: false });

    return data;
  }

  /**
   * Resolve compendium hints (when present) then tag everything as bridge-managed.
   * Any miss or error falls back to the payload shell for that item — nothing breaks.
   */
  async #prepareItems(items) {
    if (!Array.isArray(items)) return items;
    const prepared = [];
    for (const item of items) {
      let resolved = null;
      const hint = item?.flags?.[MODULE_ID]?.compendium_hint;
      if (hint) {
        try {
          resolved = await this.#resolveFromCompendium(item);
        } catch (err) {
          console.error(`${MODULE_ID} | compendium resolve failed for "${item?.name}"`, err);
        }
        console.log(
          `${MODULE_ID} | item "${item?.name}" hint=${hint.source_key ?? slugify(hint.name)} → ${resolved ? "matched" : "fallback"}`
        );
      }
      prepared.push(resolved ?? item);
    }
    return this.#tagItems(prepared);
  }

  /* -------------------------------------------- */
  /*  Actor handlers                              */
  /* -------------------------------------------- */

  /**
   * Tag embedded items as bridge-managed so re-sync can replace only our items.
   * Também consolida o crachá do Companion no escopo VÁLIDO do módulo:
   * flags[MODULE_ID].item_id (a doc do Foundry exige escopo de módulo
   * instalado; "companion" não é). Payloads novos já trazem os dois escopos;
   * payloads antigos só trazem flags.companion — copiamos pro escopo válido
   * pra leitura via getFlag nunca depender do escopo inválido.
   */
  #tagItems(items) {
    if (!Array.isArray(items)) return items;
    return items.map((item) => {
      const badge = item?.flags?.[MODULE_ID]?.item_id ?? item?.flags?.companion?.item_id ?? null;
      return foundry.utils.mergeObject(
        item,
        { flags: { [MODULE_ID]: { synced: true, item_id: badge } } },
        { inplace: false }
      );
    });
  }

  // TOKEN DE ORIGEM (anti-eco): toda operação de documento disparada pelo
  // bridge carrega { companionBridge: true } nas options. Os hooks da mão de
  // volta (equip-sync.js) IGNORAM operações com essa marca — mudança que veio
  // DO Companion nunca é reenviada PRO Companion.
  async #createActor(payload) {
    if (!payload || typeof payload !== "object") throw new Error("missing actor payload");
    const data = foundry.utils.deepClone(payload);
    if (Array.isArray(data.items)) data.items = await this.#prepareItems(data.items);
    const actor = await Actor.implementation.create(data, { keepId: false, companionBridge: true });
    if (!actor) throw new Error("actor creation returned no document");
    return { actor_id: actor.id };
  }

  async #updateActor(actorId, payload) {
    if (!actorId) throw new Error("missing actor_id");
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(`actor not found: ${actorId}`);

    const { items, ...actorData } = payload ?? {};
    if (Object.keys(actorData).length) await actor.update(actorData, { companionBridge: true });

    if (Array.isArray(items)) {
      /*
       * ITEM NATIVO DO FOUNDRY QUE JÁ TEM CRACHÁ = o MESMO item da linha do
       * Companion, não um item a mais.
       *
       * Ele chegou aqui pelo caminho de volta (equip-sync `item.upsert`), e o
       * Companion guardou uma linha para ele. Como NÃO é `synced`, o passo de
       * baixo não o apaga — e sem esta distinção o payload criaria uma CÓPIA
       * ao lado do original, toda vez. Com o push virando automático (gatilho
       * no banco), isso passaria a acontecer a cada mudança de inventário.
       *
       * Nele a gente ATUALIZA NO LUGAR, e só o que o Companion manda: se está
       * equipado e quantas unidades. Nome, arte, efeitos e activities são do
       * item de verdade do Foundry — que é justamente o que faz o dnd5e
       * aplicar CA e bônus ao equipar. Substituir seria trocar o item bom pela
       * casca.
       */
      const nativosPorCracha = new Map();
      for (const existente of actor.items) {
        if (existente.getFlag(MODULE_ID, "synced")) continue;
        const cracha =
          existente.getFlag(MODULE_ID, "item_id") ?? existente.flags?.companion?.item_id ?? null;
        if (cracha) nativosPorCracha.set(cracha, existente);
      }

      const paraCriar = [];
      const paraAtualizar = [];
      for (const item of items) {
        const cracha = item?.flags?.[MODULE_ID]?.item_id ?? item?.flags?.companion?.item_id ?? null;
        const nativo = cracha ? nativosPorCracha.get(cracha) : null;
        if (!nativo) {
          paraCriar.push(item);
          continue;
        }
        const mudanca = { _id: nativo.id };
        if (item?.system?.equipped !== undefined && "equipped" in (nativo.system ?? {})) {
          mudanca["system.equipped"] = item.system.equipped;
        }
        if (item?.system?.quantity !== undefined && "quantity" in (nativo.system ?? {})) {
          mudanca["system.quantity"] = item.system.quantity;
        }
        // Só vale a viagem se houver algo além do _id.
        if (Object.keys(mudanca).length > 1) paraAtualizar.push(mudanca);
      }

      // Troca só o que ESTE módulo criou; o que o GM pôs à mão fica de pé.
      const syncedIds = actor.items.filter((i) => i.getFlag(MODULE_ID, "synced")).map((i) => i.id);
      if (syncedIds.length) await actor.deleteEmbeddedDocuments("Item", syncedIds, { companionBridge: true });
      if (paraAtualizar.length) {
        await actor.updateEmbeddedDocuments("Item", paraAtualizar, { companionBridge: true });
      }
      if (paraCriar.length) {
        await actor.createEmbeddedDocuments("Item", await this.#prepareItems(paraCriar), { companionBridge: true });
      }
      this.log(
        `inventário: ${paraCriar.length} criado(s), ${paraAtualizar.length} nativo(s) atualizado(s) no lugar, ${syncedIds.length} substituído(s)`
      );
    }
    return { actor_id: actor.id };
  }

  async #deleteActor(actorId) {
    if (!actorId) throw new Error("missing actor_id");
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(`actor not found: ${actorId}`);
    await actor.delete({ companionBridge: true });
    return { actor_id: actorId };
  }
}
