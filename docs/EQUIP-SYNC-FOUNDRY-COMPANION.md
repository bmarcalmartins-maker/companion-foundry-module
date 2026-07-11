# Ponte Bidirecional Companion ↔ Foundry — documento mestre

**Sessões:** 2026-07-11 · **Branches:** `claude/companion-foundry-bridge-6kstk8`
(nos repos `baldur-s-gate-companion` e `companion-foundry-module`; o Worker
`companion-foundry-bridge` **não foi tocado** — decisão: o módulo chama a edge
direto por HTTP).

Convenção: **FATO** = verificado por leitura de código/SELECT/saída de comando.
**HIPÓTESE** = só o teste ao vivo no Foundry confirma (nenhum Foundry rodou
nas sessões de implementação).

---

## 1. Arquitetura final

```
COMPANION → FOUNDRY (já existia, melhorada na Fase B1)
  botão no Companion → edge push-to-foundry → Worker (WS) → módulo
  → delete+create dos itens synced no actor

FOUNDRY → COMPANION (novo, Fases B2+B3)
  hook no módulo (updateItem/createItem) → POST HTTP direto →
  edge foundry-inbound (x-foundry-inbound-key) → items/character_items
```

O crachá que liga os dois mundos: `flags["companion-foundry-bridge"].item_id`
= `items.id` do Companion (escopo VÁLIDO de flag — id do módulo instalado;
o legado `flags.companion.item_id` continua viajando por compatibilidade e é
lido só por acesso direto ao objeto, nunca `getFlag("companion", ...)`).

## 2. O que mudou em cada repo (por commit)

### `baldur-s-gate-companion`

**Fase B1 — `6a525f5` — tipos corretos + stats + equipped no push:**
- `push-to-foundry/mapping.ts`: novo `buildPcItem` — de-para
  `item_catalog.category` → tipo dnd5e (weapon/staff→weapon; armor/shield→
  equipment; potion/scroll/poison/ammunition→consumable; tools→tool;
  equipment-pack→container), depois `items.type` da UI (Arma→weapon,
  Armadura/Artefato Sagrado→equipment, Consumível→consumable), fallback
  **"equipment"** — NUNCA "loot" no inventário de PC (FATO: `LootData` do
  dnd5e 5.3.3 não tem `system.equipped`).
- Stats do catálogo: `damage_dice`/`damage_type` → `system.damage.base` (o
  MESMO `parseDamage` já validado em prod pelos ataques de NPC — FATO);
  `ac_base` + `stats.raw.armor.category`/`ac_cap_dexmod` (verificados no
  banco real) → `system.armor`/`system.type`; peso, preço, raridade
  ("Very Rare"→"veryRare"), descrição, subtipo de consumível.
- `system.equipped` ← `character_items.equipped` (só weapon/equipment).
- Crachá nos DOIS escopos (`companionFlags`), inclusive no loot de NPC.
- `push-to-foundry/index.ts`: busca `item_catalog` à parte e casa por
  `catalog_source_key` (FATO: não há FK items→item_catalog, embed não
  resolve).

**Fase B2 — `a52be84` — porta de entrada expandida:**
- `foundry-inbound/index.ts`: nova operação `op:"item.upsert"` mantendo a
  rota de equipped INTACTA (body sem `op` = caminho antigo, byte a byte).
- Travas (todas justificadas no cabeçalho do arquivo): segredo próprio no
  header (inalterado) · valida actor vinculado (inalterado) · whitelist
  estrita por operação (upsert lê SÓ foundry_item_id, name, type, stats,
  description, img, qty, equipped) · body > 32 KiB → 413 · rate-limit do
  upsert 10/60s por actor (equipped continua 20/10s) · sanitização (strip
  TOTAL de HTML + entities + caps; img só URL http(s) — caminho local
  "icons/..." do Foundry é descartado) · dedupe por
  `(foundry_item_id, character_id)` — reenvio vira UPDATE, nunca duplica ·
  escrita restrita ao PC dono · log de auditoria.
- Resposta devolve `items.id` → o módulo grava como crachá no item do
  Foundry (item nativo ganha identidade do Companion).
- **Migration aditiva** `20260711000100_impl35_items_foundry_item_id.sql`
  (SQL na §4 — aplicar MANUAL).

### `companion-foundry-module`

**Fase B3 — `58d5eb2` (detecção) + `db246ff` (mão de volta completa):**
- `settings.js`: `inboundUrl` (default = URL real da edge, editável) +
  `inboundKey` (default vazio = mão de volta DESLIGADA). Strings en/pt-BR.
- `bridge-client.js#tagItems`: consolida o crachá no escopo válido
  (`flags[MODULE_ID].item_id`) inclusive pra payloads antigos que só trazem
  `flags.companion`; toda operação de documento do bridge agora passa
  `{ companionBridge: true }` nas options (token de origem).
- `equip-sync.js` (novo): hooks `updateItem` + `createItem`, POST
  autenticado com log claro por status (401/404/413/429/503),
  `syncActorInventory` (sync inicial, 1 item/7s), anti-eco em 3 camadas
  (§3).
- `main.js`: watcher registrado só no bloco GM do `ready`;
  `api.syncInventory(actor)` exposto pra macro/console.

## 3. LOOP DE ECO — as 3 camadas (por que não duplica)

O perigo: Companion manda item → Foundry cria → `createItem` dispara → módulo
manda de volta → Companion cria de novo → infinito. Barrado por:

1. **Token de origem** — toda operação do bridge-client leva
   `{ companionBridge: true }` nas options; TODO hook da mão de volta
   descarta essas operações na primeira linha. *(HIPÓTESE H5: options
   customizadas chegam nos hooks do cliente iniciador — padrão do Foundry,
   e o GM é iniciador E observador aqui.)*
2. **Identidade** — item que veio do Companion tem `flags[MODULE_ID].synced`
   + crachá; `createItem`/upsert pulam esses. Só item genuinamente novo do
   Foundry viaja.
3. **Estrutural (FATO no código)** — o sync Companion→Foundry é
   DELETE+CREATE de itens synced (`bridge-client.js #updateActor`), nunca
   update → não dispara `updateItem`; e o único write da volta é
   `character_items.equipped`/upsert no banco, que NÃO gera push automático
   pro Foundry (push-to-foundry é botão manual — `JogadoresTab.tsx`).

Extra: equipar VIA Companion hoje nem chega ao Foundry em tempo real (só no
re-sync manual do inventário, que agora CARREGA o equipped — Fase B1 — e
chega como create com token+synced → ignorado). Rate-limit da edge é o
para-raios final.

## 4. GO-LIVE — estado (2026-07-11)

1. ✅ **Migration aplicada** — `items.foundry_item_id` + índice parcial
   criados no banco (verificado por SELECT no information_schema).
2. ⏳ **Secret — ÚNICO passo pendente do Bruno** (não há ferramenta de
   secrets neste ambiente):
   ```
   supabase secrets set FOUNDRY_INBOUND_KEY=<chave> --project-ref leziqtoarclocroaqwsp
   ```
   (ou Dashboard → Edge Functions → Secrets). A chave gerada pra isto foi
   entregue no chat da sessão de go-live. Até o secret existir, a
   foundry-inbound responde 503 (inerte por design).
3. ✅ **Edges deployadas** (via API de management, FATO):
   - `push-to-foundry` **v6**, verify_jwt: true — Fase B1 no ar.
   - `foundry-inbound` **v2**, verify_jwt: **false** — Fase B2 no ar.
   O bundle compilou (eszip gerado) = sem erro de sintaxe/import.
   Smoke test HTTP não foi possível da sessão (proxy bloqueia o domínio) —
   coberto pelo T6 do roteiro.
4. ⏳ **Módulo no Foundry**: atualizar os arquivos no PC (branch
   `claude/companion-foundry-bridge-6kstk8`) e, nas settings (como GM):
   - *URL de Entrada do Companion*: default já certo
     (`https://leziqtoarclocroaqwsp.supabase.co/functions/v1/foundry-inbound`)
   - *Chave de Entrada do Companion*: a mesma do passo 2.
5. **Vínculo**: cada PC precisa do `foundry_actor_id` colado na aba
   Jogadores (como já era).

## 5. ROTEIRO DE TESTE (solo, no Foundry)

Pré: passos do §4 feitos. Console aberto (F12) logado como GM.

**T0 — carga.** Ao carregar o mundo:
`companion-foundry-bridge | equip watcher registrado (updateItem + createItem)`.

**T1 — Companion→Foundry (tipos/stats/equipped).**
1. No Companion, garanta que o PC tem itens (ideal: um do catálogo tipo
   arma/armadura + um manual), alguns equipados.
2. Aba Jogadores → enviar inventário.
3. Na ficha do Foundry: itens com TIPO certo (arma como weapon com dano,
   armadura com CA), **toggle de equipar presente** e estado de equipado
   igual ao do Companion. ← mata o bug antigo do "loot".
4. Console: `game.actors.get("<actorId>").items.contents.map(i => [i.name, i.type, i.flags["companion-foundry-bridge"]])`
   → cada item synced com `{ synced: true, item_id: "<uuid>" }` (H2).

**T2 — Foundry→Companion (equipar).**
1. Togglar equip de um item synced na ficha.
2. Console: `equip → Companion: "<nome>" equipped=true`.
3. No Companion: `character_items.equipped` daquele item mudou (UI ou
   SELECT). Latência = 1 request.

**T3 — Foundry→Companion (item novo).**
1. Arrastar um item qualquer do compêndio pra ficha do PC vinculado.
2. Console: `item enviado pro Companion: "<nome>" → <uuid> (criado)`.
3. No Companion: item apareceu no inventário do PC (nome, tipo traduzido,
   descrição em texto puro, qty). No Foundry o item ganhou o crachá
   (inspecionar flags como em T1.4).
4. Togglar equip DESSE item → deve ir pela rota leve (T2), sem duplicar.

**T4 — sync inicial (itens pré-ponte).**
1. Macro/console como GM:
   ```js
   const actor = game.actors.getName("NOME DO PC");
   game.modules.get("companion-foundry-bridge").api.syncInventory(actor);
   ```
2. Notificação `enviando N itens…`; ritmo ~1 item/7s (rate-limit).
3. Ao fim: `sync inicial ... X enviados, 0 falhas`. Conferir no Companion.
4. Rodar DE NOVO → `0 elegíveis` (todos com crachá — dedupe funcionando).

**T5 — LOOP DE ECO (o crítico).**
1. Anote a contagem: `SELECT count(*) FROM character_items WHERE character_id = '<pc>'`
   (ou conte na UI).
2. No Companion, reenviar o inventário do PC (botão da aba Jogadores).
3. No Foundry: itens synced recriados (delete+create). Console NÃO pode
   mostrar nenhum `item enviado pro Companion` nem `equip → Companion`.
4. Contagem no Companion IGUAL à do passo 1. Repetir o reenvio 2–3×:
   contagem estável = eco morto.
5. Equipar no Foundry (T2) e reenviar inventário de novo: o item volta do
   Companion JÁ equipado (Fase B1 manda equipped) — sem flip-flop.

**T6 — erros com mensagem clara (opcional).** Com a inboundKey errada de
propósito: console deve logar `inbound 401: chave errada...`. Sem o secret
no Supabase: `inbound 503: porta trancada...`.

## 6. HIPÓTESES — o que SÓ o teste confirma

| # | Hipótese | Sintoma se falhar | Inspeção no console |
|---|----------|-------------------|---------------------|
| H1 | Toggle de equip dispara `updateItem` com `changes.system.equipped` boolean | T2 não loga nada | `Hooks.on("updateItem", (i,c)=>console.log(c))` e togglar |
| H2 | `flags` de escopo desconhecido ("companion") sobrevivem à persistência | Só afeta itens ANTIGOS (pré-B1); novos têm o escopo válido | `item.flags` no console |
| H3 | `game.users.activeGM` existe no v13/14 | Nenhum (código defensivo: `undefined` → segue) | `game.users.activeGM` |
| H4 | dnd5e aceita os campos que mandamos por tipo (armor.dex, type.value light/medium/heavy/shield, subtipo de consumível, rarity) | Item chega sem o stat, ou o create do actor falha com erro de validação (aparece no console e no log do Worker) | criar 1 item de cada tipo e abrir a ficha |
| H5 | Options customizadas (`companionBridge`) chegam nos hooks do cliente GM | T5 mostraria upserts durante o re-sync — mas a camada 2 (synced/crachá) segura sozinha | `Hooks.on("createItem",(i,o)=>console.log(o))` e reenviar inventário |
| H6 | `actor.type === "character"` é o tipo dos PCs no dnd5e v5 | T3 não loga (item ignorado) | `game.actors.getName("PC").type` |
| H7 | Foundry item ids casam com `/^[A-Za-z0-9]{8,32}$/` (edge valida) | upsert responde 400 `foundry_item_id inválido` | `item.id.length` no console |

## 7. Limitações conhecidas (por design, MVP)

- **Deletar item no Foundry NÃO deleta no Companion** (sem hook deleteItem —
  decisão de escopo; a edge também não tem rota de delete).
- Equipar VIA Companion não empurra em tempo real pro Foundry (só no
  reenvio manual do inventário) — igual antes.
- Sync inicial é sequencial (~7s/item) por causa do rate-limit da edge.
- Item do Foundry vira texto no Companion (descrição sem HTML); stats viram
  resumo curto em `properties` (ex.: `1d8+1 slashing · CA 14`).
- `types.ts` do Supabase segue sem regenerar — casts existentes intactos.

## 8. Pendência de faxina (depois de validado em prod)

- Comentário antigo em `mapping.ts` (pré-B1) sobre "módulo não preserva
  flags" já foi corrigido; conferir se `docs/IMPL-35.md` precisa registrar
  as decisões B1–B3 (não mexi no IMPL-35 — fora do escopo desta sessão).
