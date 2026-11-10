# O saque (módulo 1.25.0)

Inimigo (ator do tipo `npc`) derrotado vira um "corpo" no Companion; o Mestre
libera a revista para UM personagem; o jogador rola Investigação (a nativa do
dnd5e); o Companion sorteia; o resultado vai só ao GM; o GM revela; o jogador
vê uma janela de pergaminho com o que achou e escolhe Pegar ou Deixar.

**Tudo o que é regra mora no banco do Companion.** O módulo só avisa (morreu,
rolou, clicou) e mostra (os cartões do chat e a janela).

⚠️ **Ninguém testou isto no Foundry de verdade.** O que está conferido é o
código-fonte do dnd5e 5.3.3 e os tipos da comunidade do Foundry v14
(`@league-of-foundry-developers/foundry-vtt-types` 14.369.0-beta), citados nos
comentários com arquivo:linha. O que só o Foundry aberto responde está na
seção "HIPÓTESES".

## Os arquivos

| Arquivo | O que é |
| --- | --- |
| `scripts/saque.js` | As regras e os desenhos, PUROS (sem `game`, sem DOM): os sinais de morte, a memória, a resposta da edge, o comando, os textos, o HTML dos cartões e da janela. Testado em `test/saque.test.js`. |
| `scripts/saque-foundry.js` | O que toca o Foundry: os ganchos, os cartões (`ChatMessage`), os cliques, as duas perguntas (`User#query`) e a janela (ApplicationV2). |
| `styles/saque.css` | O pergaminho da janela e o arranjo dos cartões. Todo seletor começa por `.cfb-saque-`. |
| `assets/pergaminho/`, `assets/fontes/` | As imagens e as fontes do pergaminho do Companion, copiadas byte a byte (as fontes com `LICENSE.txt`, CC BY-SA 4.0). |
| `qa/saque/` | `janela.html` (a janela fora do Foundry), `capturar.mjs` (fotos e medidas), `simulado.mjs` (a cola com um Foundry de mentira). |

Em `main.js`: no `init`, em TODO navegador, `registerSaqueQueries()` (as duas
perguntas e o clique dos botões); no `ready` do GM, `registerSaqueSync()` (os
sinais de morte e a mensagem da rolagem). Cada gancho confere NA HORA se o
navegador é o do GM ATIVO, pelo critério de `souOGmAtivo()` de `main.js`, e
não pelo `isReportingGm()` de `equip-sync.js`, que devolve verdadeiro quando
não há GM ativo.

Configuração do mundo: **"O saque no Companion"** (`saqueAoCompanion`, ligada).
Desligada: nenhum aviso de morte sai e o `saque.comando` responde
`{ recebido: false, motivo: "desligado" }`.

## O fluxo

1. **Morreu.** Três sinais, só no GM ativo, só para `actor.type === "npc"`:
   - `dnd5e.damageActor`, de PV acima de 0 para 0 ou menos;
   - `createActiveEffect` com o estado `CONFIG.specialStatusEffects.DEFEATED`
     (`dead` no dnd5e);
   - `updateCombatant` com `defeated: true`.

   Cada `actor.uuid` avisa UMA vez por navegador (os três sinais do mesmo
   goblin são um corpo; dois goblins do mesmo ator são dois). Vai
   `saque.morreu`, com até 3 tentativas. Se o aviso não chega, ou o Companion
   responde `sem_sessao`/`desligado`, o uuid é esquecido: o próximo sinal
   tenta de novo, e nada aparece na tela (só o console).
2. **O cartão da morte**, sussurrado aos GMs (se `ok` e não `ja_existia`):
   "<nome> caiu.", "Liberar a revista para:" com um botão por personagem de
   `pcs`, e "Sem saque". Com `alvo_tipo` nulo, a linha "O Companion não achou
   a ficha desta criatura…".
3. **Liberar** (clique do GM ativo): `saque.liberar`. Deu certo: o cartão vira
   "Liberado para Guldrum.", sem botões. O Companion responde pela ponte com
   `saque.comando` `liberada`.
4. **`liberada`**: o cartão "<pc> revista <corpo>. Role Investigação.", com o
   botão "Rolar Investigação", sussurrado aos donos JOGADORES do ator (todos
   os que têm OWNER, conectados ou não) e aos GMs. Sem ator ligado, ou sem
   dono jogador: um cartão só dos GMs, "… não tem ator ligado no Foundry: peça
   o total e digite no Companion."
5. **Rolar** (no navegador de quem clicou, só se `actor.isOwner`):
   `actor.rollSkill({ skill: "inv", event }, {}, { data: { flags: {
   "companion-foundry-bridge": { saque: <revista_id> } } } })`. É a rolagem
   nativa: diálogo, vantagem, bônus da ficha.
6. **Rolou** (GM ativo, `createChatMessage`): a mensagem com a nossa flag e
   `rolls[0].total` numérico vira `saque.rolou` (`Math.round(total)`, o id da
   mensagem; cada mensagem uma vez; até 3 tentativas). Deu certo: o cartão do
   passo 4 vira "Investigação rolada: 17. O Mestre vê o resultado.". Recusa:
   o aviso na tela do GM. Essa mensagem fica FORA da música pelo contexto
   (`testeDaMensagem` em `scripts/combate.js` devolve nulo para ela).
7. **`resultado`**: o cartão só dos GMs, "O que <corpo> tinha (<pc> tirou 17,
   faixa boa):", com cada achado e o botão "Revelar a <pc>". Lista vazia:
   "Nada." (também se revela). `corpo.sem_ficha` com `achados` nulo: "Escolha
   a criatura deste corpo no Companion: o sorteio sai na hora.", sem botão.
8. **Revelar** (clique do GM ativo): `saque.revelar`; o cartão vira "Revelado
   a Guldrum.". O Companion responde com `revelada`.
9. **`revelada`**: o GM manda os dados ao navegador do dono ATIVO do ator
   (`donoDoAtor`, o mesmo da magia falada) por `User#query`
   (`companion-foundry-bridge.saqueAbrir`); o handler abre a janela e responde
   `{ aberta: true }`. Sem dono ativo (ou sem resposta em 15 s): o aviso ao
   GM, "<pc> não está no Foundry: ele pega pelo Companion.".
10. **A janela**: "O que você achou em <corpo>"; as moedas primeiro ("Pegar
    as moedas"/"Deixar"), depois cada item ("Pegar"/"Deixar"). O clique vai ao
    GM ativo por `User#query` (`companion-foundry-bridge.saqueDecidir`), que
    chama `saque.pegar`/`saque.deixar` e devolve `{ ok, pendentes, error }`.
    Enquanto espera, os botões da linha ficam desligados; ok, a linha vira
    "Você pegou."/"Você deixou."; `pendentes === 0`, o rodapé "Tudo decidido."
    com "Fechar"; erro, a frase na linha. Sem GM ativo: "O Mestre não está
    conectado.".
11. **`encerrada`**: um cartão só dos GMs com o texto `pegou`, se vier.
12. **`pedido`** (a qualquer hora): o cartão só dos GMs, "<pc> quer revistar
    <corpo>", com "Liberar para <pc>".

## O contrato

### Foundry → Companion: a edge `foundry-saque`

`POST` em `urlDaRota(<inboundUrl>, "foundry-saque")` (`scripts/rotas.js`), com
o cabeçalho `x-foundry-inbound-key`, por `postInbound(corpo, { rota })`. Só o
GM ativo chama.

| Corpo | Resposta |
| --- | --- |
| `{ op: "saque.morreu", ator_uuid, ator_id, nome, nome_ator }` | `{ ok: true, corpo_id, ja_existia, nome, alvo_tipo, alvo_id, pcs: [{ id, nome, foundry_actor_id }] }` ou `{ ok: false, motivo: "sem_sessao" \| "desligado" }` |
| `{ op: "saque.liberar", corpo_id, pc_id }` | `{ ok: true, id }` (a revista) |
| `{ op: "saque.rolou", revista_id, total, mensagem_id }` | `{ ok: true, estado: "rolada" }` |
| `{ op: "saque.revelar", revista_id }` | `{ ok: true }` |
| `{ op: "saque.pegar" \| "saque.deixar", revista_id, achado_id }` | `{ ok: true, item_id?, pendentes }` |
| `{ op: "saque.fechar", corpo_id }` | `{ ok: true }` |

`ator_uuid` é o `actor.uuid` do ator do TOKEN; `ator_id`, o `actor.id`;
`nome`, o do token (senão o do ator); `nome_ator`, o do ator de base
(`game.actors.get(actor.id).name`).

Recusa de regra: HTTP 200 `{ ok: false, error: "<frase em português>",
recusado: true }`; o módulo mostra a frase (`ui.notifications.warn`) e não
repete. HTTP 400, 401, 403, 404 e 413 não repetem; rede, 429 e 5xx repetem
(até 3 vezes) só em `saque.morreu` e `saque.rolou`; os cliques não repetem
sozinhos (o Mestre ou o jogador clica de novo).

### Companion → Foundry: a ação `saque.comando` da ponte

Chega pelo WebSocket como as outras (`bridge-client.js`). A resposta é NA
HORA: `{ data: { recebido: true } }`; ação que não existe, `{ recebido: false,
motivo: "acao_desconhecida: <x>" }`; payload sem o que a ação exige,
`{ recebido: false, motivo: "sem_corpo" | "sem_pc" | "sem_revista" |
"sem_achados" | "achados_invalidos" }`. O mesmo `aviso_id` duas vezes:
`{ recebido: true, repetido: true }`, sem segundo cartão.

```
{ aviso_id, acao: "pedido"|"liberada"|"resultado"|"revelada"|"encerrada",
  corpo: { id, nome, sem_ficha, sorteado, fechado, foundry_ator_uuid },
  revista: { id, estado, total, total_origem, faixa },   // baixa|media|boa|alta
  pc: { id, nome, foundry_actor_id },                    // pode ser null
  pcs: [{ id, nome, foundry_actor_id }],
  achados: null | [ ... ],
  pegou: null | "Guldrum revistou Goblin e pegou: 3 po, Adaga" }
```

O que cada ação exige: `corpo.id` sempre; `pc.id` em todas menos `encerrada`;
`revista.id` em `liberada`, `resultado` e `revelada`; `achados` lista em
`revelada`.

`achados` em `resultado` (a visão do MESTRE): `{ id, tipo: "moedas"|"item",
quantidade, moedas, moedas_texto, nome, nome_real?, identificado, raridade,
tipo_item, subtipo, img, imagem_url, dano, tipo_dano, ca, alcance,
propriedades, peso, sintonia, descricao, fonte, quebra_regra, estado }`.

`achados` em `revelada` (a visão do JOGADOR): `{ id, tipo, quantidade, moedas:
{ pp, gp, ep, sp, cp }, decisao: null|"pegou"|"deixou", pego, nome,
identificado, raridade, tipo_item, subtipo, img, imagem_url, dano, tipo_dano,
ca, alcance, propriedades, peso, sintonia, descricao }`.

## O que o módulo garante sobre os dados

- **Todo texto de fora é escapado** nos cartões e na janela (nome do token,
  do personagem, do item, tipo, descrição, frase de erro). A descrição vira
  texto puro: as marcas de HTML saem, parágrafo e `<br>` viram quebra de linha.
- **A imagem** só entra se `imagem_url` for `https://…` ou se `img` for um
  caminho sem esquema (nada de `javascript:`, `data:` ou `//host`).
- **Nas flags dos cartões só vão ids** (`saque_cartao: { tipo, corpo_id,
  revista_id }`): o jogador lê as flags das mensagens que recebe.
- **Ao navegador do jogador vai só o que a janela usa** (`dadosDaJanela`): a
  lista de campos é fixa (o `nome_real`, a `fonte` e a `faixa` não passam), e
  o item não identificado vai só com `nome`, `tipo_item`, imagem e
  `descricao`, venha o que vier do Companion.
- **As moedas** são escritas pelo módulo a partir de `moedas`: pp → "pl",
  gp → "po", ep → "pe", sp → "pp", cp → "pc", nessa ordem, só as maiores que
  zero ("3 po, 8 pp").
- **`propriedades`** pode ser texto, lista (textos ou objetos com
  `nome`/`name`/`label`) ou objeto (as chaves verdadeiras e "chave: valor").

## A janela de pergaminho

É o MESMO pergaminho do Companion: as duas imagens e as fontes são cópias byte
a byte, e `styles/saque.css` repete a montagem de
`packages/shared/src/janelas/pergaminho.css` (a moldura é a `border-image` da
`borda.webp`, corte de 200, `round`, 56 px, ou 32 px até 1219 px de largura; o
papel em azulejo por dentro, lado = moldura × 6,27) e os `@font-face` de
`fontes/fontes.css`. Títulos em Mr Eaves Small Caps (versalete, sem
`uppercase`), o resto em Scaly Sans.

As tintas e o contraste sobre o pior ponto do papel (`#c79b5a`), calculados e
medidos na página por `qa/saque/capturar.mjs`:

| O quê | Cor | Contraste |
| --- | --- | --- |
| texto | `#120c07` | 7,64:1 |
| texto secundário, "Comum", "Não identificado" | `#332417` | 5,88:1 |
| títulos e rótulos | `#511200` | 5,75:1 |
| erro | `#5c1010` | 5,38:1 |
| Incomum | `#0b3a1e` | 5,04:1 |
| Raro | `#0c2f63` | 5,16:1 |
| Muito raro | `#3f1470` | 5,35:1 |
| Lendário | `#5a2600` | 4,83:1 |
| "Pegar": letra `#f6e7c6` no fundo `#511200` | | 11,95:1 (o fundo, 5,75:1 no papel) |
| "Deixar": letra `#24190f`, borda `#332417` | | 6,77:1 e 5,88:1 |
| foco: contorno de 3 px `#120c07` | | 7,64:1 |

O botão desligado (esperando o Mestre) fica a 55% e não entra na regra. No
toque (`pointer: coarse`), os botões têm 44 px.

## Como conferir fora do Foundry

- `npm test`: `test/saque.test.js` (30 testes) com o resto.
- `node qa/saque/simulado.mjs`: o fluxo inteiro em `saque-foundry.js` com um
  Foundry de mentira.
- `node qa/saque/capturar.mjs` (precisa do Playwright): as fotos em
  `qa/saque/capturas/` (1440×900, iPhone 390×844 e iPad 820×1180; os estados
  padrão, erro, espera, tudo decidido e o foco) e as medidas. A moldura em
  volta da folha (`.application`, `.window-header`, `.window-content`) é
  IMITAÇÃO na página de prova.

## HIPÓTESES (o que só o teste no Foundry responde)

1. **Os ganchos de morte com token SEM vínculo.** Que `dnd5e.damageActor` e
   `createActiveEffect` disparem para o ator sintético do token, e que o
   `parent` do efeito seja esse ator (com o `uuid` `Scene.x.Token.y.Actor.z`).
   Os tipos dizem que gatilhos de documentos embutidos não rodam dentro da
   operação do pai (`actor-delta.d.mts`). Teste: um token sem vínculo levado a
   0 PV, e outro marcado "morto" no HUD.
2. **O "morto" do HUD cria um ActiveEffect com `statuses` contendo `dead`**
   (e não só muda uma flag do token).
3. **O `content` do cartão guarda o `<button>` e os `data-*`** depois da
   limpeza de HTML do Foundry.
4. **O sussurro chega só a quem está na lista** (`whisper`), e o jogador
   desconectado vê o cartão ao entrar.
5. **O `renderChatMessageHTML` roda de novo** quando o conteúdo da mensagem é
   atualizado (o cartão "resolvido" não tem botões, então não depende disso) e
   para as mensagens antigas ao abrir o mundo (o botão de um cartão antigo
   volta a funcionar).
6. **Quem vê a rolagem de Investigação.** Ela sai no modo que o jogador
   escolher, como qualquer teste; o RESULTADO do saque é que fica só com o
   Mestre. Não foi conferido se o modo "só o GM" muda `rolls[0].total` visto
   pelo GM (não deveria: o GM vê toda rolagem).
7. **A mensagem da rolagem leva a nossa flag.** O código do dnd5e 5.3.3 funde
   `message.data.flags` (FATO, `actor.mjs:1312-1330`); não foi visto rodando.
   Se o jogador mudar a perícia ou o atributo no diálogo, o total é o que ele
   rolou.
8. **`User#query`** nos dois sentidos: do GM ao jogador (a janela) e do
   jogador ao GM ativo (o "Pegar"). O sentido GM → jogador já é usado na magia
   falada e na iniciativa (também sem teste registrado do sentido contrário).
   O handler não sabe QUEM perguntou: um jogador que saiba usar o console pode
   mandar "pegar" com ids de outra revista. Os ids são uuids que só o dono
   recebe, e a regra de quem pode pegar é do banco; é o mesmo nível de
   confiança da mesa.
9. **A ApplicationV2 da janela:** as classes `.application`, `.window-header`
   e `.window-content` em volta; que `window.contentClasses` ponha
   `cfb-saque-perg` na `.window-content`; que o `max-width`/`max-height` do
   CSS vençam a largura posta em linha; que a janela caiba e role no celular.
   O estilo do Foundry (e de outros módulos) para `button`, `h2`, `h3`, `dl` e
   `img` pode pesar sobre o nosso: os seletores têm dois níveis de classe, sem
   `!important`.
10. **O ícone `fa-solid fa-coins`** existe no Font Awesome do Foundry.
11. **O caminho de `img`** (do compêndio) abre a partir de
    `foundry.utils.getRoute(caminho)`.
12. **O foco depois de "Pegar":** a janela redesenha o miolo inteiro, e o foco
    do teclado se perde (volta ao começo). Não foi tratado.
13. **Dois GMs:** só o GM ATIVO manda e cria os cartões; o clique de outro GM
    num botão do Mestre responde "Só o Mestre ativo decide o saque.".
14. **A memória de mortes é do navegador:** recarregar a página (F5) esquece
    os corpos já avisados; o Companion responde `ja_existia` e nenhum cartão
    novo aparece. A criatura curada e derrubada de novo não avisa outra vez na
    mesma página.

## Decisões onde o pedido era ambíguo

- **Os textos do saque estão em português, direto em `scripts/saque.js`.** Só
  a configuração tem as duas línguas (`languages/`). O que vem do Companion
  (frases de recusa, `moedas_texto`, `pegou`) já chega em português.
- **Mais de um achado de moedas:** cada um ganha a sua linha, com o seu
  "Pegar as moedas" (o `achado_id` é de cada um). Com um só, é um botão só.
- **O título da janela do Foundry é fixo ("O saque")**; o nome do corpo vai no
  título de dentro, escapado.
- **Com a configuração desligada, o `saque.comando` é recusado**
  (`motivo: "desligado"`), além de nenhum aviso de morte sair. A mensagem da
  rolagem com a flag ainda é mandada (não nasce sem um cartão de antes).
- **`sem_sessao`/`desligado` em `saque.morreu`:** nada na tela, e o corpo é
  esquecido para o próximo sinal tentar de novo.
- **Revelado pelo Companion** (e não pelo botão do cartão): o cartão do
  resultado perde o botão do mesmo jeito.
- **A linha "tipo" do item não identificado** mostra só `tipo_item` (o
  `subtipo` poderia entregar o que é).
