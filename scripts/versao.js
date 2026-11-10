/**
 * A versão DESTE código (v1.24.0). O release carimba este arquivo junto com o
 * module.json (.github/workflows/release.yml), e o teste confere que os dois
 * batem no repositório.
 *
 * Por que existe: o Foundry entrega os arquivos do módulo com cache de 4 h
 * (cache-control max-age=14400, achado do teste de 07/11). O navegador que já
 * tinha aberto a mesa continua com o código velho depois da atualização. A
 * versão que o Foundry diz ter instalada (`game.modules`) vem do SERVIDOR; esta
 * vem do CÓDIGO que o navegador carregou. Diferentes = código velho no cache.
 */
export const VERSAO_DO_CODIGO = "1.25.0";
