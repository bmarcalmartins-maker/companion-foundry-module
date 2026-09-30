/**
 * Como a pista de compêndio (`compendium_hint`) do Companion vira busca no
 * índice do Foundry. Puro — `test/casar-compendio.test.js`.
 *
 * Ordem (LOTE 08 · FVT-15):
 *  1. `uuid` — o item exato escolhido no espelho do compêndio. Quem resolve é
 *     o bridge-client (fromUuid); aqui só se diz se a pista tem um.
 *  2. `source_key` SEM o prefixo da fonte: o catálogo do Companion guarda
 *     "srd-2024_amulet-of-health", e o índice do Foundry conhece
 *     "amulet-of-health". Com o prefixo nunca casava.
 *  3. `source_key` inteiro (como até a v1.7) e o nome.
 * Casamento exato: equipar o item errado é pior que a casca.
 */

/** Nome → chave do índice: minúsculas, sem acento, espaços viram hífen. */
export function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "srd-2024_amulet-of-health" → "amulet-of-health". Sem prefixo, fica igual. */
export function semPrefixoDaFonte(chave) {
  return String(chave ?? "").replace(/^[a-z0-9-]+_/i, "");
}

/** uuid de compêndio que vale tentar (fromUuid). */
export function uuidDoHint(hint) {
  const uuid = hint?.uuid;
  return typeof uuid === "string" && uuid.startsWith("Compendium.") ? uuid : null;
}

/** As chaves a procurar no índice, em ordem, sem repetir. */
export function chavesDoHint(hint) {
  const chaves = [];
  const soma = (v) => {
    const s = slugify(v);
    if (s && !chaves.includes(s)) chaves.push(s);
  };
  if (hint?.source_key) {
    soma(semPrefixoDaFonte(hint.source_key));
    soma(hint.source_key);
  }
  if (hint?.name) soma(hint.name);
  return chaves;
}
