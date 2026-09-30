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
 *    o envio nunca mexe neles.
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
 *
 * @typedef {{ id: string, cracha: string|null, synced: boolean, sincronizavel: boolean,
 *   temEquipado: boolean, equipado?: boolean, temQuantidade: boolean, quantidade?: number,
 *   ajusteAplicado?: number, nome?: string, img?: string }} Existente
 * @typedef {{ cracha: string|null, equipado?: boolean, quantidade?: number, ajuste?: number,
 *   nome?: string, img?: string, dados: object }} Recebido
 * @typedef {{ _id: string, equipado?: boolean, quantidade?: number, ajusteAplicado?: number,
 *   nome?: string, img?: string }} Atualizacao
 */

/** Imagem que vale levar ao item: do Companion e não um ícone genérico do Foundry. */
function imagemDoCompanion(img) {
  return typeof img === "string" && img !== "" && !img.startsWith("icons/svg/");
}

/**
 * @param {{ existentes: Existente[], recebidos: Recebido[], saidas?: Set<string>,
 *   apagadosHaPouco?: Set<string> }} entrada
 * @returns {{ criar: Recebido[], atualizar: Atualizacao[], apagar: string[] }}
 */
export function planejarInventario({ existentes, recebidos, saidas = new Set(), apagadosHaPouco = new Set() }) {
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
  const atualizar = [];
  const mandados = new Set();
  for (const r of recebidos) {
    if (r.cracha) mandados.add(r.cracha);
    const e = r.cracha ? porCracha.get(r.cracha) : null;
    if (!e) {
      if (r.cracha && apagadosHaPouco.has(r.cracha)) continue;
      criar.push(r);
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
    if (e.synced) {
      if (r.nome && r.nome !== e.nome) mudanca.nome = r.nome;
      if (imagemDoCompanion(r.img) && r.img !== e.img) mudanca.img = r.img;
    }
    if (Object.keys(mudanca).length > 1) atualizar.push(mudanca);
  }

  for (const [cracha, e] of porCracha) {
    if (mandados.has(cracha)) continue;
    if (e.synced) apagar.push(e.id);
    else if (e.sincronizavel && saidas.has(cracha)) apagar.push(e.id);
  }
  return { criar, atualizar, apagar };
}
