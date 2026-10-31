import { MODULE_ID } from "./settings.js";
import { postInbound } from "./equip-sync.js";
import { PASTA_PADRAO, criarConferenciaDeArquivo, criarMusica } from "./trilhas.js";

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
 */

let musica = null;

function souOGmAtivo() {
  return !!game.user?.isGM && game.users?.activeGM?.id === game.user.id;
}

function filePicker() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

export function musicaDoMundo() {
  musica ??= criarMusica({
    moduleId: MODULE_ID,
    playlists: game.playlists,
    criarPlaylist: (dados) => CONFIG.Playlist.documentClass.create(dados),
    pasta: () => game.settings.get(MODULE_ID, "pastaDasTrilhas") || PASTA_PADRAO,
    existe: criarConferenciaDeArquivo((pasta) => filePicker().browse("data", pasta)),
    reportar: (corpo) => postInbound(corpo),
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
