/**
 * O PLANO de um envio do Companion para o inventário de um ator (LOTE 08 do
 * Raio-X; decisões do Bruno de 29/09: sintonia B, quantidade B, nativos A).
 * Puro, sem Foundry: recebe o que o ator tem e o que o Companion mandou, e
 * devolve o que criar, o que atualizar no lugar e o que apagar.
 * `bridge-client.js` só traduz os itens do Foundry para cá e executa o plano;
 * `test/plano-inventario.test.js` confere as regras.
 *
 * Regras:
 *  - Item que o ator já tem (mesmo crachá — o nativo do Foundry ou a cópia que
 *    este módulo criou) é ATUALIZADO NO LUGAR. Até a v1.7 as cópias eram
 *    apagadas e recriadas a cada envio: a sintonia feita no Foundry, as cargas
 *    e os usos sumiam, e o item ganhava id novo (FVT-04, FVT-05).
 *  - Equipado vai e volta como antes. Sintonia, cargas e usos são do Foundry:
 *    o envio não mexe neles (a sintonia, só por pedido NOVO do jogador no
 *    Companion: a regra SINTONIA, abaixo).
 *  - Quantidade: a do Companion só vale ao CRIAR. Depois, só o que o próprio
 *    Companion mudou (consumir, trocar, o Mestre editar), como DIFERENÇA: o
 *    envio traz o total acumulado dessas mudanças (`ajuste`) e o item guarda o
 *    total que já aplicou (`ajusteAplicado`). A poção gasta no Foundry não
 *    volta, e reenviar não aplica duas vezes (FVT-05 B). Sem `ajuste` no envio
 *    (Companion anterior ao LOTE 08) a quantidade não é tocada.
 *  - Na cópia deste módulo, nome e imagem acompanham o Companion (são dele).
 *    No nativo, só equipado e quantidade.
 *  - Apagar (FVT-06 A):
 *      · cópia deste módulo que o Companion não manda mais → sai (como sempre);
 *      · NATIVO com crachá só sai se o Companion disser que o item SAIU do
 *        personagem (`saidas`: descartado, consumido, trocado, dado a outro).
 *        Ausência não basta: crachá antigo, de antes deste envio, apontando para
 *        um item que o Companion já não tem, não é motivo para apagar do ator;
 *      · arma natural, magia e talento nunca (não são inventário).
 *  - Item sem crachá (o Companion não conhece) nunca é tocado.
 *  - Crachá repetido no ator: fica um (o nativo, se houver); as cópias deste
 *    módulo que sobram saem.
 *  - Crachá que o Foundry apagou há pouco (a volta ao Companion ainda não
 *    chegou) não é recriado.
 *  - IDENTIFICAÇÃO (1.18.0, ITEM NÃO IDENTIFICADO do Companion): o envio traz
 *    `identificacao` ({ identificado, versao }) e a fachada do dnd5e
 *    (`system.unidentified`). No item que já existe (nativo ou cópia), só a
 *    versão MAIS NOVA que a já aplicada (`identificacaoAplicada`, a flag; sem
 *    ela, 0) muda `identified` e a fachada: versão 0 (todo item na virada)
 *    nunca mexe no que o Foundry tem, e um envio velho não desfaz o que o GM
 *    fez aqui depois. Mesmo modelo do `ajuste`.
 *  - SINTONIA (1.26.0): o envio traz `sintonia` ({ exige, pedido, versao }).
 *    `pedido` é o que o jogador pediu NO COMPANION (sintonizar ou desfazer) e
 *    `versao` sobe a cada pedido. No item que já existe, só o pedido MAIS NOVO
 *    que o já aplicado (`sintoniaAplicada`, a flag; sem ela, 0) muda
 *    `system.attuned`. Sem pedido (`pedido` nulo, `versao` 0) ou com pedido
 *    velho, a sintonia continua do Foundry: o envio não mexe nela.
 *    O LIMITE (`limite`, o `attunement.max` do ator; sem ele, 3) é imposto
 *    aqui, porque o dnd5e 5.3.3 só conta: o pedido de sintonizar que não cabe
 *    NÃO sintoniza, marca a versão como aplicada (não tenta de novo) e sai com
 *    `sintoniaBarrada` (quem executa avisa o GM). Os "desfazer" e os itens que
 *    saem neste mesmo envio liberam vaga antes de qualquer "sintonizar".
 *    Na CASCA deste módulo (cópia sem a marca `compendio`), o pedido leva
 *    junto `system.attunement` e a propriedade "mgc": sem "mgc" o dnd5e apaga
 *    a sintonia no preparo (EquippableItemTemplate.prepareFinalEquippableData).
 *  - EFEITOS DO MESTRE (1.26.0): item cujos bônus o Mestre escreveu no
 *    Companion traz `efeitos` ({ versao }) e a lista `efeitosNovos`. Versão
 *    mais nova que a aplicada (`efeitosAplicada`; sem ela, 0): saem do item os
 *    efeitos marcados `do_companion` (na casca que já recebeu efeitos do
 *    Companion, também os outros de transferência), entram os novos, e
 *    `system.attunement`, `system.rarity`, "mgc" e o "+N" mágico
 *    (`system.magicalBonus`, em `bonusMagico`) acompanham.
 *
 * @typedef {{ id: string, cracha: string|null, synced: boolean, sincronizavel: boolean,
 *   temEquipado: boolean, equipado?: boolean, temQuantidade: boolean, quantidade?: number,
 *   ajusteAplicado?: number, nome?: string, img?: string, temIdentificacao?: boolean,
 *   identificado?: boolean, identificacaoAplicada?: number,
 *   temSintonia?: boolean, sintonizado?: boolean, sintoniaAplicada?: number,
 *   exigeSintonia?: string, raridade?: string, propriedades?: string[], compendio?: boolean,
 *   bonusMagico?: number|null, efeitosAplicada?: number,
 *   efeitos?: { id: string, doCompanion: boolean, transfer: boolean }[] }} Existente
 * @typedef {{ cracha: string|null, equipado?: boolean, quantidade?: number, ajuste?: number,
 *   nome?: string, img?: string, identificacao?: { identificado?: boolean, versao?: number },
 *   fachada?: { name?: string, description?: string },
 *   sintonia?: { exige?: string, pedido?: boolean|null, versao?: number },
 *   efeitos?: { versao?: number }, efeitosNovos?: object[],
 *   exigeSintonia?: string, raridade?: string, mgc?: boolean, bonusMagico?: number, dados: object }} Recebido
 * @typedef {{ _id: string, equipado?: boolean, quantidade?: number, ajusteAplicado?: number,
 *   nome?: string, img?: string, identificado?: boolean,
 *   fachada?: { name?: string, description?: string }, identificacaoAplicada?: number,
 *   sintonizado?: boolean, sintoniaAplicada?: number, sintoniaBarrada?: true,
 *   exigeSintonia?: string, raridade?: string, propriedades?: string[], bonusMagico?: number|null,
 *   efeitos?: { apagar: string[], criar: object[] }, efeitosAplicada?: number }} Atualizacao
 *
 * O item NOVO com pedido de sintonia sai em `criar` como CÓPIA do recebido com
 * `sintonizar` (true ou false: o que gravar em `system.attuned`) e, se o limite
 * barrou, `sintoniaBarrada: true`. Sem pedido, é o próprio recebido.
 */

/** O limite de sintonia do dnd5e quando o ator não diz o dele. */
export const LIMITE_DE_SINTONIA = 3;

/** O pedido de sintonia do Companion vale? Booleano, com versão inteira acima de 0. */
export function pedidoDeSintonia(sintonia) {
  return !!sintonia && typeof sintonia.pedido === "boolean" && Number.isInteger(sintonia.versao) && sintonia.versao > 0;
}

/**
 * A DECISÃO de um pedido de sintonia, pura:
 *   `sintonizar`: true ou false = gravar em `system.attuned`; nulo = não mexer;
 *   `barrado`: o pedido era sintonizar e o ator já está no limite.
 * `sintonizados` conta os itens do ator com `system.attuned === true` AGORA
 * (os deste mesmo envio já aplicados entram na conta de quem chama).
 */
export function decidirSintonia({ pedido, jaSintonizado = false, sintonizados = 0, limite = LIMITE_DE_SINTONIA }) {
  if (typeof pedido !== "boolean" || pedido === !!jaSintonizado) return { sintonizar: null, barrado: false };
  if (!pedido) return { sintonizar: false, barrado: false };
  const teto = Number.isFinite(limite) && limite >= 0 ? limite : LIMITE_DE_SINTONIA;
  const quantos = Number.isFinite(sintonizados) ? sintonizados : 0;
  if (quantos >= teto) return { sintonizar: null, barrado: true };
  return { sintonizar: true, barrado: false };
}

/** O aviso ao GM quando o limite barra um pedido (texto de tela: curto, em português). */
export function fraseDoLimiteDeSintonia(ator, limite, item) {
  const n = Number.isFinite(limite) && limite >= 0 ? limite : LIMITE_DE_SINTONIA;
  return `${ator || "Personagem"}: limite de ${n} ${n === 1 ? "item sintonizado" : "itens sintonizados"}. ${item || "O item"} não foi sintonizado.`;
}

/** Imagem que vale levar ao item: do Companion e não um ícone genérico do Foundry. */
function imagemDoCompanion(img) {
  return typeof img === "string" && img !== "" && !img.startsWith("icons/svg/");
}

/**
 * @param {{ existentes: Existente[], recebidos: Recebido[], saidas?: Set<string>,
 *   apagadosHaPouco?: Set<string>, limite?: number }} entrada
 * @returns {{ criar: Recebido[], atualizar: Atualizacao[], apagar: string[] }}
 */
export function planejarInventario({ existentes, recebidos, saidas = new Set(), apagadosHaPouco = new Set(), limite = LIMITE_DE_SINTONIA }) {
  // Um existente por crachá: o nativo ganha da cópia; as cópias a mais saem.
  const porCracha = new Map();
  const apagar = [];
  for (const e of existentes) {
    if (!e.cracha) {
      // Cópia deste módulo sem crachá não deveria existir: é sobra de versão velha.
      if (e.synced) apagar.push(e.id);
      continue;
    }
    const atual = porCracha.get(e.cracha);
    if (!atual) {
      porCracha.set(e.cracha, e);
    } else if (atual.synced && !e.synced) {
      apagar.push(atual.id);
      porCracha.set(e.cracha, e);
    } else if (e.synced) {
      apagar.push(e.id);
    }
    // Dois NATIVOS com o mesmo crachá: o segundo fica como está (não é cópia
    // deste módulo) e o primeiro é o que acompanha o Companion.
  }

  const criar = [];
  const mudancas = [];
  const mandados = new Set();
  // A sintonia: os "sintonizar" esperam o fim (as vagas que este envio libera
  // contam antes), na ordem em que vieram.
  const aSintonizar = []; // { alvo: a mudança ou a cópia do recebido novo, novo: boolean }
  let liberados = 0;
  for (const r of recebidos) {
    if (r.cracha) mandados.add(r.cracha);
    const e = r.cracha ? porCracha.get(r.cracha) : null;
    if (!e) {
      if (r.cracha && apagadosHaPouco.has(r.cracha)) continue;
      if (pedidoDeSintonia(r.sintonia)) {
        const novo = { ...r, sintonizar: false };
        if (r.sintonia.pedido) aSintonizar.push({ alvo: novo, novo: true });
        criar.push(novo);
      } else {
        criar.push(r);
      }
      continue;
    }
    /** @type {Atualizacao} */
    const mudanca = { _id: e.id };
    if (e.temEquipado && typeof r.equipado === "boolean" && r.equipado !== e.equipado) {
      mudanca.equipado = r.equipado;
    }
    if (Number.isFinite(r.ajuste)) {
      if (Number.isFinite(e.ajusteAplicado)) {
        const diferenca = r.ajuste - e.ajusteAplicado;
        if (diferenca !== 0 && e.temQuantidade && Number.isFinite(e.quantidade)) {
          mudanca.quantidade = Math.max(0, e.quantidade + diferenca);
        }
      }
      // Sem `ajusteAplicado` (item de antes do LOTE 08) só marca a base: o que
      // o Companion mudou antes já foi imposto pelo envio antigo.
      if (e.ajusteAplicado !== r.ajuste) mudanca.ajusteAplicado = r.ajuste;
    }
    const ident = r.identificacao;
    const aplicada = Number.isFinite(e.identificacaoAplicada) ? e.identificacaoAplicada : 0;
    if (e.temIdentificacao && Number.isFinite(ident?.versao) && ident.versao > aplicada) {
      if (typeof ident.identificado === "boolean" && ident.identificado !== e.identificado) {
        mudanca.identificado = ident.identificado;
      }
      if (r.fachada && typeof r.fachada === "object") mudanca.fachada = r.fachada;
      mudanca.identificacaoAplicada = ident.versao;
    }
    if (e.synced) {
      if (r.nome && r.nome !== e.nome) mudanca.nome = r.nome;
      if (imagemDoCompanion(r.img) && r.img !== e.img) mudanca.img = r.img;
    }
    const casca = e.synced && !e.compendio;
    const propriedades = Array.isArray(e.propriedades) ? e.propriedades : [];
    const comMgc = () => {
      if (r.mgc === true && !propriedades.includes("mgc")) mudanca.propriedades = [...propriedades, "mgc"];
    };
    const sintoniaJaAplicada = Number.isFinite(e.sintoniaAplicada) ? e.sintoniaAplicada : 0;
    if (e.temSintonia && pedidoDeSintonia(r.sintonia) && r.sintonia.versao > sintoniaJaAplicada) {
      const pedido = r.sintonia.pedido;
      if (pedido && !e.sintonizado) aSintonizar.push({ alvo: mudanca, novo: false });
      else if (!pedido && e.sintonizado) {
        mudanca.sintonizado = false;
        liberados += 1;
      }
      mudanca.sintoniaAplicada = r.sintonia.versao;
      if (casca) {
        if (typeof r.exigeSintonia === "string" && r.exigeSintonia !== e.exigeSintonia) mudanca.exigeSintonia = r.exigeSintonia;
        comMgc();
      }
    }
    const efeitosJaAplicada = Number.isFinite(e.efeitosAplicada) ? e.efeitosAplicada : 0;
    if (Number.isInteger(r.efeitos?.versao) && r.efeitos.versao >= 1 && r.efeitos.versao > efeitosJaAplicada && Array.isArray(r.efeitosNovos)) {
      // Na casca que já recebeu efeitos do Companion, todo efeito de
      // transferência veio dele (mesmo o que perdeu a marca): sai também.
      const tudoDoCompanion = casca && Number.isFinite(e.efeitosAplicada);
      const velhos = (Array.isArray(e.efeitos) ? e.efeitos : []).filter((ef) => ef?.id && (ef.doCompanion || (tudoDoCompanion && ef.transfer)));
      mudanca.efeitos = { apagar: velhos.map((ef) => ef.id), criar: r.efeitosNovos };
      if (typeof r.exigeSintonia === "string" && r.exigeSintonia !== e.exigeSintonia) mudanca.exigeSintonia = r.exigeSintonia;
      if (typeof r.raridade === "string" && r.raridade !== e.raridade) mudanca.raridade = r.raridade;
      // O "+N" mágico (`system.magicalBonus`, 1 a 5): o do envio, quando difere
      // do item. Envio SEM o campo: na casca do módulo o bônus que ela tinha
      // sai (o Mestre tirou o +N); no nativo e no do compêndio fica o deles.
      const bonusDoItem = Number.isFinite(e.bonusMagico) ? e.bonusMagico : 0;
      if (Number.isFinite(r.bonusMagico)) {
        if (r.bonusMagico !== bonusDoItem) mudanca.bonusMagico = r.bonusMagico > 0 ? r.bonusMagico : null;
      } else if (casca && bonusDoItem !== 0) {
        mudanca.bonusMagico = null;
      }
      comMgc();
      mudanca.efeitosAplicada = r.efeitos.versao;
    }
    mudancas.push(mudanca);
  }

  for (const [cracha, e] of porCracha) {
    if (mandados.has(cracha)) continue;
    if (e.synced) apagar.push(e.id);
    else if (e.sincronizavel && saidas.has(cracha)) apagar.push(e.id);
  }

  // O limite: quem fica no ator e está sintonizado, menos os desfeitos agora.
  if (aSintonizar.length) {
    const saem = new Set(apagar);
    let sintonizados = existentes.filter((e) => e.sintonizado === true && !saem.has(e.id)).length - liberados;
    for (const { alvo, novo } of aSintonizar) {
      const { sintonizar, barrado } = decidirSintonia({ pedido: true, jaSintonizado: false, sintonizados, limite });
      if (sintonizar) {
        sintonizados += 1;
        if (novo) alvo.sintonizar = true;
        else alvo.sintonizado = true;
      } else if (barrado) {
        alvo.sintoniaBarrada = true;
      }
    }
  }
  const atualizar = mudancas.filter((m) => Object.keys(m).length > 1);
  return { criar, atualizar, apagar };
}
