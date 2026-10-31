/**
 * O ACERVO GRANDE (v1.20.0; TRANCHE Q do Companion, "2b", 31/10). As regras,
 * sem Foundry (os testes rodam no Node); a ligação com o Foundry mora em
 * trilhas-foundry.js.
 *
 * O Bruno quer MUITO mais trilhas ("sei lá, 1000… incluindo sons"). Os
 * arquivos ficam na pasta de sons do Foundry, no PC dele; o Companion guarda só
 * o caminho. O Mestre aperta "Importar a pasta do Foundry" no painel Música →
 * o pedido "listar" chega pelo cano da música (op audio.comando) → o GM ativo:
 *
 *   1. LISTA a pasta das trilhas (a configuração do módulo; padrão "sounds")
 *      inteira, pasta por pasta (FilePicker.browse, só os arquivos de áudio);
 *   2. manda a lista em LOTES (até 400 arquivos e 90 KB cada: a entrada do
 *      Companion recusa acima de 128 KiB) pela entrada (op trilha.acervo). A
 *      resposta de cada lote diz quais arquivos ainda não têm duração;
 *   3. MEDE a duração só desses (o cabeçalho do arquivo, por um <audio> com
 *      preload "metadata", 6 de cada vez, até 4 s cada) e manda (op
 *      trilha.duracoes). Reimportar não mede de novo o que já tem duração.
 *
 * O Companion etiqueta, cadastra o novo, não mexe no que o Mestre editou e
 * marca o que sumiu da pasta (só com a lista inteira e nenhuma pasta que não
 * abriu: por isso as falhas vão junto).
 *
 * FATO (os tipos da comunidade para a v14, foundry-vtt-types 14.369 beta):
 * FilePicker.browse(source, target, { extensions }) devolve { dirs, files };
 * CONST.AUDIO_FILE_EXTENSIONS = aac, flac, m4a, mid, mp3, ogg, opus, wav, webm;
 * foundry.utils.getRoute(path). HIPÓTESE até o teste do Bruno: que dirs e
 * files venham com o caminho a partir da pasta Data (como o script do console
 * de 20/10 supõe) e que o <audio> leia a duração dos arquivos servidos pelo
 * Foundry dele.
 */

export const EXTENSOES_DE_AUDIO = [".aac", ".flac", ".m4a", ".mid", ".mp3", ".ogg", ".opus", ".wav", ".webm"];
export const ARQUIVOS_POR_LOTE = 400;
export const BYTES_POR_LOTE = 90_000;
/** Se a pasta listada for a raiz Data (hoje não é: a pasta vazia na configuração vale "sounds"), módulos e sistemas ficam de fora. */
export const PULAR_NA_RAIZ = /^(modules|systems)(\/|$)/i;
export const MAX_PASTAS = 5000;
export const MEDIR_JUNTOS = 6;
export const MEDIR_ESPERA_MS = 4000;

const solto = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function ehAudio(arquivo) {
  const m = /\.[a-z0-9]{2,5}$/i.exec(String(arquivo ?? ""));
  return !!m && EXTENSOES_DE_AUDIO.includes(m[0].toLowerCase());
}

/**
 * O caminho a partir da pasta das trilhas (o que a biblioteca do Companion
 * guarda): o Foundry devolve a partir da pasta Data ("sounds/CD1/a%20b.mp3").
 * Fora da pasta: null. A mesma regra de relativoAPasta no Companion.
 */
export function relativoAPasta(pasta, arquivo) {
  const base = solto(String(pasta ?? "")).trim().replace(/^\/+|\/+$/g, "");
  const f = solto(String(arquivo ?? "")).replace(/^\/+/, "");
  if (!base) return f;
  return f.startsWith(`${base}/`) ? f.slice(base.length + 1) : null;
}

/**
 * A pasta inteira, pasta por pasta (de cima para baixo). `browse(alvo)` é o
 * FilePicker.browse("data", alvo, { extensions }). A pasta que não abre entra
 * em `falhas` (a de cima, em `raizFalhou`); depois de MAX_PASTAS, `cortada`.
 */
export async function listarPasta(browse, pasta, { agora = () => Date.now(), maxPastas = MAX_PASTAS } = {}) {
  const base = String(pasta ?? "").trim().replace(/^\/+|\/+$/g, "");
  const t0 = agora();
  const fila = [base];
  const vistas = new Set();
  const arquivos = new Map();
  const falhas = [];
  let raizFalhou = null;
  let chamadas = 0;
  while (fila.length && vistas.size < maxPastas) {
    const alvo = fila.shift();
    const chave = solto(alvo);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    let r;
    try {
      chamadas++;
      r = await browse(alvo);
    } catch (err) {
      const motivo = err?.message ?? String(err);
      if (alvo === base) raizFalhou = motivo;
      else falhas.push({ pasta: chave, motivo });
      continue;
    }
    for (const f of r?.files ?? []) {
      if (!ehAudio(f)) continue;
      const rel = relativoAPasta(base, f);
      if (rel && !arquivos.has(rel)) arquivos.set(rel, f);
    }
    for (const d of r?.dirs ?? []) {
      if (!base && PULAR_NA_RAIZ.test(solto(d))) continue;
      fila.push(d);
    }
  }
  const lista = [...arquivos].map(([caminho, original]) => ({ caminho, original }));
  lista.sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  return { pasta: base, arquivos: lista, pastas: vistas.size, chamadas, falhas, raizFalhou, cortada: fila.length > 0, ms: agora() - t0 };
}

const tamanho = (o) => new TextEncoder().encode(JSON.stringify(o)).length + 1;

/** Em lotes: até `max` itens e `maxBytes` de JSON cada. */
export function lotesDe(itens, { max = ARQUIVOS_POR_LOTE, maxBytes = BYTES_POR_LOTE } = {}) {
  const lotes = [];
  let atual = [];
  let bytes = 0;
  for (const i of itens) {
    const b = tamanho(i);
    if (atual.length && (atual.length >= max || bytes + b > maxBytes)) {
      lotes.push(atual);
      atual = [];
      bytes = 0;
    }
    atual.push(i);
    bytes += b;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

/** `fazer` em cada item, `quantos` de cada vez, na ordem dos itens. */
export async function emParalelo(itens, quantos, fazer) {
  const out = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const k = proximo++;
      out[k] = await fazer(itens[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(quantos, itens.length) }, trabalhador));
  return out;
}

/**
 * A duração de um arquivo pelo cabeçalho (o <audio> com preload "metadata":
 * não toca, não baixa o arquivo inteiro). Nada em `espera` ms, ou erro: null.
 */
export function medirComAudio(url, { espera = MEDIR_ESPERA_MS, criarAudio = () => new Audio(), relogio = globalThis } = {}) {
  return new Promise((resolve) => {
    let feito = false;
    let a = null;
    let t = null;
    const fim = (v) => {
      if (feito) return;
      feito = true;
      relogio.clearTimeout(t);
      try {
        a.removeAttribute?.("src");
        a.load?.();
      } catch {
        /* nada */
      }
      resolve(v);
    };
    try {
      a = criarAudio();
      t = relogio.setTimeout(() => fim(null), espera);
      a.preload = "metadata";
      a.onloadedmetadata = () => fim(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
      a.onerror = () => fim(null);
      a.src = url;
    } catch {
      fim(null);
    }
  });
}

/**
 * A importação. `deps`:
 *   browse(alvo) → { dirs, files }; pasta() → a pasta das trilhas;
 *   enviar(corpo) → a resposta da entrada (o corpo, { ok:false, status } ou
 *   null); medir(original) → segundos ou null; agora(); esperar(ms);
 *   avisar(texto) (opcional: o aviso do Foundry ao GM).
 */
export function criarAcervo(deps) {
  const esperar = deps.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let andando = null;

  /** Até 3 vezes quando a entrada não respondeu, deu 5xx ou o limite (429). */
  async function enviar(corpo) {
    for (let t = 0; t < 3; t++) {
      let r = null;
      try {
        r = await deps.enviar(corpo);
      } catch {
        r = null;
      }
      const deNovo = r === null || (typeof r.status === "number" && (r.status >= 500 || r.status === 429));
      if (!deNovo) return r;
      if (t < 2) await esperar(1000 * 2 ** t);
    }
    return null;
  }

  async function importar(pedidoId) {
    const pasta = String(deps.pasta() ?? "").trim();
    const lista = await listarPasta(deps.browse, pasta, { agora: deps.agora });
    const base = {
      op: "trilha.acervo",
      pedido_id: pedidoId,
      pasta: lista.pasta || "(pasta Data)",
      pastas: lista.pastas,
      falhas: lista.falhas.length + (lista.cortada ? 1 : 0),
      total: lista.arquivos.length,
      ms_listar: Math.round(lista.ms),
    };
    if (lista.raizFalhou || !lista.arquivos.length) {
      const erro = lista.raizFalhou ? `a pasta "${lista.pasta || "Data"}" não abriu: ${lista.raizFalhou}`.slice(0, 200) : undefined;
      await enviar({ ...base, lote: 0, lotes: 0, arquivos: [], ...(erro ? { erro } : {}) });
      deps.avisar?.(erro ?? `Companion: nenhum arquivo de áudio na pasta "${lista.pasta || "Data"}".`);
      return { arquivos: 0, lotes: 0, medidas: 0, lista };
    }
    deps.avisar?.(`Companion: ${lista.arquivos.length} arquivos de áudio em ${lista.pastas} pastas. Enviando…`);
    const original = new Map(lista.arquivos.map((a) => [a.caminho, a.original]));
    const lotes = lotesDe(lista.arquivos.map((a) => ({ caminho: a.caminho })));
    const semDuracao = [];
    for (let i = 0; i < lotes.length; i++) {
      const r = await enviar({ ...base, lote: i + 1, lotes: lotes.length, arquivos: lotes[i] });
      if (!r) throw new Error(`a entrada do Companion não respondeu ao lote ${i + 1} de ${lotes.length}`);
      if (r.ok === false) return { parou: r.ja ?? r.motivo ?? r.error ?? `HTTP ${r.status}`, arquivos: lista.arquivos.length, lotes: i, medidas: 0, lista };
      for (const c of Array.isArray(r.sem_duracao) ? r.sem_duracao : []) if (typeof c === "string") semDuracao.push(c);
    }
    // as durações que faltam, em blocos: o resumo do Companion anda junto
    let medidas = 0;
    if (deps.medir && semDuracao.length) {
      for (const bloco of lotesDe(semDuracao.map((c) => ({ caminho: c })))) {
        const achadas = await emParalelo(bloco, MEDIR_JUNTOS, async ({ caminho }) => {
          const d = await deps.medir(original.get(caminho) ?? caminho).catch(() => null);
          return typeof d === "number" && Number.isFinite(d) && d > 0 ? { caminho, duracao: Math.round(d * 10) / 10 } : null;
        });
        const arquivos = achadas.filter(Boolean);
        medidas += arquivos.length;
        if (arquivos.length) await enviar({ op: "trilha.duracoes", pedido_id: pedidoId, total: semDuracao.length, arquivos });
      }
    }
    deps.avisar?.(`Companion: ${lista.arquivos.length} arquivos importados (${medidas} durações medidas).`);
    return { arquivos: lista.arquivos.length, lotes: lotes.length, medidas, lista };
  }

  /** Uma importação por vez neste navegador; a de agora é a devolvida. */
  function comecar(pedidoId) {
    if (andando) return andando;
    andando = importar(pedidoId)
      .catch(async (err) => {
        const motivo = `a importação parou: ${err?.message ?? String(err)}`.slice(0, 200);
        console.error("companion-foundry-bridge | acervo:", err);
        await enviar({ op: "trilha.acervo", pedido_id: pedidoId, lote: 0, lotes: 0, arquivos: [], erro: motivo });
        deps.avisar?.(`Companion: ${motivo}`);
        return { erro: motivo };
      })
      .finally(() => {
        andando = null;
      });
    return andando;
  }

  return { comecar, importando: () => andando !== null };
}
