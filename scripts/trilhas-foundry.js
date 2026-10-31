import { MODULE_ID } from "./settings.js";
import { postInbound } from "./equip-sync.js";
import { PASTA_PADRAO, criarConferenciaDeArquivo, criarMusica } from "./trilhas.js";
import { EXTENSOES_DE_AUDIO, criarAcervo, medirComAudio } from "./acervo.js";

/**
 * A MÚSICA ligada ao Foundry (v1.19.0; as regras em trilhas.js).
 *
 * - No GM ATIVO (bridge-client.js, op `audio.comando`): `receberComandoDeAudio`.
 * - Nos ganchos da playlist (o GM ativo): o que o próprio Foundry mudou (o GM
 *   tocou ou parou um som, a faixa acabou) vai ao Companion, juntado em 0,8 s.
 * - Ao abrir o mundo: o que toca agora.
 *
 * O resultado volta pela entrada de sempre (`op: "trilha.resultado"`), só do
 * navegador do GM, que é o que tem a chave de entrada.
 *
 * O ACERVO (1.20.0, acervo.js): o pedido "listar" lista a pasta das trilhas
 * inteira e manda em lotes (op trilha.acervo); as durações que faltam vão
 * depois (op trilha.duracoes).
 */

let musica = null;

function souOGmAtivo() {
  return !!game.user?.isGM && game.users?.activeGM?.id === game.user.id;
}

function filePicker() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

function rotaDe(caminho) {
  return foundry.utils?.getRoute ? foundry.utils.getRoute(caminho) : caminho;
}

export function musicaDoMundo() {
  // A MESMA pasta para tocar e para importar (vazia na configuração = "sounds",
  // como na 1.19.0): o caminho que a importação grava é o que o tocar acha.
  const pasta = () => game.settings.get(MODULE_ID, "pastaDasTrilhas") || PASTA_PADRAO;
  musica ??= criarMusica({
    moduleId: MODULE_ID,
    playlists: game.playlists,
    criarPlaylist: (dados) => CONFIG.Playlist.documentClass.create(dados),
    pasta,
    existe: criarConferenciaDeArquivo((alvo) => filePicker().browse("data", alvo)),
    reportar: (corpo) => postInbound(corpo),
    acervo: criarAcervo({
      pasta,
      browse: (alvo) => filePicker().browse("data", alvo, { extensions: EXTENSOES_DE_AUDIO }),
      enviar: (corpo) => postInbound(corpo),
      medir: (original) => medirComAudio(rotaDe(original)),
      agora: () => Date.now(),
      avisar: (texto) => ui.notifications?.info(texto),
    }),
  });
  return musica;
}

/** No GM ativo: a op `audio.comando` da ponte. Responde na hora. */
export function receberComandoDeAudio(payload) {
  return musicaDoMundo().receber(payload);
}

/** No `ready` do GM (main.js). */
export function registerMusica() {
  const m = musicaDoMundo();
  let espera = null;
  const aoMudar = (doc) => {
    const pl = doc?.documentName === "Playlist" ? doc : doc?.parent;
    if (!m.ePlaylistDaMusica(pl) || !souOGmAtivo()) return;
    clearTimeout(espera);
    espera = setTimeout(() => m.mudouNoFoundry(pl), 800);
  };
  for (const gancho of ["createPlaylistSound", "updatePlaylistSound", "deletePlaylistSound", "updatePlaylist"]) Hooks.on(gancho, aoMudar);
  if (souOGmAtivo()) m.relatarAoAbrir();
}
