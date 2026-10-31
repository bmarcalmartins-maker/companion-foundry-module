/**
 * As outras edges do Companion (1.21.0), com a mesma chave de entrada: a URL é
 * a da foundry-inbound (configuração "inboundUrl") com o nome trocado. Pura
 * (test/combate-estado.test.js).
 */
export function urlDaRota(urlDaEntrada, rota) {
  const u = String(urlDaEntrada ?? "").trim();
  if (!/\/foundry-inbound\/?$/.test(u)) return null;
  return u.replace(/\/foundry-inbound\/?$/, `/${rota}`);
}
