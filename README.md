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

### Inventário de PC — desde a 1.8.0 (LOTE 08 do Raio-X, 30/09)

Decisões do Bruno (29/09): **sintonia B, quantidade/usos B, itens nativos A**.

- **Um comando por ator de cada vez** (`scripts/fila-por-ator.js`). O Companion
  também manda um envio por PC de cada vez; aqui é a mesma regra para o que
  chegar junto.
- **Atualiza no lugar, não recria** (`scripts/plano-inventario.js`). Até a 1.7
  as cópias do módulo eram apagadas e recriadas a cada envio: a sintonia feita
  no Foundry, as cargas e os usos sumiam. Agora só muda o que o Companion manda:
  equipado; na cópia, nome e imagem.
- **Quantidade é do Foundry depois de criado o item.** O Companion manda o que
  ELE mudou (consumir, trocar, o Mestre editar) como diferença acumulada
  (`ajuste_total`); o item guarda o que já aplicou (`ajuste_aplicado`).
- **Nativo com crachá só sai do ator quando o Companion diz que ele SAIU do
  personagem** (descartado, trocado — `flags.companion-foundry-bridge.saidas`
  no envio). Crachá velho fora do envio não apaga nada; arma natural, magia e
  talento nunca saem.
- **A volta ganha estado e exclusão.** Equipar, quantidade e sintonia mudados
  aqui vão num `item.estado` agrupado; item apagado aqui vai num `item.delete`
  (e não é recriado por um envio que ainda o trazia). Item novo com crachá de
  outro personagem (arrastado, duplicado) perde o crachá e entra como novo.
- **O item exato do compêndio**: a pista traz o `uuid` do item escolhido no
  espelho; o módulo resolve por ele antes do nome (`scripts/casar-compendio.js`).

## Testes

`npm test` (Node 22, sem instalar nada): as regras puras e um Foundry falso
para a cola com o WebSocket e os ganchos. Não prova o Foundry de verdade — isso
é o roteiro de teste com o Foundry aberto.

## Files

- `scripts/main.js` — hooks: register settings, connect on ready (GM).
- `scripts/bridge-client.js` — WebSocket client (reconnect, heartbeat, actor handlers).
- `scripts/status-app.js` — connection-status panel (ApplicationV2).
- `scripts/settings.js` — settings + status menu registration.
- `scripts/equip-sync.js` — the way back to the Companion (estado, exclusão, item novo).
- `scripts/plano-inventario.js`, `scripts/fila-por-ator.js`, `scripts/casar-compendio.js` — pure rules, tested in `test/`.
