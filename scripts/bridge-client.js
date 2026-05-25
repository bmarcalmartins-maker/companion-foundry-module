import { MODULE_ID } from "./settings.js";

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const HEARTBEAT_MS = 45_000;
const MAX_LOGS = 50;

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
    this.reconnectAttempt += 1;
    const seconds = Math.round(delay / 1000);
    this.log(`reconnecting in ${seconds}s`);
    ui.notifications.warn(game.i18n.format("CFB.Notify.Reconnecting", { seconds }));
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
    const { request_id, action, actor_id, payload } = cmd;
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
  /*  Actor handlers                              */
  /* -------------------------------------------- */

  /** Tag embedded items as bridge-managed so re-sync can replace only our items. */
  #tagItems(items) {
    if (!Array.isArray(items)) return items;
    return items.map((item) =>
      foundry.utils.mergeObject(item, { flags: { [MODULE_ID]: { synced: true } } }, { inplace: false })
    );
  }

  async #createActor(payload) {
    if (!payload || typeof payload !== "object") throw new Error("missing actor payload");
    const data = foundry.utils.deepClone(payload);
    if (Array.isArray(data.items)) data.items = this.#tagItems(data.items);
    const actor = await Actor.implementation.create(data, { keepId: false });
    if (!actor) throw new Error("actor creation returned no document");
    return { actor_id: actor.id };
  }

  async #updateActor(actorId, payload) {
    if (!actorId) throw new Error("missing actor_id");
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(`actor not found: ${actorId}`);

    const { items, ...actorData } = payload ?? {};
    if (Object.keys(actorData).length) await actor.update(actorData);

    // Replace only previously bridge-synced items; leave GM-added items untouched.
    if (Array.isArray(items)) {
      const syncedIds = actor.items.filter((i) => i.getFlag(MODULE_ID, "synced")).map((i) => i.id);
      if (syncedIds.length) await actor.deleteEmbeddedDocuments("Item", syncedIds);
      await actor.createEmbeddedDocuments("Item", this.#tagItems(items));
    }
    return { actor_id: actor.id };
  }

  async #deleteActor(actorId) {
    if (!actorId) throw new Error("missing actor_id");
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(`actor not found: ${actorId}`);
    await actor.delete();
    return { actor_id: actorId };
  }
}
