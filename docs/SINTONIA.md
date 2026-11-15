# A sintonia e os efeitos vindos do Companion (módulo 1.26.0)

Até a 1.25.0 a sintonia era só do Foundry: o envio do Companion nunca mexia em
`system.attuned`, e o item feito à mão no Companion chegava como casca, sem
jeito de trocar os bônus depois de criado. Desde a 1.26.0:

- o jogador sintoniza (ou desfaz) NO COMPANION e o pedido chega ao item do
  Foundry, respeitando o limite do personagem;
- os bônus que o MESTRE escreveu no Companion viajam como ActiveEffects e são
  trocados no lugar quando ele os muda.

⚠️ **Ninguém testou isto no Foundry de verdade.** O que está conferido é o
código do dnd5e 5.3.3 (os FATOS abaixo) e os testes com um Foundry de mentira.
O que só o Foundry aberto responde está em "HIPÓTESES".

## Os arquivos

| Arquivo | O que é |
| --- | --- |
| `scripts/plano-inventario.js` | As regras, PURAS: `planejarInventario` (a sintonia e os efeitos por versão), `decidirSintonia` (o limite), `pedidoDeSintonia`, `fraseDoLimiteDeSintonia`. Testado em `test/plano-inventario.test.js`. |
| `scripts/bridge-client.js` | Traduz o ator e o envio para o plano e executa: `#updateActorSegurado`, `#prepareItems`, `#resolveFromCompendium`, `paraDocumento`. A cola é testada em `test/bridge-client.test.js`. |
| `scripts/equip-sync.js` | A volta, sem mudança: `agendarEstado` (`item.estado`, com `attuned` e `attunement`) e `reportItemEffects` (`item.effects`). |

## FATOS do dnd5e 5.3.3 (lidos no código do sistema)

- `Item5e#areEffectsSuppressed`: o efeito é suprimido se o item (não
  consumível) está com `system.equipped === false`, ou se
  `!system.attuned && system.attunement === "required"`.
- `EquippableItemTemplate.prepareFinalEquippableData`: item cujo tipo aceita a
  propriedade `mgc` e não a tem fica com `attunement = ""`; e sem `attunement`,
  `attuned = false`. Ou seja: **sem "mgc" o item perde a sintonia no preparo.**
  Por isso o Companion manda `system.properties: ["mgc"]` na casca que exige
  sintonia ou tem efeito.
- `actor.system.attributes.attunement.max` (3 de início) e `.value` (contado no
  preparo). O sistema só conta: **quem barra o limite é o módulo.**

## O contrato (campos NOVOS de cada item do `actor.update`)

O módulo antigo ignora todos.

```
flags["companion-foundry-bridge"].sintonia = {
  exige:  "required" | "optional" | "",
  pedido: true | false | null,     // o que o jogador pediu NO COMPANION
  versao: <inteiro ≥ 0>            // sobe a cada pedido
}
flags["companion-foundry-bridge"].efeitos = { versao: <inteiro ≥ 1> }
```

- **`sintonia`**: `pedido: null` ou `versao: 0` = o Companion nunca pediu nada,
  e o módulo não mexe em `system.attuned`. No item que exige sintonia o
  Companion manda `system.attunement`; quando `pedido` é booleano, manda também
  `system.attuned`.
- **`sintonia` vai em TODO item** (`{ exige: "", pedido: null, versao: 0 }`
  quando não há nada), e `system.attunement` vai também no item SEM
  `flags.efeitos` (o do compêndio ou do catálogo que exige sintonia). Sem
  pedido novo e sem `flags.efeitos`, nada do item que já existe muda (testado:
  nem `system.attunement`, nem `"mgc"`, nem a raridade, nem o "+N").
- **`efeitos`**: só existe no item cujos bônus o MESTRE escreveu no Companion
  (item feito à mão) ou que tem "+N" mágico (`system.magicalBonus`, 1 a 5, em
  arma e equipamento). Esse item traz também:
  - `effects: [...]`, ActiveEffects no formato do dnd5e 5.3: `name`,
    `type: "base"`, `disabled: false`, `transfer: true`,
    `system: { changes: [{ key, type, value, phase, priority }] }`,
    `flags: { "companion-foundry-bridge": { do_companion: true } }`;
  - `system.attunement` (`"required"`, `"optional"` ou `""`), `system.rarity` e
    `system.properties` (com `"mgc"` quando há sintonia ou efeito).

O que o módulo grava no item do Foundry (flags do módulo):
`sintonia_aplicada` (a versão do último pedido aplicado) e `efeitos_aplicada`
(a versão dos efeitos que estão no item). É o mesmo modelo de
`identificacao_aplicada` e de `ajuste_aplicado`.

## O que o módulo faz

### Item NOVO, casca (sem match no compêndio)

Vai inteiro, como sempre (com `effects`, `system.attunement`, `system.rarity`,
`system.properties`). Nasce com `sintonia_aplicada = sintonia.versao` e
`efeitos_aplicada = efeitos.versao` (quando vieram), para o envio seguinte não
reaplicar. Se há pedido de sintonia, `system.attuned` nasce com a DECISÃO do
plano: o pedido, ou `false` se o limite barrou.

### Item com `flags.efeitos`: não passa pelo compêndio

Os bônus do Mestre valem. `#prepareItems` pula o `#resolveFromCompendium`
mesmo com `compendium_hint` apontando para um item que existe. O item fica
casca (sem a flag `compendio`).

### Item NOVO resolvido pelo compêndio

Se há pedido (`pedido` booleano, `versao > 0`) e o dado do compêndio tem
`system.attuned`, ele recebe a decisão do plano (com o limite), e o item nasce
com `sintonia_aplicada`. Sem pedido, fica o que o compêndio tem.

### Item que JÁ EXISTE (mesmo crachá)

No plano (`planejarInventario`), por versão:

- **Sintonia.** `sintonia.versao` maior que `sintonia_aplicada` (sem a flag,
  0) e `pedido` booleano: `system.attuned = pedido` e a flag sobe. Pedido que
  já bate com o Foundry só marca a versão. Sem pedido novo, **a sintonia
  continua nunca sendo tocada**: um envio velho não desfaz o que o GM fez no
  Foundry depois. Item sem o campo `system.attuned` (tesouro, por exemplo):
  nada.
  Na CASCA do módulo (cópia sem a flag `compendio`), o pedido leva junto
  `system.attunement` do envio e acrescenta `"mgc"` se o envio trouxer: a
  casca criada antes da 1.26.0 nasceu sem os dois, e o dnd5e desfaria a
  sintonia no preparo.
- **Efeitos.** `efeitos.versao` maior que `efeitos_aplicada` (sem a flag, 0) e
  `effects` em lista:
  1. saem do item os ActiveEffects com a flag `do_companion`; na casca do
     módulo que JÁ recebeu efeitos por versão (tem `efeitos_aplicada`), saem
     também os outros efeitos de transferência (`transfer !== false`);
  2. entram os de `effects` (lista vazia: os bônus do Mestre só saem);
  3. `system.attunement` e `system.rarity` acompanham o envio, e
     `system.properties` só ganha `"mgc"` (nada é tirado);
  4. o "+N" mágico: `system.magicalBonus` do envio (1 a 5), quando difere do
     item. Envio SEM o campo: na casca do módulo o bônus que ela tinha volta a
     nulo (o Mestre tirou o +N); no nativo e no item do compêndio fica o deles;
  5. `efeitos_aplicada` sobe.

  O item com "+N" e sem bônus escritos pelo Mestre chega com
  `flags.efeitos = { versao }`, `effects: []`, `system.magicalBonus = N` e
  `system.properties: ["mgc"]` (`aplicarSintoniaEBonus`, em
  `supabase/functions/push-to-foundry/mapping.ts` do repositório principal):
  é a mesma troca, com a lista de efeitos vazia. O "+N" SÓ muda quando a
  versão dos efeitos sobe: a mesma versão com outro número não mexe.

  A troca dos efeitos é feita ANTES de gravar a versão. Se ela falha naquele
  item, a versão não é gravada (o próximo envio tenta de novo) e o resto do
  envio segue.

Toda escrita leva `{ companionBridge: true }`. Os itens tocados entram em
`agendarEstado` (a volta `item.estado`, com `attuned` e `attunement` REAIS), e
os que tiveram os efeitos trocados, em `reportItemEffects` (`item.effects`).

### O limite de sintonia

Ao aplicar `pedido === true` num item que ainda não está sintonizado, se o
número de itens do ator com `system.attuned === true` já é
`actor.system.attributes.attunement.max` (sem ele, 3) ou mais:

- o item NÃO é sintonizado;
- `sintonia_aplicada` é gravada mesmo assim (não tenta de novo a cada envio;
  o jogador pede de novo no Companion, com versão nova);
- o GM recebe o aviso (`ui.notifications.warn`): "<Ator>: limite de N itens
  sintonizados. <Item> não foi sintonizado.";
- a volta (`item.estado`) leva `attuned: false`, e o Companion se corrige.

A conta (`decidirSintonia`, pura e testada) inclui: todo item do ator
sintonizado, com ou sem crachá; os sintonizados neste mesmo envio, na ordem em
que vieram; MENOS os "desfazer" deste envio e os itens que saem do ator nele
(as vagas liberadas valem mesmo que venham depois na lista).

## HIPÓTESES (o que só o teste no Foundry responde)

1. **`item.createEmbeddedDocuments("ActiveEffect", ...)` e
   `item.deleteEmbeddedDocuments("ActiveEffect", ids)` no item EMBUTIDO do
   ator** funcionam no v14 com os dados que o Companion manda (`type: "base"`,
   `system.changes` com `phase` e `priority`). O módulo já usa as duas
   chamadas em `canonico-foundry.js`; não há registro de teste no Foundry com
   este formato de efeito.
2. **O efeito passa a valer ao sintonizar.** Que, com `system.attuned: true`,
   `system.attunement: "required"`, `"mgc"` nas propriedades e o item equipado,
   o bônus apareça na ficha (a CA, por exemplo) sem recarregar; e que desfazer
   a sintonia o tire.
3. **A casca nasce com os efeitos.** Que `actor.createEmbeddedDocuments("Item",
   [{ ..., effects: [...] }])` crie os ActiveEffects embutidos junto com o
   item (é assim que a casca com efeito já ia até a 1.25.0; não há registro de
   teste).
4. **`system.properties` aceita a lista** na atualização (`["foc", "mgc"]`) e
   guarda como o Set do dnd5e; e `i._source.system.properties` é a lista
   guardada (o módulo lê de lá para não perder as outras propriedades).
5. **`"mgc"` vale para todo tipo de item que o Companion manda.** O FATO é
   sobre tipos cujo `validProperties` tem `mgc`. Num tipo que não o aceita, o
   dnd5e não apaga a sintonia por isso; não foi conferido tipo a tipo.
5b. **`system.magicalBonus` vale em `equipment` além de `weapon` no dnd5e
   5.3.3.** FATO do espelho do compêndio: 295 itens têm o campo. Se o sistema
   soma o "+N" à CA de uma armadura ou escudo (e ao ataque e ao dano da arma)
   só por esse campo, sem ActiveEffect, e se o campo é aceito nos dois tipos,
   não foi conferido no código do sistema nem no Foundry. Também HIPÓTESE:
   que gravar `system.magicalBonus: null` limpe o bônus (o campo aceitar
   nulo).
6. **A opção `companionBridge` chega aos ganchos de efeito**
   (`createActiveEffect`, `deleteActiveEffect`) quando passada nas chamadas do
   item. Hoje nenhum gancho de efeito do módulo a lê (`live-sync.js` reenvia
   os efeitos do item de propósito, e a assinatura evita o envio repetido).
7. **O `attuned: true` gravado pela ponte não é desfeito por outro módulo ou
   pelo próprio dnd5e** numa atualização seguinte (o `prepare` só muda o dado
   preparado, não o guardado; não foi visto rodando).
8. **`actor.system.attributes.attunement.max` é o limite que a mesa usa.** Se
   um efeito ou talento mudar o máximo, o módulo lê o valor PREPARADO do ator
   na hora do envio.
9. **A volta fecha a conta.** Que o `item.estado` com `attuned: false` do item
   barrado faça o Companion mostrar "não sintonizado" (é do lado do Companion;
   aqui só se conferiu que o estado sai com o valor real).
10. **Duas trocas de efeito seguidas** (o Mestre editando o bônus várias vezes
    em poucos segundos): os envios do mesmo ator entram em fila
    (`fila-por-ator.js`), e cada um compara a versão; não foi visto com o
    Foundry de verdade.

## Decisões onde o pedido era ambíguo

- **"Os outros efeitos de transferência … vindos de um envio anterior com a
  flag".** Lido assim: na casca do módulo (sem `compendio`) que JÁ tem
  `efeitos_aplicada`, todo efeito de transferência veio do Companion, e sai
  junto com os marcados `do_companion`. Na casca criada pela 1.25.0 (sem
  `efeitos_aplicada`), no item nativo e no do compêndio, só saem os marcados:
  um efeito que o GM pôs à mão não é apagado na primeira troca.
- **No nativo e no item do compêndio, os efeitos do Mestre entram AO LADO**
  dos que o item já tinha (só os `do_companion` são trocados).
- **`flags.efeitos` sem `effects` em lista: não mexe.** Para tirar todos os
  bônus, o Companion manda `effects: []`.
- **O pedido de sintonia na casca leva `system.attunement` e `"mgc"`** (não
  estava no pedido): sem isso a casca de antes da 1.26.0 perderia a sintonia
  no preparo do dnd5e.
- **O limite vale também para o item NOVO** (a casca e o do compêndio), não só
  para o que já existe. No `actor.create` (o ator inteiro criado de uma vez)
  o limite NÃO é conferido: os itens vão como o Companion mandou.
- **`sintonia_aplicada` no item novo é gravada com qualquer versão inteira**
  (a 0 também): não muda nada, e deixa visível que o item nasceu na 1.26.0.
- **O limite barra e marca a versão.** O jogador que liberar uma vaga depois
  precisa pedir de novo no Companion (versão nova); o módulo não guarda fila
  de pedidos barrados.
- **A ordem dos pedidos no mesmo envio** é a da lista de itens do Companion:
  com uma vaga e dois pedidos, ganha o que vem primeiro.
