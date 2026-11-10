/**
 * O SAQUE (saque.js, v1.25.0), sem Foundry: os três sinais de morte, a memória
 * que não repete o corpo, o comando da ponte, a resposta da edge, a rolagem
 * de Investigação com a nossa flag (e ela FORA da música), os textos e o
 * escape de tudo o que vem de fora, nos cartões e na janela.
 *
 * Não prova que o Foundry de verdade dispara os ganchos, entrega o sussurro
 * ou abre a janela: isso é o roteiro com o Foundry aberto (docs/SAQUE.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  ACOES_DO_COMANDO,
  QUERY_ABRIR_SAQUE,
  QUERY_DECIDIR_SAQUE,
  classeDaRaridade,
  corpoDaDecisao,
  corpoDoAtor,
  criarMemoriaDeMortes,
  dadosDaJanela,
  decisaoDoAchado,
  depoisDaDecisao,
  depoisDoEnvioDoSaque,
  escapar,
  estadoInicial,
  faixaEmPortugues,
  fonteEmPalavras,
  fraseDaFalha,
  htmlDaJanela,
  htmlDoCartaoDeEncerrada,
  htmlDoCartaoDeMorte,
  htmlDoCartaoDePedido,
  htmlDoCartaoDeResultado,
  htmlDoCartaoDeRolar,
  htmlDoCartaoResolvido,
  htmlDoCartaoSemAtor,
  imagemDoAchado,
  mandarComRetentativa,
  morreuPeloDano,
  mortoPeloCombatente,
  mortoPeloEfeito,
  pendentesDaJanela,
  raridadeEmPortugues,
  rolagemDoSaque,
  textoDasMoedas,
  textoDasPropriedades,
  textoDaSintonia,
  textoPuro,
  validarComando,
} from "../scripts/saque.js";
import { testeDaMensagem } from "../scripts/combate.js";

const MODULE_ID = "companion-foundry-bridge";
const raiz = (c) => new URL(`../${c}`, import.meta.url);
const moduleJson = JSON.parse(readFileSync(raiz("module.json"), "utf8"));

const npc = (hp, extra = {}) => ({ type: "npc", id: "AtorGoblin", uuid: "Scene.s1.Token.t1.Actor.AtorGoblin", name: "Goblin", system: { attributes: { hp: { value: hp } } }, ...extra });
const pc = (hp) => ({ type: "character", id: "AtorGuldrum", uuid: "Actor.AtorGuldrum", name: "Guldrum", system: { attributes: { hp: { value: hp } } } });
const MAU = `<script>alert(1)</script><img src=x onerror="x()">`;

/* ── os sinais de morte ── */

test("dano: só o NPC que passa de PV acima de 0 para 0 ou menos", () => {
  // o gancho roda depois da gravação: hp.value é o de AGORA, changes.hp = agora − antes
  assert.equal(morreuPeloDano(npc(0), { hp: -7, temp: 0, total: -7 }), true, "7 → 0");
  assert.equal(morreuPeloDano(npc(-3), { hp: -5, temp: 0, total: -5 }), true, "2 → −3");
  assert.equal(morreuPeloDano(npc(2), { hp: -5, temp: 0, total: -5 }), false, "7 → 2: vivo");
  assert.equal(morreuPeloDano(npc(0), { hp: 0, temp: -4, total: -4 }), false, "já estava em 0 (só os temporários)");
  assert.equal(morreuPeloDano(npc(0), { hp: -0, temp: 0, total: 0 }), false);
  assert.equal(morreuPeloDano(pc(0), { hp: -9, temp: 0, total: -9 }), false, "personagem não vira corpo");
  assert.equal(morreuPeloDano(npc(0, { uuid: "" }), { hp: -9 }), false, "sem uuid não há chave do corpo");
  assert.equal(morreuPeloDano(npc(undefined), { hp: -9 }), false);
  assert.equal(morreuPeloDano(null, { hp: -9 }), false);
  assert.equal(morreuPeloDano(npc(0), null), false);
});

test("efeito: o estado de derrotado num NPC (Set ou lista); em item ou em PC, não", () => {
  const ator = npc(5);
  assert.equal(mortoPeloEfeito({ statuses: new Set(["dead"]), parent: ator }, "dead"), ator);
  assert.equal(mortoPeloEfeito({ statuses: ["prone", "dead"], parent: ator }, "dead"), ator);
  assert.equal(mortoPeloEfeito({ statuses: new Set(["prone"]), parent: ator }, "dead"), null);
  assert.equal(mortoPeloEfeito({ statuses: new Set(["dead"]), parent: pc(0) }, "dead"), null);
  assert.equal(mortoPeloEfeito({ statuses: new Set(["dead"]), parent: { type: "weapon", uuid: "Item.x" } }, "dead"), null, "efeito de item");
  assert.equal(mortoPeloEfeito({ statuses: new Set(["dead"]), parent: ator }, undefined), null, "sem o nome do estado no CONFIG");
  // o mundo que trocou o estado de derrotado
  assert.equal(mortoPeloEfeito({ statuses: new Set(["caido"]), parent: ator }, "caido"), ator);
});

test("combatente: só `defeated: true` de um NPC", () => {
  const ator = npc(3);
  assert.equal(mortoPeloCombatente({ actor: ator }, { defeated: true }), ator);
  assert.equal(mortoPeloCombatente({ actor: ator }, { defeated: false }), null);
  assert.equal(mortoPeloCombatente({ actor: ator }, { initiative: 12 }), null);
  assert.equal(mortoPeloCombatente({ actor: pc(0) }, { defeated: true }), null);
  assert.equal(mortoPeloCombatente({ actor: null }, { defeated: true }), null);
});

test("o corpo: uuid do ator do token, nome do token, nome do ator de base", () => {
  const ator = npc(0, { name: "Goblin", token: { name: "Goblin Batedor" } });
  assert.deepEqual(corpoDoAtor(ator, { nomeDeBase: "Goblin" }), {
    op: "saque.morreu",
    ator_uuid: "Scene.s1.Token.t1.Actor.AtorGoblin",
    ator_id: "AtorGoblin",
    nome: "Goblin Batedor",
    nome_ator: "Goblin",
  });
  // o nome do token do combatente vence; sem token, o do ator
  assert.equal(corpoDoAtor(ator, { nomeDoToken: "Goblin 2" }).nome, "Goblin 2");
  assert.equal(corpoDoAtor(npc(0)).nome, "Goblin");
  assert.equal(corpoDoAtor(npc(0)).nome_ator, "Goblin");
  assert.equal(corpoDoAtor(pc(0)), null);
});

test("a memória não repete o mesmo uuid; dois goblins do mesmo ator são dois corpos", () => {
  const m = criarMemoriaDeMortes();
  assert.equal(m.nova("Scene.s1.Token.t1.Actor.AtorGoblin"), true, "o dano");
  assert.equal(m.nova("Scene.s1.Token.t1.Actor.AtorGoblin"), false, "depois o HUD");
  assert.equal(m.nova("Scene.s1.Token.t1.Actor.AtorGoblin"), false, "depois o Combat Tracker");
  assert.equal(m.nova("Scene.s1.Token.t2.Actor.AtorGoblin"), true, "o outro goblin");
  assert.equal(m.nova(""), false);
  assert.equal(m.nova(null), false);
  assert.equal(m.tamanho(), 2);
  // o aviso que não chegou: o próximo sinal tenta de novo
  m.esquecer("Scene.s1.Token.t1.Actor.AtorGoblin");
  assert.equal(m.nova("Scene.s1.Token.t1.Actor.AtorGoblin"), true);
});

/* ── a edge ── */

test("a resposta da edge: pronto, recusado (200 com ok falso), descarta, repete", () => {
  assert.equal(depoisDoEnvioDoSaque({ ok: true, corpo_id: "c1" }), "pronto");
  assert.equal(depoisDoEnvioDoSaque({ ok: false, error: "Esta revista já foi rolada.", recusado: true }), "recusado");
  assert.equal(depoisDoEnvioDoSaque({ ok: false, motivo: "sem_sessao" }), "recusado");
  assert.equal(depoisDoEnvioDoSaque({ ok: false, status: 401, code: null }), "descarta");
  assert.equal(depoisDoEnvioDoSaque({ ok: false, status: 400 }), "descarta");
  assert.equal(depoisDoEnvioDoSaque({ ok: false, status: 429 }), "repete");
  assert.equal(depoisDoEnvioDoSaque({ ok: false, status: 503 }), "repete");
  assert.equal(depoisDoEnvioDoSaque(null), "repete", "sem rede");
});

test("até 3 tentativas, só no que vale repetir", async () => {
  const esperas = [];
  const esperar = async (ms) => void esperas.push(ms);
  let n = 0;
  let r = await mandarComRetentativa({ op: "saque.morreu" }, { enviar: async () => (++n < 3 ? null : { ok: true }), esperar });
  assert.deepEqual([n, r, esperas], [3, { ok: true }, [3000, 6000]]);

  n = 0;
  r = await mandarComRetentativa({ op: "saque.rolou" }, { enviar: async () => (++n, { ok: false, status: 500 }), esperar });
  assert.equal(n, 3, "desiste na terceira");
  assert.equal(r.status, 500);

  n = 0;
  r = await mandarComRetentativa({ op: "saque.rolou" }, { enviar: async () => (++n, { ok: false, error: "Já rolada.", recusado: true }), esperar });
  assert.equal(n, 1, "a recusa de regra não repete");
  n = 0;
  await mandarComRetentativa({ op: "saque.morreu" }, { enviar: async () => (++n, { ok: false, status: 401 }), esperar });
  assert.equal(n, 1, "chave errada não repete");
});

test("a frase da falha: a do Companion, senão uma nossa", () => {
  assert.equal(fraseDaFalha({ ok: false, error: "Este corpo já foi fechado.", recusado: true }), "Este corpo já foi fechado.");
  assert.match(fraseDaFalha({ ok: false, motivo: "sem_sessao" }), /sessão/);
  assert.match(fraseDaFalha({ ok: false, motivo: "desligado" }), /desligado/);
  assert.match(fraseDaFalha({ ok: false, status: 401 }), /chave/);
  assert.match(fraseDaFalha(null), /não respondeu/);
});

/* ── a rolagem ── */

const mensagem = (extra = {}) => ({
  id: "Msg1",
  speaker: { actor: "AtorGuldrum" },
  flags: { dnd5e: { roll: { type: "skill", skillId: "inv" } }, [MODULE_ID]: { saque: "rev-1" } },
  rolls: [{ total: 17 }],
  ...extra,
});

test("o total da mensagem: a nossa flag e a primeira rolagem", () => {
  assert.deepEqual(rolagemDoSaque(mensagem()), { op: "saque.rolou", revista_id: "rev-1", total: 17, mensagem_id: "Msg1" });
  assert.equal(rolagemDoSaque(mensagem({ rolls: [{ total: 12.6 }] })).total, 13, "inteiro");
  assert.equal(rolagemDoSaque(mensagem({ rolls: [{ total: -1 }] })).total, -1);
  assert.equal(rolagemDoSaque(mensagem({ rolls: [] })), null, "sem rolagem");
  assert.equal(rolagemDoSaque(mensagem({ rolls: [{ total: "17" }] })), null, "total que não é número");
  assert.equal(rolagemDoSaque(mensagem({ rolls: [{ total: NaN }] })), null);
  assert.equal(rolagemDoSaque(mensagem({ flags: { dnd5e: { roll: { type: "skill", skillId: "inv" } } } })), null, "Investigação comum");
  assert.equal(rolagemDoSaque(mensagem({ flags: { [MODULE_ID]: { saque: { id: "x" } } } })), null, "flag que não é id");
  assert.equal(rolagemDoSaque(mensagem({ flags: { [MODULE_ID]: { saque: "a b<c>" } } })), null);
  assert.equal(rolagemDoSaque(mensagem({ id: undefined })), null);
  assert.equal(rolagemDoSaque(null), null);
});

test("a Investigação do saque fica FORA da música; a comum continua indo", () => {
  const tipoDoAtor = () => "character";
  assert.equal(testeDaMensagem(mensagem(), { tipoDoAtor }), null);
  const comum = mensagem({ flags: { dnd5e: { roll: { type: "skill", skillId: "inv" } } } });
  assert.deepEqual(testeDaMensagem(comum, { tipoDoAtor }), { pericia: "inv", evento_id: "m-Msg1" });
  // a flag de outra coisa do módulo (a iniciativa) não tira o teste da música
  const outra = mensagem({ flags: { dnd5e: { roll: { type: "skill", skillId: "prc" } }, [MODULE_ID]: { iniciativa: {} } } });
  assert.deepEqual(testeDaMensagem(outra, { tipoDoAtor }), { pericia: "prc", evento_id: "m-Msg1" });
});

/* ── o comando da ponte ── */

const comando = (acao, extra = {}) => ({
  aviso_id: "av-1",
  acao,
  corpo: { id: "corpo-1", nome: "Goblin", sem_ficha: false, sorteado: true, fechado: false, foundry_ator_uuid: "Scene.s1.Token.t1.Actor.AtorGoblin" },
  revista: { id: "rev-1", estado: "rolada", total: 17, total_origem: "foundry", faixa: "boa" },
  pc: { id: "pc-1", nome: "Guldrum", foundry_actor_id: "AtorGuldrum" },
  pcs: [{ id: "pc-1", nome: "Guldrum", foundry_actor_id: "AtorGuldrum" }],
  achados: null,
  pegou: null,
  ...extra,
});

test("o payload de saque.comando: as cinco ações e o que cada uma exige", () => {
  for (const acao of ACOES_DO_COMANDO) {
    const p = comando(acao, acao === "revelada" ? { achados: [] } : {});
    assert.deepEqual(validarComando(p), { ok: true }, acao);
  }
  assert.deepEqual(validarComando(comando("explodir")), { ok: false, motivo: "acao_desconhecida: explodir" });
  assert.deepEqual(validarComando({}), { ok: false, motivo: "acao_desconhecida: undefined" });
  assert.deepEqual(validarComando(null), { ok: false, motivo: "acao_desconhecida: undefined" });
  assert.equal(validarComando(comando("pedido", { corpo: null })).motivo, "sem_corpo");
  assert.equal(validarComando(comando("pedido", { pc: { nome: "x" } })).motivo, "sem_pc");
  assert.equal(validarComando(comando("liberada", { revista: null })).motivo, "sem_revista");
  assert.equal(validarComando(comando("resultado", { revista: { id: 7 } })).motivo, "sem_revista");
  assert.equal(validarComando(comando("revelada")).motivo, "sem_achados", "revelada sem lista");
  assert.equal(validarComando(comando("resultado", { achados: "x" })).motivo, "achados_invalidos");
  // o pedido não tem revista ainda; a encerrada não precisa de pc
  assert.deepEqual(validarComando(comando("pedido", { revista: null })), { ok: true });
  assert.deepEqual(validarComando(comando("encerrada", { pc: null, revista: null })), { ok: true });
  // o pc sem ator no Foundry é válido (vira o cartão "digite no Companion")
  assert.deepEqual(validarComando(comando("liberada", { pc: { id: "pc-2", nome: "Talaniel", foundry_actor_id: null } })), { ok: true });
});

test("os nomes das perguntas têm o prefixo do módulo (CONFIG.queries)", () => {
  assert.ok(QUERY_ABRIR_SAQUE.startsWith(`${moduleJson.id}.`));
  assert.ok(QUERY_DECIDIR_SAQUE.startsWith(`${moduleJson.id}.`));
  assert.notEqual(QUERY_ABRIR_SAQUE, QUERY_DECIDIR_SAQUE);
});

/* ── os textos ── */

test("as moedas: da maior para a menor, só as maiores que zero, nas siglas da mesa", () => {
  assert.equal(textoDasMoedas({ pp: 0, gp: 3, ep: 0, sp: 8, cp: 0 }), "3 po, 8 pp");
  assert.equal(textoDasMoedas({ pp: 1, gp: 2, ep: 3, sp: 4, cp: 5 }), "1 pl, 2 po, 3 pe, 4 pp, 5 pc");
  assert.equal(textoDasMoedas({ cp: 12 }), "12 pc");
  assert.equal(textoDasMoedas({ gp: "4" }), "4 po", "número em texto");
  assert.equal(textoDasMoedas({ gp: 0, sp: -2, cp: null }), "");
  assert.equal(textoDasMoedas({ gp: "<b>" }), "");
  assert.equal(textoDasMoedas(null), "");
  assert.equal(textoDasMoedas("3 po"), "");
});

test("raridade, faixa e fonte em português; o que não existe vira vazio", () => {
  assert.deepEqual(["comum", "incomum", "raro", "muito_raro", "lendario"].map(raridadeEmPortugues), ["Comum", "Incomum", "Raro", "Muito raro", "Lendário"]);
  assert.equal(raridadeEmPortugues("artefato"), "");
  assert.equal(raridadeEmPortugues("constructor"), "", "chave do protótipo não é raridade");
  assert.equal(classeDaRaridade("muito_raro"), "cfb-saque-raridade--muito-raro");
  assert.equal(classeDaRaridade('x" onclick="y'), "");
  assert.deepEqual(["baixa", "media", "boa", "alta"].map(faixaEmPortugues), ["baixa", "média", "boa", "alta"]);
  assert.equal(faixaEmPortugues("x"), "");
  assert.deepEqual(["usava", "bolso", "tabela", "sempre", "moedas"].map(fonteEmPalavras), ["usava", "no bolso", "tabela do Mestre", "sempre com ele", "moedas"]);
  assert.equal(fonteEmPalavras(undefined), "");
});

test("as propriedades em texto, lista ou objeto, sem quebrar", () => {
  assert.equal(textoDasPropriedades("Acuidade, Leve"), "Acuidade, Leve");
  assert.equal(textoDasPropriedades(["Acuidade", { nome: "Leve" }, { label: "Arremesso" }, null, 2, {}]), "Acuidade, Leve, Arremesso, 2");
  assert.equal(textoDasPropriedades({ fin: true, lgt: false, alcance: "6 m", cargas: 3, x: null, y: {} }), "fin, alcance: 6 m, cargas: 3");
  for (const v of [null, undefined, 7, true, [], {}]) assert.equal(textoDasPropriedades(v), "");
});

test("a sintonia e a imagem", () => {
  assert.equal(textoDaSintonia(true), "Exige sintonia");
  assert.equal(textoDaSintonia("por um clérigo"), "Sintonia: por um clérigo");
  assert.equal(textoDaSintonia(false), "");
  assert.equal(textoDaSintonia(null), "");
  assert.equal(imagemDoAchado({ imagem_url: "https://x.supabase.co/a.webp", img: "icons/a.webp" }), "https://x.supabase.co/a.webp");
  assert.equal(imagemDoAchado({ imagem_url: "http://x/a.webp", img: "icons/a.webp" }), "icons/a.webp", "http não: cai no caminho do Foundry");
  assert.equal(imagemDoAchado({ img: "icons/weapons/daggers/dagger.webp" }, (c) => `/vtt/${c}`), "/vtt/icons/weapons/daggers/dagger.webp");
  assert.equal(imagemDoAchado({ img: "javascript:alert(1)" }), null);
  assert.equal(imagemDoAchado({ img: "data:image/svg+xml,<svg onload=x>" }), null);
  assert.equal(imagemDoAchado({ img: "//mau.example/x.png" }), null);
  assert.equal(imagemDoAchado({ img: 'a.png" onerror="x' }), null);
  assert.equal(imagemDoAchado({ imagem_url: 'https://x/a.png" onerror="x' }), null);
  assert.equal(imagemDoAchado({}), null);
});

test("a descrição vira texto puro, com as quebras de linha", () => {
  assert.equal(textoPuro("<p>Uma adaga.</p><p>Brilha<br>no escuro.</p>"), "Uma adaga.\nBrilha\nno escuro.");
  assert.equal(textoPuro("linha 1\r\nlinha 2\n\n\n\nlinha 3"), "linha 1\nlinha 2\n\nlinha 3");
  assert.equal(textoPuro(null), "");
  assert.equal(textoPuro({}), "");
});

/* ── o escape, nos cartões ── */

/** Nenhuma marca de fora sobrevive: nem a tag, nem o atributo solto. */
function semHtmlDeFora(html, onde) {
  assert.ok(!/<script/i.test(html), `${onde}: <script> passou`);
  assert.ok(!/<img src=x/i.test(html), `${onde}: <img> de fora passou`);
  assert.ok(!/onerror="x\(\)"/i.test(html), `${onde}: atributo de fora passou`);
}

test("escapar: os cinco caracteres, e nulo vira vazio", () => {
  assert.equal(escapar(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  assert.equal(escapar(null), "");
  assert.equal(escapar(7), "7");
});

test("os cartões escapam o nome do corpo, do personagem e dos achados", () => {
  const pcMau = { id: "pc-1", nome: MAU, foundry_actor_id: "AtorGuldrum" };
  const corpoMau = { id: "corpo-1", nome: MAU };
  const cartoes = {
    morte: htmlDoCartaoDeMorte({ corpo_id: "corpo-1", nome: MAU, pcs: [pcMau], sem_ficha: true }),
    pedido: htmlDoCartaoDePedido({ corpo: corpoMau, pc: pcMau }),
    rolar: htmlDoCartaoDeRolar({ corpo: corpoMau, pc: pcMau, revista: { id: "rev-1" }, ator_id: "AtorGuldrum" }),
    sem_ator: htmlDoCartaoSemAtor({ corpo: corpoMau, pc: pcMau }),
    resultado: htmlDoCartaoDeResultado({
      corpo: corpoMau,
      pc: pcMau,
      revista: { id: "rev-1", total: 17, faixa: "boa" },
      achados: [
        { id: "a1", tipo: "moedas", moedas_texto: MAU },
        { id: "a2", tipo: "item", nome: MAU, nome_real: MAU, identificado: false, raridade: MAU, fonte: MAU },
      ],
    }),
    encerrada: htmlDoCartaoDeEncerrada({ pegou: `Guldrum pegou: ${MAU}` }),
    resolvido: htmlDoCartaoResolvido(`Liberado para ${MAU}.`),
  };
  for (const [nome, html] of Object.entries(cartoes)) {
    semHtmlDeFora(html, nome);
    assert.ok(html.includes("&lt;script&gt;"), `${nome}: o texto aparece escapado`);
    assert.ok(!html.includes("data-action"), `${nome}: os botões do chat não usam data-action`);
  }
  // o valor de um data-* não fecha o atributo
  const m = htmlDoCartaoDeMorte({ corpo_id: "corpo-1", nome: "Goblin", pcs: [{ id: "pc-1", nome: `Gul" data-pc="outro` }] });
  assert.ok(m.includes(`data-pc-nome="Gul&quot; data-pc=&quot;outro"`));
  assert.equal((m.match(/ data-pc="/g) ?? []).length, 1);
});

test("o cartão da morte: um botão por personagem, o Sem saque e o aviso da ficha", () => {
  const html = htmlDoCartaoDeMorte({
    corpo_id: "corpo-1",
    nome: "Goblin Batedor",
    pcs: [{ id: "pc-1", nome: "Guldrum" }, { id: "pc-2", nome: "Talaniel" }, { nome: "sem id" }],
  });
  assert.ok(html.includes("<strong>Goblin Batedor</strong> caiu."));
  assert.ok(html.includes("Liberar a revista para:"));
  assert.equal((html.match(/data-cfb-acao="saque-liberar"/g) ?? []).length, 2);
  assert.ok(html.includes(`data-cfb-acao="saque-liberar" data-corpo="corpo-1" data-pc="pc-2" data-pc-nome="Talaniel">Talaniel</button>`));
  assert.ok(html.includes(`data-cfb-acao="saque-fechar" data-corpo="corpo-1">Sem saque</button>`));
  assert.ok(!html.includes("não achou a ficha"));
  assert.ok(htmlDoCartaoDeMorte({ corpo_id: "c", nome: "X", pcs: [], sem_ficha: true }).includes("O Companion não achou a ficha desta criatura"));
});

test("os cartões do pedido, de rolar e do personagem sem ator", () => {
  const corpo = { id: "corpo-1", nome: "Goblin" };
  const quem = { id: "pc-1", nome: "Guldrum" };
  const pedido = htmlDoCartaoDePedido({ corpo, pc: quem });
  assert.ok(pedido.includes("<strong>Guldrum</strong> quer revistar <strong>Goblin</strong>"));
  assert.ok(pedido.includes(`data-cfb-acao="saque-liberar" data-corpo="corpo-1" data-pc="pc-1" data-pc-nome="Guldrum">Liberar para Guldrum</button>`));
  const rolar = htmlDoCartaoDeRolar({ corpo, pc: quem, revista: { id: "rev-1" }, ator_id: "AtorGuldrum" });
  assert.ok(rolar.includes("Role Investigação."));
  assert.ok(rolar.includes(`data-cfb-acao="saque-rolar" data-revista="rev-1" data-ator="AtorGuldrum">Rolar Investigação</button>`));
  const sem = htmlDoCartaoSemAtor({ corpo, pc: quem });
  assert.ok(sem.includes("não tem ator ligado no Foundry: peça o total e digite no Companion."));
  assert.ok(!sem.includes("<button"));
});

test("o cartão do resultado (só do Mestre): cada achado, a fonte, o fora da regra e o nome de verdade", () => {
  const html = htmlDoCartaoDeResultado({
    corpo: { id: "corpo-1", nome: "Goblin" },
    pc: { id: "pc-1", nome: "Guldrum" },
    revista: { id: "rev-1", total: 17, faixa: "media" },
    achados: [
      { id: "a1", tipo: "moedas", moedas_texto: "3 po, 8 pp", fonte: "moedas" },
      { id: "a2", tipo: "item", nome: "Adaga", quantidade: 2, identificado: true, raridade: "raro", fonte: "usava" },
      { id: "a3", tipo: "item", nome: "Pacote lacrado", nome_real: "Carta do Zhentarim", identificado: false, raridade: "incomum", fonte: "tabela", quebra_regra: true },
      { id: "a4", tipo: "item", nome: "Chave", identificado: true, fonte: "sempre" },
    ],
  });
  assert.ok(html.includes("O que <strong>Goblin</strong> tinha (Guldrum tirou 17, faixa média):"));
  assert.ok(html.includes("<li>3 po, 8 pp</li>"));
  assert.ok(html.includes("<strong>Adaga</strong> x2"));
  assert.ok(html.includes("· raro · usava"));
  assert.ok(html.includes("<strong>Pacote lacrado</strong> (de verdade: Carta do Zhentarim)"));
  assert.ok(html.includes("tabela do Mestre"));
  assert.ok(html.includes("⚠ fora da regra"));
  assert.ok(html.includes("sempre com ele"));
  assert.ok(html.includes(`data-cfb-acao="saque-revelar" data-revista="rev-1" data-pc-nome="Guldrum">Revelar a Guldrum</button>`));

  const nada = htmlDoCartaoDeResultado({ corpo: { nome: "Rato" }, pc: { nome: "Guldrum" }, revista: { id: "rev-2", total: 4, faixa: "baixa" }, achados: [] });
  assert.ok(nada.includes("<p>Nada.</p>"));
  assert.ok(nada.includes("saque-revelar"), "o Nada também se revela");

  const semFicha = htmlDoCartaoDeResultado({ corpo: { nome: "Coisa", sem_ficha: true }, pc: { nome: "Guldrum" }, revista: { id: "rev-3" }, achados: null });
  assert.ok(semFicha.includes("Escolha a criatura deste corpo no Companion: o sorteio sai na hora."));
  assert.ok(!semFicha.includes("<button"));
});

test("o cartão do fim: o texto que veio, ou nenhum cartão", () => {
  assert.ok(htmlDoCartaoDeEncerrada({ pegou: "Guldrum revistou Goblin e pegou: 3 po, Adaga" }).includes("Guldrum revistou Goblin e pegou: 3 po, Adaga"));
  assert.equal(htmlDoCartaoDeEncerrada({ pegou: null }), null);
  assert.equal(htmlDoCartaoDeEncerrada({ pegou: "  " }), null);
});

/* ── a janela ── */

const revelada = () =>
  comando("revelada", {
    achados: [
      { id: "a2", tipo: "item", quantidade: 2, nome: "Adaga do Corvo", identificado: true, raridade: "raro", tipo_item: "Arma", subtipo: "Adaga",
        img: "icons/dagger.webp", imagem_url: null, dano: "1d4", tipo_dano: "perfurante", ca: null, alcance: "6/18 m",
        propriedades: ["Acuidade", "Leve"], peso: 0.5, sintonia: true, descricao: "<p>Lâmina escura.</p><p>Fria.</p>", decisao: null, pego: false },
      { id: "a1", tipo: "moedas", quantidade: 1, moedas: { pp: 0, gp: 3, ep: 0, sp: 8, cp: 0 }, decisao: null, pego: false },
      { id: "a3", tipo: "item", quantidade: 1, nome: "Pacote lacrado", identificado: false, tipo_item: "Objeto", imagem_url: "https://x.supabase.co/p.webp",
        descricao: "Fechado com cera.", raridade: "lendario", dano: "9d9", propriedades: ["Segredo"], sintonia: true, subtipo: "Carta", decisao: null, pego: false },
      { id: "a4", tipo: "item", quantidade: 1, nome: "Anel", identificado: true, raridade: "comum", tipo_item: "Joia", decisao: "pegou", pego: true },
      { id: "a5", tipo: "item", quantidade: 1, nome: "Frasco", identificado: true, tipo_item: "Poção", decisao: "deixou", pego: false },
    ],
  });

test("o que vai ao navegador do jogador: só o que a janela usa, nada do Mestre", () => {
  const d = dadosDaJanela(revelada());
  assert.deepEqual(Object.keys(d).sort(), ["achados", "corpo", "pc", "revista_id"]);
  assert.deepEqual([d.revista_id, d.corpo, d.pc, d.achados.length], ["rev-1", "Goblin", "Guldrum", 5]);
  assert.ok(!JSON.stringify(d).includes("foundry_ator_uuid"));
  assert.ok(!JSON.stringify(d).includes("faixa"));
  // a segunda trava: o que não é da janela não passa, e o não identificado vai só com a fachada
  const vazado = dadosDaJanela(comando("revelada", { achados: [
    { id: "a1", tipo: "item", nome: "Pacote", nome_real: "Carta", fonte: "tabela", quebra_regra: true, identificado: false, raridade: "lendario", dano: "9d9", descricao: "x" },
    { id: "a2", tipo: "item", nome: "Adaga", nome_real: "Adaga", fonte: "usava", identificado: true, raridade: "raro", dano: "1d4" },
  ] }));
  assert.deepEqual(vazado.achados[0], { id: "a1", tipo: "item", nome: "Pacote", identificado: false, descricao: "x" });
  assert.deepEqual(vazado.achados[1], { id: "a2", tipo: "item", nome: "Adaga", identificado: true, raridade: "raro", dano: "1d4" });
});

test("a janela: as moedas primeiro, o item com tudo, o não identificado só com a fachada, o já decidido sem botões", () => {
  const d = dadosDaJanela(revelada());
  const html = htmlDaJanela(d, estadoInicial(), { rota: (c) => `/vtt/${c}` });
  assert.ok(html.includes("O que você achou em Goblin</h2>"));
  // as moedas vêm antes do item, mesmo chegando depois
  assert.ok(html.indexOf("3 po, 8 pp") < html.indexOf("Adaga do Corvo"));
  assert.ok(html.includes(`data-action="pegar" data-achado="a1">Pegar as moedas</button>`));
  assert.equal((html.match(/Pegar as moedas/g) ?? []).length, 1);
  // o item identificado
  assert.ok(html.includes(`<img class="cfb-saque-imagem" src="/vtt/icons/dagger.webp" alt="" loading="lazy">`));
  assert.ok(html.includes("Adaga do Corvo x2</h3>"));
  assert.ok(html.includes(`<span class="cfb-saque-raridade cfb-saque-raridade--raro">Raro</span> · Arma · Adaga`));
  for (const t of ["<dt>Dano</dt><dd>1d4 perfurante</dd>", "<dt>Alcance</dt><dd>6/18 m</dd>", "<dt>Propriedades</dt><dd>Acuidade, Leve</dd>", "<dt>Peso</dt><dd>0.5</dd>", "Exige sintonia"]) {
    assert.ok(html.includes(t), t);
  }
  assert.ok(!html.includes("<dt>CA</dt>"), "CA nula não aparece");
  assert.ok(html.includes(`<p class="cfb-saque-descricao">Lâmina escura.\nFria.</p>`), "texto puro com quebra");
  assert.ok(html.includes(`data-action="pegar" data-achado="a2">Pegar</button>`));
  assert.ok(html.includes(`data-action="deixar" data-achado="a2">Deixar</button>`));
  // o não identificado: só nome, tipo, imagem e descrição, mesmo que o resto tenha vindo
  const pacote = html.slice(html.indexOf('src="https://x.supabase.co/p.webp"'), html.indexOf("Anel</h3>"));
  assert.ok(pacote.includes("Pacote lacrado</h3>"));
  assert.ok(pacote.includes(`<span class="cfb-saque-nao-identificado">Não identificado</span> · Objeto`));
  assert.ok(pacote.includes("Fechado com cera."));
  for (const proibido of ["Lendário", "9d9", "Segredo", "sintonia", "Carta", "cfb-saque-raridade"]) assert.ok(!pacote.includes(proibido), `o não identificado mostrou ${proibido}`);
  // os já decididos
  const anel = html.slice(html.indexOf("Anel</h3>"), html.indexOf("Frasco</h3>"));
  assert.ok(anel.includes("Você pegou.") && !anel.includes("<button"));
  const frasco = html.slice(html.indexOf("Frasco</h3>"));
  assert.ok(frasco.includes("Você deixou.") && !frasco.includes('data-achado="a5"'));
  // ainda há o que decidir: sem rodapé
  assert.ok(!html.includes("Tudo decidido."));
  assert.equal(pendentesDaJanela(d, estadoInicial()), 3);
});

test("a janela escapa TODO texto de fora (nome com <script>, descrição, tipo, moedas, erro)", () => {
  const d = dadosDaJanela(
    comando("revelada", {
      corpo: { id: "corpo-1", nome: MAU },
      achados: [
        { id: "a1", tipo: "moedas", moedas: { gp: MAU }, moedas_texto: MAU },
        { id: "a2", tipo: "item", nome: MAU, identificado: true, raridade: MAU, tipo_item: MAU, subtipo: MAU, dano: MAU, tipo_dano: MAU, ca: MAU,
          alcance: MAU, propriedades: [MAU, { nome: MAU }], peso: MAU, sintonia: MAU, descricao: `texto ${MAU} & fim`, img: `x" onerror="x()`, imagem_url: `javascript:${MAU}` },
        { id: "a3", tipo: "item", nome: MAU, identificado: false, tipo_item: MAU, descricao: MAU, propriedades: { [MAU]: true, k: MAU } },
        { id: `a4" onclick="x()`, tipo: "item", nome: "id ruim" },
      ],
    }),
  );
  const estado = { ...estadoInicial(), erros: { a2: MAU }, aviso: MAU };
  const html = htmlDaJanela(d, estado);
  semHtmlDeFora(html, "janela");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<img"), "imagem de endereço ruim não entra");
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("id ruim"), "achado de id inválido fica de fora");
  // as únicas marcas são as nossas
  const marcas = new Set((html.match(/<\/?([a-z0-9]+)/g) ?? []).map((m) => m.replace(/[</]/g, "")));
  for (const m of marcas) assert.ok(["div", "h2", "h3", "ul", "li", "p", "span", "dl", "dt", "dd", "button"].includes(m), `marca inesperada: ${m}`);
});

test("a janela: esperando o Mestre desliga os botões; o erro aparece na linha; tudo decidido mostra o rodapé", () => {
  const d = dadosDaJanela(revelada());
  let estado = { ...estadoInicial(), esperando: { a2: true } };
  let html = htmlDaJanela(d, estado);
  assert.ok(html.includes(`data-action="pegar" data-achado="a2" disabled>Pegar</button>`));
  assert.ok(html.includes(`data-action="deixar" data-achado="a2" disabled>Deixar</button>`));
  assert.ok(html.includes(`data-action="pegar" data-achado="a1">`), "a outra linha segue ligada");

  estado = depoisDaDecisao(estado, "a2", true, { ok: false, error: "Outro personagem já pegou." });
  html = htmlDaJanela(d, estado);
  assert.ok(html.includes(`<p class="cfb-saque-erro" role="alert">Outro personagem já pegou.</p>`));
  assert.ok(html.includes(`data-action="pegar" data-achado="a2">Pegar</button>`), "os botões voltam");

  estado = depoisDaDecisao(estado, "a2", true, { ok: true, pendentes: 2 });
  assert.equal(estado.decisoes.a2, "pegou");
  assert.equal(estado.erros.a2, undefined, "o erro some");
  assert.equal(estado.tudo, false);
  estado = depoisDaDecisao(estado, "a1", false, { ok: true, pendentes: 1 });
  estado = depoisDaDecisao(estado, "a3", false, { ok: true, pendentes: 0 });
  assert.equal(estado.tudo, true);
  html = htmlDaJanela(d, estado);
  assert.ok(html.includes("Tudo decidido."));
  assert.ok(html.includes(`data-action="fechar">Fechar</button>`));
  assert.ok(!html.includes('data-action="pegar"'));
  assert.equal((html.match(/Você deixou\./g) ?? []).length, 3);
  assert.equal(pendentesDaJanela(d, estado), 0);

  // sem resposta do Mestre: uma frase nossa, e o estado de antes não muda
  const antes = estadoInicial();
  const depois = depoisDaDecisao(antes, "a1", true, null);
  assert.match(depois.erros.a1, /não respondeu/);
  assert.deepEqual(antes, estadoInicial());
});

test("a janela sem achados: Nada, com o Fechar", () => {
  const html = htmlDaJanela({ revista_id: "rev-1", corpo: "Rato", achados: [] });
  assert.ok(html.includes(`<p class="cfb-saque-vazio">Nada.</p>`));
  assert.ok(html.includes(`data-action="fechar"`));
  assert.ok(!html.includes("Tudo decidido."));
  assert.doesNotThrow(() => htmlDaJanela(null));
  assert.doesNotThrow(() => htmlDaJanela({ achados: "x" }));
});

test("a decisão de cada linha e o corpo da op", () => {
  assert.equal(decisaoDoAchado({ id: "a", decisao: "pegou" }), "pegou");
  assert.equal(decisaoDoAchado({ id: "a", decisao: null, pego: true }), "pegou");
  assert.equal(decisaoDoAchado({ id: "a", decisao: null, pego: false }), null);
  assert.equal(decisaoDoAchado({ id: "a", decisao: "x" }), null);
  assert.equal(decisaoDoAchado({ id: "a" }, { a: "deixou" }), "deixou");
  assert.deepEqual(corpoDaDecisao({ revista_id: "rev-1", achado_id: "a1", pegar: true }), { op: "saque.pegar", revista_id: "rev-1", achado_id: "a1" });
  assert.deepEqual(corpoDaDecisao({ revista_id: "rev-1", achado_id: "a1", pegar: false }), { op: "saque.deixar", revista_id: "rev-1", achado_id: "a1" });
  assert.equal(corpoDaDecisao({ revista_id: "rev-1", achado_id: "a1", pegar: "sim" }), null);
  assert.equal(corpoDaDecisao({ revista_id: { $ne: 1 }, achado_id: "a1", pegar: true }), null);
  assert.equal(corpoDaDecisao(null), null);
});

/* ── o que vai no pacote ── */

test("o CSS do saque está no module.json, só usa o prefixo cfb-saque- e os arquivos que ele pede existem", () => {
  assert.ok(moduleJson.styles.includes("styles/saque.css"));
  const css = readFileSync(raiz("styles/saque.css"), "utf8");
  for (const [, caminho] of css.matchAll(/url\("\.\.\/([^"]+)"\)/g)) assert.ok(existsSync(raiz(caminho)), `falta ${caminho}`);
  assert.ok(existsSync(raiz("assets/fontes/LICENSE.txt")), "a licença das fontes (CC BY-SA 4.0) vai junto");
  // todo seletor de classe do arquivo tem o prefixo (fora o que a ApplicationV2 põe: .window-header)
  const semComentario = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const classes = new Set([...semComentario.matchAll(/(?<![\w"/-])\.([a-zA-Z_][\w-]*)(?=[^{}]*\{)/g)].map((m) => m[1]));
  for (const c of classes) assert.ok(c.startsWith("cfb-saque-") || c === "window-header", `seletor fora do prefixo: .${c}`);
  for (const linha of semComentario.split("}")) {
    const seletor = linha.split("{")[0];
    if (seletor.includes("{") || !seletor.trim() || seletor.includes("@")) continue;
    for (const s of seletor.split(",")) assert.ok(/\.cfb-saque-/.test(s), `regra que vaza para o Foundry: ${s.trim()}`);
  }
  // o release leva a pasta assets
  assert.match(readFileSync(raiz(".github/workflows/release.yml"), "utf8"), /^\s+assets \\$/m);
});
