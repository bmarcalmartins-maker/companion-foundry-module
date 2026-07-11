# Equip Sync — Foundry → Companion (ponte bidirecional, lado Foundry)

**Sessão:** 2026-07-11 · **Branch:** `claude/companion-foundry-bridge-6kstk8`
**Decisão do Bruno:** **Caminho B** — o módulo chama a edge function
`foundry-inbound` do Companion **direto por HTTP** quando detecta
equipar/desequipar dentro do Foundry. **Worker (`companion-foundry-bridge`)
fica intocado.**

Convenção deste doc: **FATO** = verificado por leitura de código/saída de
comando (com `arquivo:linha`). **HIPÓTESE** = inferência que só o teste ao
vivo no Foundry confirma (nenhum Foundry rodou nesta sessão).

---

## 1. O que o Companion já tem pronto (lado de lá, no ar)

- Edge function **`foundry-inbound`** (repo `baldur-s-gate-companion`,
  `supabase/functions/foundry-inbound/index.ts`):
  - Recebe `POST {actor_id, item_id, equipped}` — whitelist estrita, qualquer
    outro campo é descartado (`index.ts:69-74`). FATO.
  - Auth: header `x-foundry-inbound-key` === secret `FOUNDRY_INBOUND_KEY`
    (`index.ts:57`). Sem o secret configurado responde **503** (inerte por
    design, `index.ts:53`). FATO.
  - Valida `actor_id` contra `player_characters.foundry_actor_id`; actor não
    vinculado → **404** (`index.ts:84-89`). FATO.
  - Único write: `character_items.equipped` daquele PC+item (`index.ts:93-98`).
    Item fora do inventário → **404**. FATO.
  - Rate-limit best-effort 20 hits/10s por actor → **429** (`index.ts:33-42`).
    FATO.
  - **CORS aberto pro browser**: `Access-Control-Allow-Origin: *`, header
    `x-foundry-inbound-key` permitido, OPTIONS tratado (`index.ts:25-28,45`).
    FATO — é o que viabiliza o Caminho B (fetch direto do browser do Foundry).
  - Deployada com **`verify_jwt: false`** (única função assim — verificado via
    API de management do Supabase). FATO — o módulo NÃO precisa de JWT/anon
    key, só do header secreto.
  - URL: `https://leziqtoarclocroaqwsp.supabase.co/functions/v1/foundry-inbound`
    (vai em setting do módulo, não hardcoded).
- **Crachá do item**: o Companion envia cada item com
  `flags.companion.item_id` (repo principal,
  `push-to-foundry/mapping.ts:346`). FATO.

## 2. Recon do módulo (companion-foundry-module)

- Hooks existentes: só `Hooks.once("init")` (`main.js:4`) e
  `Hooks.once("ready")` (`main.js:9`), com guarda GM-only em `main.js:12`.
  FATO.
- `#tagItems` usa `mergeObject(..., {inplace:false})` com merge default —
  **preserva** `flags.companion` vindo no payload e só adiciona
  `flags["companion-foundry-bridge"].synced` (`bridge-client.js:233-238`).
  FATO. *(Corrige o comentário antigo em `mapping.ts:342-343` que supunha o
  contrário.)*
- Sync de itens vindo do Companion é **delete + create** — nunca update de
  item (`bridge-client.js:259-261`). FATO. (Central pra análise do eco, §5.)
- `send()` do WS descarta silenciosamente se desconectado
  (`bridge-client.js:179`) — irrelevante pro Caminho B (HTTP direto), mas
  registrado.
- Settings hoje: `game.settings.register` world-scoped, `config: true`
  (`settings.js:11-36`) — `bridgeUrl`, `apiKey`, `autoConnect` + menu de
  status. O apiKey já vive como setting world (mesmo trade-off de
  visibilidade vale pras settings novas do passo 2).

## 3. Achado crítico (bloqueia o teste ponta-a-ponta — decisão pendente, lado Companion)

**FATO (source do dnd5e 5.3.3 lido no GitHub):** item `type: "loot"` NÃO tem
`system.equipped` — `LootData` não inclui o `EquippableItemTemplate`
(`module/data/item/loot.mjs`). `EquipmentData` inclui (`equipment.mjs`).
E todo item de inventário de PC viaja como `type: "loot"`
(`mapping.ts:332,359-365`). FATO.

**Consequência:** hoje não existe toggle de equipar nesses itens no Foundry —
o hook nunca dispararia. Pendência **no lado Companion** (fora deste repo):

- **Opção A (mínima):** `buildPcInventoryPayload` muda o type pra
  `"equipment"` só no inventário de PC + passa a mandar `system.equipped`
  a partir de `character_items.equipped` (isso também corrige o eco residual
  do §5.4).
- **Opção B:** mapear `items.type` (coluna text livre) → tipo dnd5e.

## 4. Plano em 3 passos (este repo) — DIFF gate por passo

| Passo | O quê | Estado |
|---|---|---|
| **1** | Hook `updateItem` detecta equip/desequip de item com crachá do Companion — só detecta e **loga** | ✅ commit `58d5eb2` |
| **2** | Settings `inboundUrl` + `inboundKey` (padrão de `settings.js`) + POST pra `foundry-inbound` com o header secreto | ⏳ aguardando OK |
| **3** | Trava do loop de eco (token de origem nas operações do bridge + doc da lógica) | ⏳ aguardando OK |

## 5. Loop de eco — por que NÃO vira ping-pong

1. **FATO:** equipar VIA Companion chega no Foundry como **delete + create**
   dos itens synced (`bridge-client.js:259-261`) — dispara hooks
   `deleteItem`/`createItem`, **não** `updateItem`. O watcher (só
   `updateItem`) não é acionado pelo sync do Companion. *(Depende da
   HIPÓTESE H1 abaixo valer.)*
2. **FATO:** não existe push automático Companion→Foundry em mudança de
   `character_items` — `push-to-foundry` de inventário só roda por clique
   manual (`JogadoresTab.tsx:516-529`). O write que a `foundry-inbound` faz
   no banco não gera push de volta.
3. **Passo 3 (defesa em profundidade):** token de origem
   (`options.companionBridge`) nas operações de documento do bridge, ignorado
   pelo watcher — protege contra mudanças futuras (update fino de item,
   auto-push no Companion). Mesmo no pior cenário futuro o ciclo converge em
   1 volta (delete+create não re-dispara `updateItem`), e o rate-limit da
   edge segura flood.
4. **Eco residual documentado (não é loop, é sobrescrita):** GM equipa no
   Foundry → DB atualiza → um re-sync manual futuro recria os itens SEM
   `system.equipped` (o payload não manda esse campo — FATO, zero ocorrências
   em `mapping.ts`) → desfaz visualmente o equip no Foundry. Correção junto
   com a Opção A do §3.

## 6. PASSO 1 — o que foi mexido (commit `58d5eb2`)

- **Novo `scripts/equip-sync.js`** — `registerEquipWatcher()`:
  `Hooks.on("updateItem", (item, changes, options, userId))` com filtro
  quádruplo, early-return em cada um:
  1. `changes?.system?.equipped` é boolean (ignora qualquer outro update);
  2. `item.parent instanceof Actor` (só item embutido);
  3. `item.flags?.companion?.item_id` presente e string — **acesso direto de
     propósito**: `getFlag("companion", ...)` valida escopo contra módulos
     instalados e `"companion"` não é um (HIPÓTESE de framework que o getFlag
     lançaria; o acesso direto é seguro nos dois cenários);
  4. se `game.users.activeGM` existir e não for este cliente, ignora (dois
     GMs logados → um só reporta).
  Passando tudo: `console.log("... | equip detectado: actor=... item=...
  equipped=...")`. Sem HTTP neste passo.
- **`main.js`** — import + `registerEquipWatcher()` no fim do bloco GM do
  `ready` (`main.js:12` barra jogadores antes). Nada do fluxo atual muda.

## 7. HIPÓTESES que SÓ o teste ao vivo confirma

| # | Hipótese | Sintoma se falhar | Como inspecionar |
|---|---|---|---|
| H1 | Toggle de equip na ficha dnd5e dispara `updateItem` com `changes.system.equipped` boolean | Nenhum `equip detectado` no console ao equipar | `Hooks.on("updateItem", console.log)` no console e togglar |
| H2 | `flags.companion.item_id` sobrevive à persistência (core não descarta escopo desconhecido) | Idem — filtro 3 barra tudo | `game.actors.get(ID).items.contents.map(i=>i.flags)` no console |
| H3 | `game.users.activeGM` existe no Foundry v13/14 | Nenhum (código defensivo: `undefined` → segue) | `game.users.activeGM` no console |
| H4 | (§3) itens `loot` não têm toggle de equipar na ficha | Não tem O QUE equipar → feature parada até decisão A/B | Abrir a ficha e procurar o ícone de equipar num item synced |

## 8. Roteiro de teste do PASSO 1

1. Carregar o mundo como GM → console deve ter
   `companion-foundry-bridge | equip watcher registrado`.
2. Equipar/desequipar um item **synced** (com crachá) numa ficha → console
   deve logar `equip detectado: actor=<id> item=<uuid> equipped=<bool>`.
3. Se não logar, seguir H1→H2→H4 da tabela acima, nessa ordem.

## 9. Pendências fora deste repo (pro go-live)

- [ ] Decisão Opção A/B do §3 (lado Companion — sem ela não há o que equipar).
- [ ] Criar o secret `FOUNDRY_INBOUND_KEY` no Supabase (destranca o 503).
- [ ] Configurar URL + key nas settings do módulo (passo 2) no mundo do Bruno.
