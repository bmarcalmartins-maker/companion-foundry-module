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

### Ouro — desde a 1.9.0 (frente OURO, 01/10)

- As cinco moedas do dnd5e (`system.currency`) são as mesmas no Companion, nos
  dois sentidos (`scripts/moedas-sync.js`, regras em `scripts/moedas.js`).
- **O Foundry vence** no primeiro contato e quando mudou as moedas depois do
  último acordo (flag `moedas_sync`); envio velho do Companion é ignorado.
- A ficha (`actor.read`, schema 2) leva também as moedas e o inventário
  inteiro, para a conferência Companion × Foundry.
- Detalhe: `docs/EQUIP-SYNC-FOUNDRY-COMPANION.md` §6.8.

### Raridade do item novo — desde a 1.10.0 (12/10)

- O item que nasce aqui (criado no ator, arrastado do compêndio) vai ao
  Companion com a raridade (`system.rarity`, no `item.upsert`). Até a 1.9.0
  chegava sem ela, e o boneco do inventário do jogador não acendia a moldura
  de item mágico até o Mestre marcar a raridade à mão.
- A edge `foundry-inbound` passa para o formato do Companion ("veryRare" →
  "Very Rare") e só aceita as seis do dnd5e; item sem raridade não apaga a que
  o Companion tem.

### Acertos e dano — desde a 1.11.0 (20/10)

- Para o relatório do fim da sessão do Companion, o GM ativo manda de cada
  personagem (`scripts/combate-sync.js`, regras em `scripts/combate.js`):
  - o **ataque** (a mensagem de rolagem de ataque do dnd5e): crítico e falha
    sempre; o acerto só com UM alvo marcado, porque o dnd5e põe a CA na
    rolagem só nesse caso;
  - o **dano rolado** e a **cura rolada** (as mensagens de dano e de cura);
  - o **dano tomado** (o gancho `dnd5e.damageActor`: PV perdidos, menos
    descanso e avanço).
- Vai na op `combate.evento` da `foundry-inbound`, agrupado por 2 s (até 50 por
  pedido), com um id por evento: o reenvio não duplica. Sem sessão em
  andamento no Companion, nada é gravado.
- Liga e desliga: "Acertos e dano ao Companion" (configuração do mundo).

### Magia falada — desde a 1.12.0 (20/10)

- O jogador diz a magia na mesa. O Companion acha o nome entre as magias do
  ator DELE e pede, pela ponte, a op `magia.pedir`. O nome do item vale, e
  também os apelidos que o jogador grava no app ("como você fala").
- **Quem recebe:**
  - o **GM ativo** passa o pedido ao navegador do **jogador** dono do ator
    (`User#query`, a pergunta `companion-foundry-bridge.lancarMagia`) e
    responde na hora, sem esperar o toque;
  - no **navegador do jogador**, se há combate, abre "Lançar X em <os alvos
    que ele marcou>?". Só com o **"Lançar"** a magia é usada (`item.use()`), e
    o diálogo do dnd5e abre quando há espaço ou escolha a fazer.
- **Nunca lança sem o toque.** Um truque simples, no dnd5e 5.3.3, não abre
  diálogo nenhum (`activity/mixin.mjs:225`, `:660-667`), por isso a pergunta é
  do módulo. O Enter responde "Agora não".
- **O resultado volta ao Companion** (`op: "magia.resultado"`): lançou,
  recusou, sem combate, sem resposta.
- O `actor.snapshot` leva as magias do ator: id, nome, nível, método e
  preparação.
- Liga e desliga: cada jogador, no app do Companion. É o único código deste
  módulo que roda no navegador do jogador: o handler da pergunta, registrado no
  `init` (`scripts/magia-falada.js`; regras em `scripts/magias.js`).

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
- `scripts/moedas-sync.js` — the currency both ways (v1.9.0).
- `scripts/combate-sync.js` — hits and damage to the Companion's end-of-session report (v1.11.0).
- `scripts/magia-falada.js` — the spoken spell: the player-side query handler and the GM relay (v1.12.0).
- `scripts/plano-inventario.js`, `scripts/fila-por-ator.js`, `scripts/casar-compendio.js`, `scripts/moedas.js`, `scripts/combate.js`, `scripts/magias.js` — pure rules, tested in `test/`.
