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

### Ações, atalhos e sem trava de combate — desde a 1.13.0 (21/10)

- O `actor.snapshot` leva também as **ações** do ator (`acoes`): armas,
  habilidades e consumíveis com algo a usar no dnd5e (`system.activities`
  com pelo menos uma). Habilidade passiva e arma sem atividade ficam de fora.
- O pedido pode ser um **atalho** do jogador (`tipo: "atalho"`, `itens`, até
  5): a pergunta é UMA ("Usar Bless, depois Guiding Bolt em …?"), e os itens
  são usados em ordem. Se ele cancelar um no diálogo do dnd5e, os seguintes
  não são usados, e o Companion recebe "recusou".
- "Lançar" quando é uma magia só; "Usar" no resto.
- **Sem trava de combate** (decisão do Bruno): quem decide é a fala que o
  jogador configurou no app (só o nome, uma palavra antes, os apelidos, os
  atalhos). A pergunta continua: nada é usado sem o toque.
- O pedido de antes (só `item_id`) vale como antes.

### Item não identificado — desde a 1.18.0 (31/10)

O Companion pode marcar um item como **não identificado** (o jogador vê só
um nome de fachada). No dnd5e 5.3 isso é `system.identified` e
`system.unidentified.name`/`.description` (os seis tipos físicos).

- **Companion → Foundry:** o envio do inventário leva `identified`, a fachada
  e, na flag `identificacao`, a VERSÃO da mudança no Companion. No item que o
  ator já tem (nativo ou cópia), o módulo só aplica versão mais nova que a que
  já aplicou (flag `identificacao_aplicada`): versão 0 (todo item na virada)
  nunca mexe no que o Foundry tem, e um envio velho não desfaz o que o GM fez
  aqui depois. O item novo (do compêndio ou casca) já nasce como o Companion
  diz. O nome guardado continua o verdadeiro; o dnd5e mostra a fachada.
- **Foundry → Companion:** o GM esconde ou revela o item AQUI → o
  `item.estado` leva `identified`, a fachada e `identificacao_aplicada`. Só
  quando a mudança foi feita aqui (não em todo estado nem ao abrir o mundo):
  o item que já estava escondido no Foundry antes da 1.18.0 não some para o
  jogador no Companion. A edge só grava se o Foundry já viu a versão de agora
  do Companion. O item novo do Foundry (`item.upsert`) leva o nome VERDADEIRO
  (`_source.name`) e a identificação.
- **A ficha que o jogador lê** (`actor.snapshot`): o efeito de item escondido
  fica de fora (`efeitos` e os `effects` dos equipados), como o dnd5e faz para
  quem não é GM. O nome já é a fachada (o nome preparado).
- Com o Companion de antes (sem a flag), nada muda.

### Música do Companion — desde a 1.19.0 (31/10)

O Companion pede uma trilha da biblioteca de sons dele (o painel Música, o som
da cena, o chat da Mesa) e o Foundry toca para todos.

- **O cano:** o Companion → a ponte (`POST /audio`, op `audio.comando`) → o
  GM ATIVO responde "recebido" na hora e muda a playlist **"Companion —
  Trilhas"** (criada sozinha na primeira vez: modo soundboard, canal música,
  marcada pela flag `trilhas`). O Foundry toca para todos os navegadores a
  partir do estado da playlist; cada jogador ouve no volume de música dele.
- **Comandos:** tocar (volume 0 a 1, em loop ou uma vez, fade em ms; "cruzar"
  tira as outras do Companion com o mesmo fade, "somar" toca por cima), parar
  uma ou todas, o volume de uma, e o que toca agora. Cada faixa é UM som da
  playlist (flag `faixa_id`, o id na biblioteca do Companion): pedir de novo
  reusa. Um comando por vez, na ordem.
- **O arquivo:** o caminho da biblioteca é relativo à **Pasta das trilhas do
  Companion** (configuração do mundo; padrão `sounds`, dentro de Data). Antes
  de tocar, o módulo lista a pasta (`FilePicker.browse`): arquivo que não está
  lá não toca e o Companion lê `arquivo_nao_achado: <caminho>`. Sem permissão
  de listar, toca assim mesmo.
- **A volta:** depois de cada comando, e a cada mudança na playlist feita
  aqui (o GM tocou ou parou, a faixa acabou), o que toca agora vai à entrada
  do Companion (`op: "trilha.resultado"`). Ao abrir o mundo, também.
- O GM pode mexer na playlist à mão como em qualquer outra; o Companion
  acompanha.

### O acervo grande — desde a 1.20.0 (31/10)

O Mestre aperta **"Importar a pasta do Foundry"** no painel Música do Companion
e a biblioteca dele passa a conhecer TODO arquivo de áudio da Pasta das trilhas
(as pastas de dentro também). Os arquivos ficam aqui; o Companion guarda o
caminho.

- **O pedido** chega pelo mesmo cano (`audio.comando`, ação `listar`) e corre
  FORA da fila da música: importar milhares de arquivos não segura o "tocar".
  Uma importação por vez.
- **Listar:** pasta por pasta (`FilePicker.browse("data", pasta, { extensions })`,
  só as extensões de áudio do Foundry). A pasta que não abre vai junto como
  falha: o Companion não marca nada como "sumiu" quando a lista não está inteira.
- **Mandar:** em lotes de até 400 arquivos e 90 KB (a entrada recusa acima de
  128 KiB), `op: "trilha.acervo"`, com 3 tentativas quando a entrada não
  responde. O Companion etiqueta (as palavras, os temas em português, o tipo,
  os climas sugeridos), cadastra o que é novo e não mexe no que o Mestre editou.
- **A duração:** a resposta de cada lote diz quais arquivos ainda não têm
  duração no Companion; só esses são medidos (um `<audio>` que lê o cabeçalho,
  6 de cada vez, até 4 s cada) e vão em `op: "trilha.duracoes"`. Reimportar não
  mede de novo.
- O GM vê no Foundry o aviso do começo e do fim ("Companion: 1.204 arquivos
  importados").
- Medido nos testes (Foundry simulado, `test/acervo.test.js`): 5.000 arquivos em
  56 pastas, 13 lotes, cerca de 1,2 s com a listagem simulada a 2 ms por pasta e
  a duração a 1 ms por arquivo. O tempo do Foundry de verdade depende do disco e
  da rede do PC (HIPÓTESE até o teste do Bruno).

### O combate começou ou acabou — desde a 1.21.0 (31/10)

Para a **trilha pelo clima** do Companion (a música troca para uma de combate
NA HORA quando o combate começa e volta ao clima 1 min depois que ele acaba;
quem decide é o banco do Companion).

- **Começou:** o combate passou a ter rodada (`Combat#started`), visto no
  gancho `updateCombat` (dispara em todo navegador depois da gravação).
  **Acabou:** o combate começado foi apagado (o "Encerrar combate" apaga o
  encontro: `deleteCombat`) ou voltou a não ter rodada.
- Só o GM ativo manda, à edge `foundry-combate` (a URL da entrada com o nome
  trocado; a mesma chave), `combate_id` e `fase` (`inicio`/`fim`), uma vez
  por fato, com 3 tentativas se ela não responde. A configuração "Acertos e dano ao Companion" liga e desliga junto.
- Ao abrir o mundo, o combate já começado entra como conhecido, sem mandar
  nada.
- Sem sessão em andamento no Companion, a entrada não faz nada.

### Os testes de perícia — desde a 1.22.0 (31/10)

Para a **música pelo contexto** do Companion (a investigação muda a música;
quem decide é o banco do Companion, `trilha_contexto_teste`).

- Toda mensagem do chat de um **teste de perícia** de um **personagem**
  (`flags.dnd5e.roll.type = "skill"`, com o `skillId`; o dnd5e 5.3 põe isso na
  mensagem, `actor.mjs`, `#rollSkillTool`) vai, pelo GM ativo, à edge
  `foundry-combate` como `{ op: "contexto.teste", pericia, evento_id }`. O
  teste de NPC e o de ferramenta não vão.
- O banco transforma em "investigação" só Investigação, Percepção, Intuição,
  Arcanismo, História, Religião, Natureza e Sobrevivência; as outras perícias
  não mudam nada. O id da mensagem faz o reenvio não duplicar.
- Até 3 tentativas se a edge não responde. A configuração "Acertos e dano ao
  Companion" liga e desliga junto.

### A iniciativa falada — desde a 1.23.0 (07/11)

O Mestre diz "iniciativa" na mesa (ou aperta "Iniciativa" na Mesa do
Companion), escolhe num cartão quem entra, e o combate abre aqui.

- **A lista** (op `combate.comando`, `acao: "cena"`, pela ponte, rota
  `POST /combate`): os tokens da cena ATIVA (`game.scenes.active`), os
  personagens do Companion com ou sem token, os outros com miniatura (48 px,
  `ImageHelper.createThumbnail`) e os selecionados pelo GM agora
  (`canvas.tokens.controlled`, só se ele está vendo a cena ativa). Com o cartão
  aberto (até 15 min), o GM ativo manda a seleção nova a cada `controlToken`
  (`op: "iniciativa.selecao"`, edge `foundry-combate`).
- **Abrir** (`acao: "abrir"`): cria o combate na cena (ou usa o de agora),
  adiciona os marcados (`createEmbeddedDocuments("Combatant")`, com o
  escondido), rola SÓ os que não são personagens do Companion
  (`combat.rollInitiative(ids)`; no dnd5e, sem diálogo e com a vantagem da
  ficha) e pergunta "Rolar iniciativa?" ao jogador dono e conectado
  (`User#query`, a pergunta `companion-foundry-bridge.rolarIniciativa`).
  Responde na hora.
- **No navegador do jogador**: a janela "Rolar iniciativa?"; "Rolar" rola
  como ele (`combat.rollInitiative([o dele])`). A janela fecha sozinha se a
  iniciativa chega por outro caminho (o botão do Companion, o d20 do Combat
  Tracker). Nunca rola duas vezes.
- **Rolar pelo Companion** (`acao: "rolar"`): rola no navegador do jogador,
  sem perguntar; sem ele no Foundry, o GM rola por ele. A mensagem do chat diz
  "rolado pelo Companion" (e "pelo Mestre", quando foi o GM).
- **Quem rolou** volta ao Companion pelo `updateCombatant` (só personagem;
  `op: "iniciativa.rolou"`), venha a rolagem de onde vier. O combate apagado
  vai como `op: "iniciativa.combate_fim"`.
- **Começar** (`acao: "comecar"`): `startCombat()` — o Companion pede quando o
  último jogador rola, ou no "Começar agora". A música pelo contexto vê o
  começo como sempre (1.21.0).

### A ordem do combate — desde a 1.24.0 (08/11)

Depois que todos rolam, a ORDEM do combate aparece no Companion (na Mesa do
Mestre e na de cada jogador) e segue o Foundry nos dois sentidos.

- **A foto** (`scripts/ordem.js`, `fotoDoCombate`): o combate COMEÇADO na cena
  ativa (o ativo dela, senão o último; sem um, o começado que não é de cena
  nenhuma), na ordem de `combat.turns` (a mesma do Combat Tracker e do
  Carousel): o nome, a imagem (o CAMINHO do Foundry, não a miniatura), a
  iniciativa (nula = não rolou), o escondido (o combatente e o token), o
  derrotado, o tipo do ator e a vida (dnd5e: `hp.value`, o máximo efetivo e o
  temporário). O Companion tira a vida e os escondidos do que o jogador lê.
- **Quando sai** (só o GM ativo, `scripts/ordem-foundry.js`): cada gancho de
  combate, combatente, ator, token, cena ativa e dano só AGENDA uma comparação
  para daqui a 0,4 s; a cada 4 s uma comparação local pega o que nenhum gancho
  avisou (a vida do token não ligado). A foto vai à edge `foundry-combate`
  (`op: "combate.ordem"`) só quando muda, e a cada 30 s de novo, o "estou vivo"
  (75 s sem ele, o Companion diz "Foundry offline"). Um envio por vez; sem
  combate, nada fica saindo. Desliga em "A ordem do combate no Companion".
- **Os comandos do Mestre** (a mesma `op: "combate.comando"` da ponte):
  `acao: "proximo"` (`combat.nextTurn()`), `"anterior"` (`previousTurn()` com
  `turnEvents: false`, posto pelo gancho `combatTurn`/`combatRound`: o dnd5e
  não recupera usos ao voltar) e `"focar"` (o token selecionado e a câmera
  nele; com o GM noutra cena, `scene.view()` leva só a visão dele). O turno só
  passa se a vez ainda for a que o Mestre viu (`vez_vista`; senão, `recusado:
  "a_vez_mudou"`): dois cliques não pulam dois turnos.
- **O código velho no cache** (o Foundry guarda os arquivos do módulo 4 h):
  `scripts/versao.js` diz a versão DESTE código (o release a carimba junto com
  o `module.json`). Em todo navegador, se a versão instalada (`game.modules`,
  que vem do servidor) for outra, aparece "recarregue com Ctrl+Shift+R". O GM
  ativo pergunta a versão do código a cada jogador conectado (`User#query`,
  `companion-foundry-bridge.versao`; quem não responde roda código anterior ao
  1.24.0) e manda junto com a foto: a Mesa do Mestre avisa quem precisa
  recarregar.

### O saque — desde a 1.25.0 (10/11)

O inimigo derrotado vira um "corpo" no Companion; o Mestre libera a revista
para UM personagem; o jogador rola Investigação; o Companion sorteia; o Mestre
vê o resultado e revela; o jogador escolhe o que pega. Toda regra mora no
banco do Companion: o módulo só avisa e mostra. O contrato inteiro e o que
ainda é HIPÓTESE (ninguém testou no Foundry de verdade): `docs/SAQUE.md`.

- **Morreu** (só o GM ativo, só ator `npc`; `scripts/saque-foundry.js`): o
  `dnd5e.damageActor` de PV acima de 0 para 0 ou menos, o `createActiveEffect`
  com o estado de derrotado (`CONFIG.specialStatusEffects.DEFEATED`) e o
  `updateCombatant` com `defeated: true`. Cada `actor.uuid` avisa uma vez (dois
  goblins do mesmo ator são dois corpos). Vai à edge `foundry-saque`
  (`op: "saque.morreu"`) e vira um cartão no chat, só dos GMs: "<nome> caiu.",
  um botão por personagem e "Sem saque".
- **A Investigação** é a NATIVA do dnd5e (`actor.rollSkill`, com o diálogo, a
  vantagem e os bônus da ficha), pelo botão do cartão sussurrado ao dono do
  ator. A mensagem leva a flag `saque` com a revista; o GM ativo manda o total
  (`op: "saque.rolou"`). Essa rolagem fica FORA da música pelo contexto.
- **O resultado** chega pela ponte (`saque.comando`) e aparece só para os GMs,
  com "Revelar a <personagem>".
- **A janela do jogador** (ApplicationV2, aberta pelo GM com `User#query`) é o
  MESMO pergaminho do Companion (`styles/saque.css`, `assets/pergaminho/`,
  `assets/fontes/`): as moedas e cada item, com "Pegar" e "Deixar". O clique
  volta ao GM ativo por `User#query`, e dele à edge. O item não identificado
  mostra só a fachada.
- Liga e desliga em "O saque no Companion". Nas flags dos cartões só vão ids.

## Testes

`npm test` (Node 22, sem instalar nada): as regras puras e um Foundry falso
para a cola com o WebSocket e os ganchos. Não prova o Foundry de verdade — isso
é o roteiro de teste com o Foundry aberto.

`node qa/ordem-simulada.mjs "$PWD"` (~25 s, fora do CI): o lado do GM da ordem
do combate com um Foundry de mentira (os ganchos, o `fetch` e os relógios de
verdade).

O saque, fora do CI: `node qa/saque/simulado.mjs` (a cola com um Foundry de
mentira) e `node qa/saque/capturar.mjs` (precisa do Playwright: abre
`qa/saque/janela.html`, a janela de pergaminho fora do Foundry, fotografa em
computador, iPhone e iPad e mede o contraste de cada texto, o foco e a
largura; as fotos ficam em `qa/saque/capturas/`).

## Files

- `scripts/main.js` — hooks: register settings, connect on ready (GM).
- `scripts/bridge-client.js` — WebSocket client (reconnect, heartbeat, actor handlers).
- `scripts/trilhas.js` / `scripts/trilhas-foundry.js` — a música do Companion (1.19.0).
- `scripts/acervo.js` — a importação da pasta das trilhas (1.20.0).
- `scripts/status-app.js` — connection-status panel (ApplicationV2).
- `scripts/settings.js` — settings + status menu registration.
- `scripts/equip-sync.js` — the way back to the Companion (estado, exclusão, item novo).
- `scripts/moedas-sync.js` — the currency both ways (v1.9.0).
- `scripts/ordem.js` / `scripts/ordem-foundry.js` — the combat order to the Companion, the turn and focus commands (v1.24.0); `scripts/versao.js` — this code's version, stamped by the release.
- `scripts/combate-sync.js` — hits and damage to the Companion's end-of-session report (v1.11.0); combat start/end for the climate soundtrack (v1.21.0, rules in `scripts/combate-estado.js`); skill checks for the context soundtrack (v1.22.0, `testeDaMensagem` in `scripts/combate.js`).
- `scripts/iniciativa.js` / `scripts/iniciativa-foundry.js` — the spoken initiative (v1.23.0): the scene list, opening the combat, the player's roll prompt, rolling via the Companion.
- `scripts/saque.js` / `scripts/saque-foundry.js` — looting (v1.25.0): the three death signals, the chat cards, the Investigation roll, the player's parchment window; `styles/saque.css`, `assets/pergaminho/`, `assets/fontes/`.
- `scripts/magia-falada.js` — the spoken spell: the player-side query handler and the GM relay (v1.12.0; actions and shortcuts since v1.13.0).
- `scripts/plano-inventario.js`, `scripts/fila-por-ator.js`, `scripts/casar-compendio.js`, `scripts/moedas.js`, `scripts/combate.js`, `scripts/magias.js` — pure rules, tested in `test/`.

## Créditos

- **Fontes** (`assets/fontes/`): Mr Eaves Small Caps e Scaly Sans (Remake), de
  **Solbera**, com as correções de Ryrok, Ners e LUCASTUCIOUS, do pacote npm
  `solbera-dnd-fonts` 1.0.2. Licença **CC BY-SA 4.0**
  (https://creativecommons.org/licenses/by-sa/4.0/); os `.woff2` vão sem
  modificação, com o texto da licença em `assets/fontes/LICENSE.txt` e a
  origem em `assets/fontes/LEIA-ME.txt`. Usadas só na janela do saque.
- **Pergaminho** (`assets/pergaminho/`): as mesmas duas imagens da janela de
  pergaminho do Companion (`packages/shared/src/assets/pergaminho/`), copiadas
  byte a byte.
