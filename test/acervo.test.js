/**
 * O ACERVO GRANDE (acervo.js, v1.20.0) com um Foundry SIMULADO: a árvore de
 * pastas do FilePicker.browse, o <audio> que lê a duração e a entrada do
 * Companion (que responde quais arquivos ainda não têm duração). O que o
 * Foundry de verdade devolve e quanto tempo leva é do Foundry (HIPÓTESE até o
 * teste do Bruno).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARQUIVOS_POR_LOTE,
  BYTES_POR_LOTE,
  criarAcervo,
  ehAudio,
  emParalelo,
  listarPasta,
  lotesDe,
  medirComAudio,
  relativoAPasta,
} from "../scripts/acervo.js";
import { criarMusica } from "../scripts/trilhas.js";

const PEDIDO = "70000000-0000-4000-8000-0000000000b1";

/** Uma pasta Data de mentira: { "<pasta>": { dirs, files } }, como o FilePicker.browse devolve. */
function arvore(pastas, { quebradas = [], latencia = 0 } = {}) {
  const pedidas = [];
  const browse = async (alvo) => {
    pedidas.push(alvo);
    if (latencia) await new Promise((r) => setTimeout(r, latencia));
    if (quebradas.includes(alvo)) throw new Error("EACCES");
    const p = pastas[alvo];
    if (!p) throw new Error(`a pasta ${alvo} não existe`);
    return { dirs: p.dirs ?? [], files: p.files ?? [], target: alvo };
  };
  return { browse, pedidas };
}

/** Uma árvore com n arquivos, em pastas de 100 (pacotes de 10 pastas). */
function arvoreGrande(n) {
  const pastas = { sounds: { dirs: [], files: [] } };
  for (let i = 0; i < n; i++) {
    const pacote = `sounds/Pacote%20${Math.floor(i / 1000)}`;
    const pasta = `${pacote}/Tema%20${Math.floor(i / 100)}`;
    if (!pastas[pacote]) {
      pastas[pacote] = { dirs: [], files: [] };
      pastas.sounds.dirs.push(pacote);
    }
    if (!pastas[pasta]) {
      pastas[pasta] = { dirs: [], files: [] };
      pastas[pacote].dirs.push(pasta);
    }
    pastas[pasta].files.push(`${pasta}/${i}_Forest_Night_Ambience_Loop.ogg`);
  }
  return pastas;
}

/** A entrada do Companion de mentira: guarda o que chegou, e diz quais não têm duração. */
function companion({ comDuracao = new Set(), falhaNas = [] } = {}) {
  const chegou = [];
  let n = 0;
  const enviar = async (corpo) => {
    n++;
    chegou.push(structuredClone(corpo));
    if (falhaNas.includes(n)) return n % 2 ? null : { ok: false, status: 500 };
    if (corpo.op === "trilha.acervo") {
      if (corpo.lotes === 0) return { ok: true, estado: "falhou", sem_duracao: [], fim: true };
      return { ok: true, lote: corpo.lote, fim: corpo.lote === corpo.lotes, sem_duracao: corpo.arquivos.map((a) => a.caminho).filter((c) => !comDuracao.has(c)) };
    }
    return { ok: true, gravadas: corpo.arquivos.length };
  };
  return { enviar, chegou };
}

test("o áudio e o caminho a partir da pasta das trilhas", () => {
  assert.ok(ehAudio("a.OGG") && ehAudio("b/c.webm") && ehAudio("x.mid") && !ehAudio("capa.png") && !ehAudio("sem"));
  assert.equal(relativoAPasta("sounds", "sounds/CD1/a%20b.mp3"), "CD1/a b.mp3");
  assert.equal(relativoAPasta("/sounds/", "sounds/x.ogg"), "x.ogg");
  assert.equal(relativoAPasta("sounds", "music/x.ogg"), null);
  assert.equal(relativoAPasta("", "CD1/x.ogg"), "CD1/x.ogg");
});

test("listar: pasta por pasta, só áudio, sem repetir, com a pasta que não abriu", async () => {
  const { browse, pedidas } = arvore(
    {
      sounds: { dirs: ["sounds/Tavernas", "sounds/Combate", "sounds/Quebrada"], files: ["sounds/leia-me.txt", "sounds/Raiz.mp3"] },
      "sounds/Tavernas": { dirs: ["sounds/Tavernas/Cheias"], files: ["sounds/Tavernas/Bardo%20Alegre.ogg", "sounds/Tavernas/capa.png"] },
      "sounds/Tavernas/Cheias": { files: ["sounds/Tavernas/Cheias/Busy_Tavern_Ambience.ogg", "sounds/Tavernas/Cheias/Busy_Tavern_Ambience.ogg"] },
      "sounds/Combate": { files: ["sounds/Combate/Batalha.mp3"] },
    },
    { quebradas: ["sounds/Quebrada"] },
  );
  let t = 0;
  const r = await listarPasta(browse, "sounds", { agora: () => (t += 5) });
  assert.deepEqual(
    r.arquivos.map((a) => a.caminho),
    ["Combate/Batalha.mp3", "Raiz.mp3", "Tavernas/Bardo Alegre.ogg", "Tavernas/Cheias/Busy_Tavern_Ambience.ogg"],
  );
  assert.equal(r.arquivos.find((a) => a.caminho === "Tavernas/Bardo Alegre.ogg").original, "sounds/Tavernas/Bardo%20Alegre.ogg", "o original vai ao <audio>");
  assert.deepEqual(r.falhas, [{ pasta: "sounds/Quebrada", motivo: "EACCES" }]);
  assert.equal(r.raizFalhou, null);
  assert.equal(r.pastas, 5);
  assert.equal(pedidas[0], "sounds");
  assert.equal(r.cortada, false);
  assert.equal(r.ms, 5);
});

test("listar: a pasta das trilhas que não existe; e o teto de pastas", async () => {
  const sem = await listarPasta(arvore({}).browse, "sons");
  assert.equal(sem.raizFalhou, "a pasta sons não existe");
  assert.deepEqual(sem.arquivos, []);
  const muitas = await listarPasta(arvore(arvoreGrande(500)).browse, "sounds", { maxPastas: 3 });
  assert.equal(muitas.cortada, true);
});

test("os lotes: até 400 arquivos e 90 KB", () => {
  const mil = Array.from({ length: 1000 }, (_, i) => ({ caminho: `a/${i}.ogg` }));
  assert.deepEqual(lotesDe(mil).map((l) => l.length), [400, 400, 200]);
  const longos = Array.from({ length: 400 }, (_, i) => ({ caminho: `${"Pasta Muito Comprida/".repeat(20)}${i}.ogg` }));
  const lotes = lotesDe(longos);
  assert.ok(lotes.length > 1);
  for (const l of lotes) assert.ok(new TextEncoder().encode(JSON.stringify(l)).length <= BYTES_POR_LOTE + 2, "cabe na entrada (128 KiB)");
  assert.equal(lotes.flat().length, 400);
  assert.deepEqual(lotesDe([]), []);
  assert.equal(ARQUIVOS_POR_LOTE, 400);
});

test("em paralelo: nunca mais que o pedido, na ordem dos itens", async () => {
  let agora = 0;
  let maximo = 0;
  const r = await emParalelo([5, 1, 4, 2, 3, 6, 1, 1], 3, async (x) => {
    agora++;
    maximo = Math.max(maximo, agora);
    await new Promise((ok) => setTimeout(ok, x));
    agora--;
    return x * 10;
  });
  assert.deepEqual(r, [50, 10, 40, 20, 30, 60, 10, 10]);
  assert.equal(maximo, 3);
});

test("a duração pelo <audio>: o cabeçalho, o erro e a espera", async () => {
  const relogio = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };
  const audio = (fazer) => () => {
    const a = { removeAttribute: () => {}, load: () => {} };
    let src = null;
    Object.defineProperty(a, "src", { set: (v) => { src = v; setTimeout(() => fazer(a, src), 1); }, get: () => src });
    return a;
  };
  assert.equal(await medirComAudio("x.ogg", { relogio, criarAudio: audio((a) => { a.duration = 183.4; a.onloadedmetadata(); }) }), 183.4);
  assert.equal(await medirComAudio("x.ogg", { relogio, criarAudio: audio((a) => a.onerror()) }), null);
  assert.equal(await medirComAudio("x.ogg", { relogio, criarAudio: audio((a) => { a.duration = Infinity; a.onloadedmetadata(); }) }), null);
  assert.equal(await medirComAudio("x.ogg", { relogio, espera: 20, criarAudio: audio(() => {}) }), null, "nada em 20 ms");
  assert.equal(await medirComAudio("x.ogg", { relogio, criarAudio: () => { throw new Error("sem Audio"); } }), null);
});

test("importar: os lotes, as falhas, e só as durações que faltam", async () => {
  const { browse } = arvore(
    {
      sounds: { dirs: ["sounds/Tavernas", "sounds/Quebrada"], files: [] },
      "sounds/Tavernas": { files: ["sounds/Tavernas/Bardo%20Alegre.ogg", "sounds/Tavernas/Porta_1s.ogg", "sounds/Tavernas/Ja_Medido.ogg"] },
    },
    { quebradas: ["sounds/Quebrada"] },
  );
  const c = companion({ comDuracao: new Set(["Tavernas/Ja_Medido.ogg"]) });
  const medidos = [];
  const avisos = [];
  const acervo = criarAcervo({
    browse,
    pasta: () => "sounds",
    enviar: c.enviar,
    medir: async (original) => {
      medidos.push(original);
      return original.includes("Porta") ? null : 211.26;
    },
    agora: () => 0,
    esperar: async () => {},
    avisar: (t) => avisos.push(t),
  });
  const r = await acervo.comecar(PEDIDO);
  assert.equal(r.arquivos, 3);
  const [lote, duracoes] = c.chegou;
  assert.deepEqual(lote, {
    op: "trilha.acervo",
    pedido_id: PEDIDO,
    pasta: "sounds",
    pastas: 3,
    falhas: 1,
    total: 3,
    ms_listar: 0,
    lote: 1,
    lotes: 1,
    arquivos: [{ caminho: "Tavernas/Bardo Alegre.ogg" }, { caminho: "Tavernas/Ja_Medido.ogg" }, { caminho: "Tavernas/Porta_1s.ogg" }],
  });
  assert.deepEqual(medidos.sort(), ["sounds/Tavernas/Bardo%20Alegre.ogg", "sounds/Tavernas/Porta_1s.ogg"], "o que já tem duração não é medido de novo");
  assert.deepEqual(duracoes, { op: "trilha.duracoes", pedido_id: PEDIDO, total: 2, arquivos: [{ caminho: "Tavernas/Bardo Alegre.ogg", duracao: 211.3 }] });
  assert.equal(c.chegou.length, 2);
  assert.match(avisos.at(-1), /3 arquivos importados \(1 durações medidas\)/);
});

test("importar: a entrada fora do ar tenta de novo; recusa para; a pasta vazia e a que não abre avisam", async () => {
  const pastas = { sounds: { files: Array.from({ length: 900 }, (_, i) => `sounds/${i}.ogg`) } };
  // 1ª tentativa sem resposta, 2ª com 500, 3ª passa
  const c1 = companion({ falhaNas: [1, 2], comDuracao: new Set(pastas.sounds.files.map((f) => f.slice(7))) });
  const esperas = [];
  const a1 = criarAcervo({ browse: arvore(pastas).browse, pasta: () => "sounds", enviar: c1.enviar, agora: () => 0, esperar: async (ms) => esperas.push(ms) });
  const r1 = await a1.comecar(PEDIDO);
  assert.equal(r1.lotes, 3);
  assert.deepEqual(c1.chegou.map((x) => x.lote), [1, 1, 1, 2, 3]);
  assert.deepEqual(esperas, [1000, 2000]);

  const recusa = async (corpo) => (corpo.lote === 2 ? { ok: false, ja: "feito" } : { ok: true, sem_duracao: [] });
  const r2 = await criarAcervo({ browse: arvore(pastas).browse, pasta: () => "sounds", enviar: recusa, agora: () => 0, esperar: async () => {} }).comecar(PEDIDO);
  assert.equal(r2.parou, "feito");

  const c3 = companion();
  const r3 = await criarAcervo({ browse: arvore({ sounds: { files: ["sounds/x.txt"] } }).browse, pasta: () => "sounds", enviar: c3.enviar, agora: () => 0 }).comecar(PEDIDO);
  assert.equal(r3.arquivos, 0);
  assert.deepEqual(c3.chegou[0], { op: "trilha.acervo", pedido_id: PEDIDO, pasta: "sounds", pastas: 1, falhas: 0, total: 0, ms_listar: 0, lote: 0, lotes: 0, arquivos: [] });

  const c4 = companion();
  await criarAcervo({ browse: arvore({}).browse, pasta: () => "sons", enviar: c4.enviar, agora: () => 0 }).comecar(PEDIDO);
  assert.equal(c4.chegou[0].erro, 'a pasta "sons" não abriu: a pasta sons não existe');
  assert.equal(c4.chegou[0].lotes, 0);
});

test("importar: o erro no meio fecha o pedido com o motivo; uma importação por vez", async () => {
  const c = companion();
  const quebra = criarAcervo({
    browse: async () => {
      throw Object.assign(new Error("x"), { message: undefined });
    },
    pasta: () => "sounds",
    enviar: async (corpo) => {
      if (corpo.lotes > 0) throw new Error("rede");
      return c.enviar(corpo);
    },
    agora: () => 0,
  });
  await quebra.comecar(PEDIDO);
  assert.equal(c.chegou[0].lotes, 0);

  let solta;
  const devagar = criarAcervo({
    browse: () => new Promise((r) => (solta = () => r({ dirs: [], files: ["sounds/a.ogg"] }))),
    pasta: () => "sounds",
    enviar: async () => ({ ok: true, sem_duracao: [] }),
    agora: () => 0,
  });
  const p1 = devagar.comecar(PEDIDO);
  const p2 = devagar.comecar("70000000-0000-4000-8000-0000000000b2");
  assert.equal(p1, p2, "a segunda chamada devolve a que está andando");
  assert.equal(devagar.importando(), true);
  solta();
  await p1;
  assert.equal(devagar.importando(), false);
});

test("o comando listar pela música: fora da fila; o módulo sem acervo recusa", async () => {
  const relatos = [];
  const comecados = [];
  const base = {
    moduleId: "companion-foundry-bridge",
    playlists: { find: () => null },
    criarPlaylist: async () => null,
    pasta: () => "sounds",
    existe: async () => true,
    reportar: (c) => relatos.push(c),
  };
  const m = criarMusica({ ...base, acervo: { comecar: (id) => comecados.push(id) } });
  assert.deepEqual(m.receber({ acao: "listar", pedido_id: PEDIDO.toUpperCase() }), { recebido: true });
  assert.deepEqual(comecados, [PEDIDO]);
  assert.equal(relatos.length, 0, "a importação não responde pelo trilha.resultado");
  assert.deepEqual(m.receber({ acao: "listar" }), { recebido: false, motivo: "importacao_sem_pedido" });
  assert.deepEqual(criarMusica(base).receber({ acao: "listar", pedido_id: PEDIDO }), { recebido: false, motivo: "acao_desconhecida: listar" });
});

for (const n of [1000, 5000]) {
  test(`medida: listar e mandar ${n.toLocaleString("pt-BR")} arquivos (simulados)`, async () => {
    const pastas = arvoreGrande(n);
    const c = companion();
    let medidos = 0;
    const acervo = criarAcervo({
      browse: arvore(pastas, { latencia: 2 }).browse,
      pasta: () => "sounds",
      enviar: c.enviar,
      medir: async () => {
        medidos++;
        await new Promise((r) => setTimeout(r, 1));
        return 600;
      },
      agora: () => performance.now(),
      esperar: async () => {},
    });
    const t0 = performance.now();
    const r = await acervo.comecar(PEDIDO);
    const ms = performance.now() - t0;
    const lotes = c.chegou.filter((x) => x.op === "trilha.acervo");
    const bytes = lotes.reduce((s, x) => s + new TextEncoder().encode(JSON.stringify(x)).length, 0);
    console.log(
      `# ${n} arquivos em ${r.lista.pastas} pastas: listar ${Math.round(r.lista.ms)} ms (browse simulado de 2 ms por pasta), ` +
        `${lotes.length} lotes (${Math.round(bytes / 1024)} KB), ${medidos} durações (1 ms cada, 6 juntas); tudo ${Math.round(ms)} ms`,
    );
    assert.equal(r.arquivos, n);
    assert.equal(lotes.length, Math.ceil(n / 400));
    assert.equal(medidos, n);
    for (const l of lotes) assert.ok(new TextEncoder().encode(JSON.stringify(l)).length < 128 * 1024, "cada lote cabe na entrada");
  });
}
