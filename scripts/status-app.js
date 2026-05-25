import { MODULE_ID } from "./settings.js";

const { ApplicationV2 } = foundry.applications.api;

/** Minimal HTML escape for log/URL strings shown in the status panel. */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const api = () => game.modules.get(MODULE_ID)?.api;

/**
 * Connection-status panel: shows state + recent logs, with reconnect/disconnect
 * buttons. Opened from the module settings menu (GM only).
 */
export class BridgeStatusApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "companion-foundry-bridge-status",
    classes: ["companion-foundry-bridge", "cfb-status-app"],
    tag: "div",
    window: { title: "CFB.Status.Title", icon: "fas fa-plug", resizable: true },
    position: { width: 540, height: "auto" },
    actions: {
      reconnect: function () {
        api()?.reconnect();
        this.render();
      },
      disconnect: function () {
        api()?.disconnect();
        this.render();
      },
      refresh: function () {
        this.render();
      },
    },
  };

  async _renderHTML() {
    const status = api()?.getStatus?.() ?? "disconnected";
    const url = game.settings.get(MODULE_ID, "bridgeUrl");
    const logs = (api()?.client?.logs ?? []).slice().reverse();
    const logItems = logs.length
      ? logs.map((l) => `<li>${esc(l)}</li>`).join("")
      : `<li class="cfb-muted">${game.i18n.localize("CFB.Status.NoLogs")}</li>`;

    const div = document.createElement("div");
    div.classList.add("cfb-status");
    div.innerHTML = `
      <p class="cfb-line">
        <strong>${game.i18n.localize("CFB.Status.Connection")}:</strong>
        <span class="cfb-badge cfb-${esc(status)}">${esc(status)}</span>
      </p>
      <p class="cfb-line"><strong>URL:</strong> <code>${esc(url)}</code></p>
      <div class="cfb-buttons">
        <button type="button" data-action="reconnect"><i class="fas fa-rotate"></i> ${game.i18n.localize("CFB.Status.Reconnect")}</button>
        <button type="button" data-action="disconnect"><i class="fas fa-plug-circle-xmark"></i> ${game.i18n.localize("CFB.Status.Disconnect")}</button>
        <button type="button" data-action="refresh"><i class="fas fa-arrows-rotate"></i> ${game.i18n.localize("CFB.Status.Refresh")}</button>
      </div>
      <hr>
      <p class="cfb-line"><strong>${game.i18n.localize("CFB.Status.Logs")}</strong></p>
      <ul class="cfb-logs">${logItems}</ul>`;
    return div;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }
}
