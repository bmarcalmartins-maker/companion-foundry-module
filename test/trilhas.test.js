/**
 * A música do Companion (trilhas.js, v1.19.0), com um Foundry SIMULADO: a
 * coleção de playlists, a playlist com os sons (createEmbeddedDocuments e
 * updateEmbeddedDocuments mudam o estado como o Foundry mudaria), a listagem
 * de pastas e a entrada do Companion. O que o Foundry de verdade toca a partir
 * desse estado é do Foundry (HIPÓTESE até o teste do Bruno).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANAL,
  FLAG_DA_FAIXA,
  FLAG_DA_PLAYLIST,
  MODO_SOUNDBOARD,
  NOME_DA_PLAYLIST,
  caminhoDaFaixa,
  criarConferenciaDeArquivo,
  criarMusica,
  planoDoComando,
  sonsDa,
  tocandoAgora,
  validarComando,
} from "../scripts/trilhas.js";

const MOD = "companion-foundry-bridge";
const F1 = "50000000-0000-4000-8000-000000000001";
const F2 = "50000000-0000-4000-8000-000000000002";
const P1 = "70000000-0000-4000-8000-0000000000a1";
const P2 = "70000000-0000-4000-8000-0000000000a2";

/** Um Foundry de mentira: a playlist guarda os sons como documentos simples. */
function foundrySimulado({ arquivos = ["sounds/mesa/tumba.mp3", "sounds/CD1/batalha.mp3"], semListagem = false } = {}) {
  const playlists = [];
  let n = 0;
  const criadas = [];
  const atualizacoes = [];
  const relatos = [];
  const comFlag = (doc) => ({ ...doc, getFlag: (escopo, chave) => doc.flags?.[escopo]?.[chave] });
  const criarPlaylist = async (dados) => {
    await new Promise((r) => setTimeout(r, 5));
    const pl = comFlag({ id: `pl${++n}`, ...dados, sounds: [] });
    pl.createEmbeddedDocuments = async (tipo, lista) => {
      assert.equal(tipo, "PlaylistSound");
      const novos = lista.map((d) => comFlag({ id: `s${++n}`, ...d }));
      pl.sounds.push(...novos);
      criadas.push(...lista);
      return novos;
    };
    pl.updateEmbeddedDocuments = async (tipo, lista) => {
      assert.equal(tipo, "PlaylistSound");
      atualizacoes.push(lista);
      for (const u of lista) Object.assign(pl.sounds.find((s) => s.id === u._id), u);
      return lista;
    };
    playlists.push(pl);
    return pl;
  };
  const listagens = [];
  const browse = async (pasta) => {
    listagens.push(pasta);
    if (semListagem) throw new Error("sem permissão");
    return { dirs: [], files: arquivos.filter((a) => a.startsWith(`${pasta}/`)).map((a) => a.replace(/ /g, "%20")) };
  };
  const musica = criarMusica({
    moduleId: MOD,
    playlists: { find: (fn) => playlists.find(fn) },
    criarPlaylist,
    pasta: () => "sounds",
    existe: criarConferenciaDeArquivo(browse),
    reportar: async (corpo) => relatos.push(corpo),
  });
  return { musica, playlists, criadas, atualizacoes, relatos, listagens };
}

const tocar = (faixa, extra = {}) => ({
  pedido_id: P1,
  acao: "tocar",
  faixa_id: faixa,
  nome: faixa === F1 ? "Guardiões da Tumba" : "Batalha na Ponte",
  caminho: faixa === F1 ? "mesa/tumba.mp3" : "CD1/batalha.mp3",
  volume: 0.5,
  loop: true,
  fade_ms: 2000,
  troca: "cruzar",
  ...extra,
});

test("o caminho: a pasta das trilhas + o da biblioteca; endereço completo e caminho já com a pasta ficam", () => {
  assert.equal(caminhoDaFaixa("sounds", "mesa/tumba.mp3"), "sounds/mesa/tumba.mp3");
  assert.equal(caminhoDaFaixa("/sounds/", "/mesa/tumba.mp3"), "sounds/mesa/tumba.mp3");
  assert.equal(caminhoDaFaixa("sounds", "sounds/mesa/tumba.mp3"), "sounds/mesa/tumba.mp3");
  assert.equal(caminhoDaFaixa("", "mesa/tumba.mp3"), "mesa/tumba.mp3");
  assert.equal(caminhoDaFaixa("sounds", "https://x.org/a.mp3"), "https://x.org/a.mp3");
  assert.equal(caminhoDaFaixa("sounds", "  "), null);
});

test("o comando: os padrões, os limites e o que não serve", () => {
  const c = validarComando({ acao: "tocar", faixa_id: F1.toUpperCase(), caminho: "a.mp3", volume: 7, fade_ms: -3 });
  assert.equal(c.faixaId, F1);
  assert.equal(c.volume, 1);
  assert.equal(c.fadeMs, 0);
  assert.equal(c.loop, false);
  assert.equal(c.troca, "cruzar");
  assert.equal(c.nome, "Trilha");
  assert.equal(validarComando({ acao: "tocar", faixa_id: F1, caminho: "a.mp3" }).volume, 0.5);
  assert.throws(() => validarComando({ acao: "dançar" }), /acao_desconhecida/);
  assert.throws(() => validarComando({ acao: "tocar", faixa_id: F1 }), /faixa_sem_id_ou_arquivo/);
  assert.throws(() => validarComando(null), /comando_invalido/);
  assert.equal(validarComando({ acao: "parar" }).faixaId, null);
});

test("tocar a primeira vez: cria a playlist (soundboard, canal música, marcada) e o som, e toca", async () => {
  const f = foundrySimulado();
  assert.deepEqual(f.musica.receber(tocar(F1)), { recebido: true });
  await f.musica.esperar();
  assert.equal(f.playlists.length, 1);
  const pl = f.playlists[0];
  assert.equal(pl.name, NOME_DA_PLAYLIST);
  assert.equal(pl.mode, MODO_SOUNDBOARD);
  assert.equal(pl.channel, CANAL);
  assert.equal(pl.flags[MOD][FLAG_DA_PLAYLIST], true);
  assert.equal(pl.sounds.length, 1);
  const som = pl.sounds[0];
  assert.equal(som.flags[MOD][FLAG_DA_FAIXA], F1);
  assert.equal(som.path, "sounds/mesa/tumba.mp3");
  assert.equal(som.playing, true);
  assert.equal(som.repeat, true);
  assert.equal(som.volume, 0.5);
  assert.equal(som.fade, 2000);
  assert.equal(f.criadas[0].playing, false, "nasce parado e toca pela atualização");
  assert.deepEqual(f.relatos.at(-1), {
    op: "trilha.resultado",
    pedido_id: P1,
    ok: true,
    tocando: [{ faixa_id: F1, nome: "Guardiões da Tumba", caminho: "sounds/mesa/tumba.mp3", volume: 0.5, loop: true }],
  });
});

test("cruzar: a nova entra e a outra sai com o mesmo fade, numa atualização só", async () => {
  const f = foundrySimulado();
  f.musica.receber(tocar(F1));
  f.musica.receber(tocar(F2, { pedido_id: P2, fade_ms: 1200, loop: false }));
  await f.musica.esperar();
  const ultima = f.atualizacoes.at(-1);
  assert.equal(ultima.length, 2);
  const [sai, entra] = ultima;
  assert.deepEqual({ playing: sai.playing, fade: sai.fade }, { playing: false, fade: 1200 });
  assert.deepEqual({ playing: entra.playing, fade: entra.fade, repeat: entra.repeat }, { playing: true, fade: 1200, repeat: false });
  assert.deepEqual(f.relatos.at(-1).tocando.map((t) => t.faixa_id), [F2]);
  assert.equal(f.relatos.at(-1).pedido_id, P2);
});

test("somar: toca por cima; pedir a mesma faixa de novo reusa o som", async () => {
  const f = foundrySimulado();
  f.musica.receber(tocar(F1));
  f.musica.receber(tocar(F2, { troca: "somar" }));
  f.musica.receber(tocar(F1, { volume: 0.3, troca: "somar" }));
  await f.musica.esperar();
  const pl = f.playlists[0];
  assert.equal(pl.sounds.length, 2, "a mesma faixa não duplica");
  assert.deepEqual(
    tocandoAgora(sonsDa(pl, MOD)).map((t) => [t.faixa_id, t.volume]),
    [
      [F1, 0.3],
      [F2, 0.5],
    ],
  );
});

test("parar uma, parar todas e o volume de uma", async () => {
  const f = foundrySimulado();
  f.musica.receber(tocar(F1));
  f.musica.receber(tocar(F2, { troca: "somar" }));
  f.musica.receber({ pedido_id: P2, acao: "volume", faixa_id: F2, caminho: "CD1/batalha.mp3", volume: 0.2, fade_ms: 400 });
  await f.musica.esperar();
  assert.equal(f.playlists[0].sounds.find((s) => s.flags[MOD][FLAG_DA_FAIXA] === F2).volume, 0.2);
  f.musica.receber({ acao: "parar", faixa_id: F1, fade_ms: 500 });
  await f.musica.esperar();
  assert.deepEqual(f.relatos.at(-1).tocando.map((t) => t.faixa_id), [F2]);
  f.musica.receber({ acao: "parar", fade_ms: 500 });
  await f.musica.esperar();
  assert.deepEqual(f.relatos.at(-1).tocando, []);
  assert.ok(f.atualizacoes.at(-1).every((u) => u.playing === false && u.fade === 500 && u.pausedTime === null));
});

test("o arquivo que não existe na pasta: não cria nada e diz qual faltou", async () => {
  const f = foundrySimulado({ arquivos: [] });
  f.musica.receber(tocar(F1));
  await f.musica.esperar();
  assert.equal(f.playlists[0].sounds.length, 0);
  assert.deepEqual(f.relatos.at(-1), { op: "trilha.resultado", pedido_id: P1, ok: false, motivo: "arquivo_nao_achado: sounds/mesa/tumba.mp3", tocando: [] });
});

test("sem como listar a pasta (permissão): toca assim mesmo; a listagem é guardada", async () => {
  const f = foundrySimulado({ semListagem: true });
  f.musica.receber(tocar(F1));
  await f.musica.esperar();
  assert.equal(f.relatos.at(-1).ok, true);
  const g = foundrySimulado();
  g.musica.receber(tocar(F1));
  g.musica.receber(tocar(F1));
  await g.musica.esperar();
  assert.deepEqual(g.listagens, ["sounds/mesa"], "a pasta é listada uma vez por minuto");
  const conferir = criarConferenciaDeArquivo(async () => ({ files: ["sounds/mesa/a%20b.mp3"] }));
  assert.equal(await conferir("sounds/mesa/a b.mp3"), true, "o nome com espaço (a listagem vem codificada)");
  assert.equal(await conferir("https://x.org/a.mp3"), null);
});

test("os comandos na ordem em que chegaram, e a playlist criada uma vez só", async () => {
  const f = foundrySimulado();
  f.musica.receber(tocar(F1));
  f.musica.receber({ acao: "parar", fade_ms: 0 });
  f.musica.receber(tocar(F2));
  await f.musica.esperar();
  assert.equal(f.playlists.length, 1);
  assert.deepEqual(f.relatos.map((r) => r.tocando.map((t) => t.faixa_id)), [[F1], [], [F2]]);
});

test("comando que não serve: responde não recebido e relata a falha com o pedido", () => {
  const f = foundrySimulado();
  assert.deepEqual(f.musica.receber({ pedido_id: P1, acao: "tocar" }), { recebido: false, motivo: "faixa_sem_id_ou_arquivo" });
  assert.deepEqual(f.relatos.at(-1), { op: "trilha.resultado", pedido_id: P1, ok: false, motivo: "faixa_sem_id_ou_arquivo", tocando: [] });
});

test("o que muda no próprio Foundry vai ao Companion, sem repetir o estado que já foi", async () => {
  const f = foundrySimulado();
  f.musica.receber(tocar(F1));
  await f.musica.esperar();
  const antes = f.relatos.length;
  f.musica.mudouNoFoundry(f.playlists[0]);
  assert.equal(f.relatos.length, antes, "o mesmo estado não sai de novo");
  f.playlists[0].sounds[0].playing = false; // a faixa acabou, ou o GM parou
  f.musica.mudouNoFoundry(f.playlists[0]);
  assert.deepEqual(f.relatos.at(-1), { op: "trilha.resultado", ok: true, tocando: [] });
  assert.equal(f.musica.ePlaylistDaMusica(f.playlists[0]), true);
  assert.equal(f.musica.ePlaylistDaMusica({ flags: {} }), false);
});

test("ao abrir o mundo: relata o que toca, sem criar a playlist", () => {
  const f = foundrySimulado();
  f.musica.relatarAoAbrir();
  assert.equal(f.playlists.length, 0);
  assert.deepEqual(f.relatos.at(-1), { op: "trilha.resultado", ok: true, tocando: [] });
});

test("o plano é puro: o volume de faixa fora da playlist e tocar sem o som criado lançam", () => {
  const c = validarComando({ acao: "volume", faixa_id: F1, caminho: "a.mp3", volume: 0.1 });
  assert.throws(() => planoDoComando(c, [], null), /faixa_nao_esta_na_playlist/);
  const t = validarComando(tocar(F1));
  assert.throws(() => planoDoComando(t, [], "x"), /som_nao_criado/);
  assert.deepEqual(planoDoComando(validarComando({ acao: "estado" }), [], null), []);
});

test("a op audio.comando está no bridge-client e o módulo registra a música no ready", () => {
  const cliente = readFileSync(new URL("../scripts/bridge-client.js", import.meta.url), "utf8");
  assert.match(cliente, /case "audio\.comando":\s*\n\s*result = \{ data: receberComandoDeAudio\(payload\) \};/);
  const main = readFileSync(new URL("../scripts/main.js", import.meta.url), "utf8");
  assert.match(main, /registerMusica\(\);/);
  const settings = readFileSync(new URL("../scripts/settings.js", import.meta.url), "utf8");
  assert.match(settings, /"pastaDasTrilhas"[\s\S]*default: "sounds"/);
});
