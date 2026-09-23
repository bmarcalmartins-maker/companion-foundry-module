/**
 * ActiveEffect ENXUTO — o formato em que os efeitos viajam para o Companion.
 *
 * O efeito inteiro do Foundry (`toObject()`) carrega descrição em HTML, arte e
 * flags de dae/midi-qol/ddbimporter: KBs por efeito, e é isso que estourava o
 * teto da edge. O Companion só lê nome, se está desligado, se passa para o
 * personagem e as mudanças (`packages/shared/src/lib/foundry-effects.ts`,
 * `parseEffects`) — então só isso vai.
 *
 * Mesmo shape que o Companion já lê: as mudanças em `system.changes`.
 */
export function efeitoEnxuto(effect) {
  let raw = null;
  try {
    raw = effect.toObject();
  } catch {
    raw = null;
  }
  const changes = raw?.system?.changes ?? raw?.changes ?? effect?.changes ?? [];
  return {
    _id: effect.id,
    name: effect.name ?? null,
    disabled: effect.disabled === true,
    transfer: effect.transfer !== false,
    // `active` é o veredito do próprio Foundry (desligado OU suprimido = false).
    active: typeof effect.active === "boolean" ? effect.active : undefined,
    system: {
      changes: (Array.isArray(changes) ? changes : []).map((c) => ({
        key: c?.key,
        type: c?.type,
        mode: c?.mode,
        value: c?.value,
      })),
    },
  };
}

/**
 * Chave de comparação de uma lista de efeitos: o CONTEÚDO, sem o `_id`.
 * O bridge apaga e recria os itens synced a cada mudança de inventário, e o
 * efeito recriado ganha id novo — com o id na chave, todo push reenviaria tudo.
 */
export function assinaturaDosEfeitos(effects) {
  return JSON.stringify(effects.map(({ _id, ...resto }) => resto));
}
