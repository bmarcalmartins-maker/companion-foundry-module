# Companion Foundry Bridge (module)

Foundry VTT module that connects a running world to the **Companion** app, so NPCs
can be pushed live into the game. It opens a WebSocket to the bridge Worker and
executes `actor.create` / `actor.update` / `actor.delete` commands.

- **Foundry:** v13–v15 (verified v14) · **System:** dnd5e v5 (verified 5.3.3)
- **GM only:** only the GM session connects (single writer, no duplicates).

## Install

In Foundry: **Add-on Modules → Install Module**, paste the manifest URL:

```
https://github.com/bmarcalmartins-maker/companion-foundry-module/releases/latest/download/module.json
```

## Configure

Enable the module in your world, then **Settings → Configure Settings → Companion Foundry Bridge**:

| Setting | Value |
|---|---|
| Bridge URL | `wss://bridge.companion-products.org/ws` (default) |
| API Key | the **same** `BRIDGE_API_KEY` as the Worker secret + Supabase secret |
| Auto-connect | on (connects when the world loads) |

Use **Connection Status** (settings menu) to see the live state, recent logs, and reconnect.

## How it works

```
Companion ──HTTPS──▶ Worker ──▶ Durable Object ──WSS──▶ this module ──▶ Actor.create()
```

Payloads arrive already shaped as dnd5e v5 Actor data (built by the Companion Edge
Function — see the mapping in `baldur-s-gate-companion/docs/FOUNDRY-DND5E-V5-SCHEMA.md`).
Items created by the bridge are tagged with a `companion-foundry-bridge.synced` flag so
that re-sending an NPC replaces only those items and leaves GM-added items intact.

## Files

- `scripts/main.js` — hooks: register settings, connect on ready (GM).
- `scripts/bridge-client.js` — WebSocket client (reconnect, heartbeat, actor handlers).
- `scripts/status-app.js` — connection-status panel (ApplicationV2).
- `scripts/settings.js` — settings + status menu registration.
