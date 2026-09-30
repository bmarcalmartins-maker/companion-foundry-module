/**
 * Uma fila por chave (LOTE 08 · FVT-07): a próxima tarefa da mesma chave só
 * começa quando a anterior termina — deu certo ou não. Chaves diferentes
 * correm em paralelo.
 *
 * Até a v1.7 cada mensagem da ponte era tratada assim que chegava, sem esperar
 * a anterior: dois `actor.update` do mesmo personagem se intercalavam (apaga,
 * cria, apaga, cria), e o inventário mais VELHO podia terminar por último. O
 * Companion agora manda um envio por PC de cada vez; esta fila é a mesma regra
 * do lado de cá, para o que chegar junto mesmo assim.
 *
 * Pura, sem Foundry — `test/fila-por-ator.test.js`.
 */
export function criarFila() {
  /** @type {Map<string, Promise<void>>} */
  const filas = new Map();
  /**
   * @template T
   * @param {string} chave
   * @param {() => Promise<T> | T} tarefa
   * @returns {Promise<T>}
   */
  function enfileirar(chave, tarefa) {
    const anterior = filas.get(chave) ?? Promise.resolve();
    const esta = anterior.then(() => tarefa());
    // O fim desta tarefa (com ou sem erro) é o começo da próxima.
    const fim = esta.then(
      () => {},
      () => {},
    );
    filas.set(chave, fim);
    // Fila vazia sai do mapa: um personagem por chave, não um vazamento.
    fim.then(() => {
      if (filas.get(chave) === fim) filas.delete(chave);
    });
    return esta;
  }
  enfileirar.tamanho = () => filas.size;
  return enfileirar;
}
