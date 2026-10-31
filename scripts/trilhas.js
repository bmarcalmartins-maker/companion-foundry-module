/**
 * A MÚSICA NO FOUNDRY (v1.19.0; TRANCHE Q do Companion, parte 4). As regras,
 * sem Foundry (os testes rodam no Node); a ligação com o Foundry mora em
 * trilhas-foundry.js.
 *
 * O cano: o Companion pede (tocar, parar, volume, o que toca) → a ponte (op
 * `audio.comando`) → o GM ATIVO mexe na playlist "Companion — Trilhas" do
 * mundo → o Foundry toca para todos os navegadores, porque o estado da
 * playlist (o som que toca, o volume, o loop) é dado do mundo → o resultado e
 * o que toca agora voltam ao Companion pela entrada (op `trilha.resultado`).
 *
 * - A playlist é uma SÓ, marcada pela flag `trilhas` do módulo; os sons dela
 *   pela flag `faixa_id` (o id da faixa na biblioteca do Companion): pedir a
 *   mesma faixa de novo reusa o som, não duplica.
 * - O modo é o de soundboard (CONST.PLAYLIST_MODES.DISABLED, -1: cada som toca
 *   por conta própria) e o canal, "music" (cada jogador ouve no volume de
 *   música dele).
 * - Trocar ("cruzar", o padrão): a faixa nova entra com o fade e as outras do
 *   Companion saem com o mesmo fade, numa atualização só (crossfade).
 *   "somar": toca por cima.
 * - A ponte espera a resposta: o comando responde "recebido" na hora e o
 *   trabalho segue numa fila (um comando por vez, na ordem em que chegaram).
 * - "listar" (1.20.0): a importação da pasta das trilhas (acervo.js), fora da
 *   fila; a lista volta em lotes (op trilha.acervo).
 *
 * FATO (os tipos da comunidade para a v14, @league-of-foundry-developers/
 * foundry-vtt-types 14.369 beta, 27/10): PlaylistSound tem name, path,
 * playing, pausedTime, repeat, volume (0 a 1) e fade (ms); Playlist tem
 * sounds, channel, mode e fade; CONST.PLAYLIST_MODES.DISABLED = -1;
 * FilePicker.browse(source, target) devolve { dirs, files }. HIPÓTESE até o
 * teste do Bruno: que o Foundry 14 dele toque para todos a partir da
 * atualização do documento, com o fade, como nas versões de antes.
 */

export const NOME_DA_PLAYLIST = "Companion — Trilhas";
export const FLAG_DA_PLAYLIST = "trilhas";
export const FLAG_DA_FAIXA = "faixa_id";
/** CONST.PLAYLIST_MODES.DISABLED (soundboard). */
export const MODO_SOUNDBOARD = -1;
export const CANAL = "music";
export const PASTA_PADRAO = "sounds";

const ACOES = new Set(["tocar", "parar", "volume", "estado", "listar"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O caminho do arquivo no Foundry: a pasta das trilhas (configuração do
 * módulo; padrão "sounds") + o caminho da biblioteca do Companion. Endereço
 * completo (http) e caminho que já começa pela pasta ficam como estão.
 */
export function caminhoDaFaixa(pasta, caminho) {
  const c = typeof caminho === "string" ? caminho.trim() : "";
  if (!c) return null;
  if (/^(https?:)?\/\//i.test(c)) return c;
  const base = String(pasta ?? "").trim().replace(/^\/+|\/+$/g, "");
  const rel = c.replace(/^\/+/, "");
  if (!base || rel === base || rel.startsWith(`${base}/`)) return rel;
  return `${base}/${rel}`;
}

const numero = (v, padrao, min, max) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : padrao;
  return Math.min(max, Math.max(min, n));
};

/** O comando que veio da ponte, conferido. Lança com o motivo se não serve. */
export function validarComando(p) {
  if (!p || typeof p !== "object") throw new Error("comando_invalido");
  const acao = p.acao;
  if (!ACOES.has(acao)) throw new Error(`acao_desconhecida: ${String(acao)}`);
  const faixaId = typeof p.faixa_id === "string" && UUID.test(p.faixa_id) ? p.faixa_id.toLowerCase() : null;
  const caminho = typeof p.caminho === "string" && p.caminho.trim() ? p.caminho.trim() : null;
  if ((acao === "tocar" || acao === "volume") && (!faixaId || !caminho)) throw new Error("faixa_sem_id_ou_arquivo");
  const pedidoId = typeof p.pedido_id === "string" && UUID.test(p.pedido_id) ? p.pedido_id.toLowerCase() : null;
  if (acao === "listar" && !pedidoId) throw new Error("importacao_sem_pedido");
  return {
    acao,
    pedidoId,
    faixaId,
    nome: typeof p.nome === "string" && p.nome.trim() ? p.nome.trim().slice(0, 200) : "Trilha",
    caminho,
    volume: numero(p.volume, 0.5, 0, 1),
    loop: p.loop === true,
    fadeMs: Math.round(numero(p.fade_ms, 0, 0, 30_000)),
    troca: p.troca === "somar" ? "somar" : "cruzar",
  };
}

/** Os sons da playlist como o resto deste arquivo os lê. */
export function sonsDa(playlist, moduleId) {
  return [...(playlist?.sounds ?? [])].map((s) => ({
    id: s.id,
    faixaId: s.getFlag?.(moduleId, FLAG_DA_FAIXA) ?? s.flags?.[moduleId]?.[FLAG_DA_FAIXA] ?? null,
    nome: s.name,
    path: s.path,
    playing: s.playing === true,
    volume: typeof s.volume === "number" ? s.volume : 0.5,
    repeat: s.repeat === true,
  }));
}

/** O que toca agora, no formato da entrada do Companion (op trilha.resultado). */
export function tocandoAgora(sons) {
  return sons
    .filter((s) => s.playing)
    .map((s) => ({ faixa_id: s.faixaId, nome: s.nome, caminho: s.path, volume: s.volume, loop: s.repeat }));
}

/**
 * As atualizações de um comando sobre os sons da playlist (o som da faixa
 * pedida já existe: quem executa o cria antes). Puro.
 */
export function planoDoComando(cmd, sons, caminhoCompleto) {
  const atualizar = [];
  const parar = (s) => atualizar.push({ _id: s.id, playing: false, pausedTime: null, fade: cmd.fadeMs });
  if (cmd.acao === "tocar") {
    const alvo = sons.find((s) => s.faixaId === cmd.faixaId);
    if (!alvo) throw new Error("som_nao_criado");
    if (cmd.troca === "cruzar") for (const s of sons) if (s.playing && s.id !== alvo.id) parar(s);
    atualizar.push({
      _id: alvo.id,
      name: cmd.nome,
      path: caminhoCompleto,
      volume: cmd.volume,
      repeat: cmd.loop,
      fade: cmd.fadeMs,
      pausedTime: null,
      playing: true,
    });
  } else if (cmd.acao === "parar") {
    for (const s of sons) if (s.playing && (!cmd.faixaId || s.faixaId === cmd.faixaId)) parar(s);
  } else if (cmd.acao === "volume") {
    const alvo = sons.find((s) => s.faixaId === cmd.faixaId);
    if (!alvo) throw new Error("faixa_nao_esta_na_playlist");
    atualizar.push({ _id: alvo.id, volume: cmd.volume, fade: cmd.fadeMs });
  }
  return atualizar;
}

/**
 * A música do GM ativo. `deps`:
 *   moduleId; playlists (game.playlists: tem find); criarPlaylist(dados);
 *   pasta() (a pasta das trilhas); existe(caminho) (o arquivo existe? lança
 *   ou devolve null quando não dá para saber); reportar(corpo) (POST na
 *   entrada; o resultado não é esperado); acervo (criarAcervo, 1.20.0: a
 *   importação da pasta, que corre fora da fila da música).
 */
export function criarMusica(deps) {
  const { moduleId } = deps;
  let fila = Promise.resolve();
  let playlistPedida = null;
  let ultimoEstado = null;

  async function playlist() {
    const achada = deps.playlists.find((p) => (p.getFlag?.(moduleId, FLAG_DA_PLAYLIST) ?? p.flags?.[moduleId]?.[FLAG_DA_PLAYLIST]) === true);
    if (achada) return achada;
    playlistPedida ??= Promise.resolve(
      deps.criarPlaylist({
        name: NOME_DA_PLAYLIST,
        mode: MODO_SOUNDBOARD,
        channel: CANAL,
        flags: { [moduleId]: { [FLAG_DA_PLAYLIST]: true } },
      }),
    ).finally(() => {
      playlistPedida = null;
    });
    return playlistPedida;
  }

  function relatar(corpo) {
    ultimoEstado = JSON.stringify(corpo.tocando);
    try {
      void Promise.resolve(deps.reportar({ op: "trilha.resultado", ...corpo })).catch(() => {});
    } catch {
      /* a entrada fora do ar não derruba a música */
    }
  }

  async function executar(cmd) {
    const pl = await playlist();
    if (!pl) throw new Error("sem_playlist");
    let caminho = null;
    if (cmd.acao === "tocar") {
      caminho = caminhoDaFaixa(deps.pasta(), cmd.caminho);
      let existe = null;
      try {
        existe = await deps.existe(caminho);
      } catch {
        existe = null; // não dá para saber (sem permissão de listar): segue
      }
      if (existe === false) throw new Error(`arquivo_nao_achado: ${caminho}`);
      if (!sonsDa(pl, moduleId).some((s) => s.faixaId === cmd.faixaId)) {
        await pl.createEmbeddedDocuments("PlaylistSound", [
          {
            name: cmd.nome,
            path: caminho,
            volume: cmd.volume,
            repeat: cmd.loop,
            fade: cmd.fadeMs,
            playing: false,
            flags: { [moduleId]: { [FLAG_DA_FAIXA]: cmd.faixaId } },
          },
        ]);
      }
    }
    const atualizar = planoDoComando(cmd, sonsDa(pl, moduleId), caminho);
    if (atualizar.length) await pl.updateEmbeddedDocuments("PlaylistSound", atualizar);
    return pl;
  }

  /** A op `audio.comando` da ponte: responde na hora; o trabalho vai à fila. */
  function receber(payload) {
    let cmd;
    try {
      cmd = validarComando(payload);
    } catch (err) {
      const pedidoId = typeof payload?.pedido_id === "string" && UUID.test(payload.pedido_id) ? payload.pedido_id.toLowerCase() : null;
      relatar({ pedido_id: pedidoId, ok: false, motivo: err?.message ?? String(err), tocando: [] });
      return { recebido: false, motivo: err?.message ?? String(err) };
    }
    // A importação da pasta (1.20.0) corre FORA da fila: listar milhares de
    // arquivos não segura o "tocar" de ninguém. O resultado volta em lotes
    // (op trilha.acervo), não pelo trilha.resultado.
    if (cmd.acao === "listar") {
      if (!deps.acervo) return { recebido: false, motivo: "acao_desconhecida: listar" };
      void deps.acervo.comecar(cmd.pedidoId);
      return { recebido: true };
    }
    fila = fila
      .then(async () => {
        let pl = null;
        try {
          pl = await executar(cmd);
          relatar({ pedido_id: cmd.pedidoId, ok: true, tocando: tocandoAgora(sonsDa(pl, moduleId)) });
        } catch (err) {
          const atual = pl ?? (await playlist().catch(() => null));
          relatar({ pedido_id: cmd.pedidoId, ok: false, motivo: err?.message ?? String(err), tocando: atual ? tocandoAgora(sonsDa(atual, moduleId)) : [] });
        }
      })
      .catch(() => {});
    return { recebido: true };
  }

  /**
   * Mudou algo na playlist pelo próprio Foundry (o GM tocou ou parou, a faixa
   * acabou): relata o que toca agora, sem pedido. Estado igual ao último
   * relatado não sai de novo (os comandos do Companion já relataram).
   */
  function mudouNoFoundry(pl) {
    if (!pl) return;
    const tocando = tocandoAgora(sonsDa(pl, moduleId));
    if (JSON.stringify(tocando) === ultimoEstado) return;
    relatar({ ok: true, tocando });
  }

  /** Ao abrir o mundo: o estado de agora (sem criar a playlist). */
  function relatarAoAbrir() {
    const pl = deps.playlists.find((p) => (p.getFlag?.(moduleId, FLAG_DA_PLAYLIST) ?? p.flags?.[moduleId]?.[FLAG_DA_PLAYLIST]) === true);
    relatar({ ok: true, tocando: pl ? tocandoAgora(sonsDa(pl, moduleId)) : [] });
  }

  return { receber, mudouNoFoundry, relatarAoAbrir, esperar: () => fila, ePlaylistDaMusica: (p) => (p?.getFlag?.(moduleId, FLAG_DA_PLAYLIST) ?? p?.flags?.[moduleId]?.[FLAG_DA_PLAYLIST]) === true };
}

/**
 * O arquivo existe? Pela listagem da pasta (FilePicker.browse("data", pasta)),
 * guardada por um minuto. `browse` lança (sem permissão, fonte s3): null, não
 * dá para saber.
 */
export function criarConferenciaDeArquivo(browse, agora = () => Date.now()) {
  const cache = new Map();
  return async (caminho) => {
    if (!caminho || /^(https?:)?\/\//i.test(caminho)) return null;
    const i = caminho.lastIndexOf("/");
    const pasta = i >= 0 ? caminho.slice(0, i) : "";
    let entrada = cache.get(pasta);
    if (!entrada || agora() - entrada.em > 60_000) {
      const r = await browse(pasta);
      const arquivos = new Set();
      for (const f of r?.files ?? []) {
        arquivos.add(f);
        try {
          arquivos.add(decodeURIComponent(f));
        } catch {
          /* nome com % solto: fica o original */
        }
      }
      entrada = { em: agora(), arquivos };
      cache.set(pasta, entrada);
    }
    return entrada.arquivos.has(caminho);
  };
}
