// O SAQUE (v1.25.0): a cola de saque-foundry.js com um Foundry de MENTIRA (os
// ganchos, o fetch, as mensagens e as perguntas falsos). Fora do CI.
// Uso, da raiz do módulo: node qa/saque/simulado.mjs
// Confere a ligação entre as peças; NÃO prova nada sobre o Foundry de verdade.
import assert from "node:assert/strict";

const MODULE_ID = "companion-foundry-bridge";
const ganchos = new Map();
globalThis.Hooks = { on: (n, f) => (ganchos.set(n, [...(ganchos.get(n) ?? []), f]), f), once() {}, off() {} };
const dispara = (n, ...a) => (ganchos.get(n) ?? []).forEach((f) => f(...a));
const pausa = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const avisos = [];
globalThis.ui = { notifications: { warn: (t) => avisos.push(t), info() {} } };
const mensagens = [];
class Mensagem {
  constructor(d) { Object.assign(this, d, { id: `M${mensagens.length + 1}` }); }
  async update(m) { Object.assign(this, m); return this; }
}
const janelasAbertas = [];
globalThis.foundry = {
  utils: { getRoute: (c) => `/${c}` },
  applications: { api: { ApplicationV2: class { constructor(o) { this.options = o; } async render() { janelasAbertas.push(this); return this; } bringToFront() {} async close() {} } } },
};
globalThis.CONFIG = {
  queries: {},
  specialStatusEffects: { DEFEATED: "dead" },
  ChatMessage: { documentClass: { create: async (d) => { const m = new Mensagem(d); mensagens.push(m); return m; } } },
};
const posts = [];
let responder = () => ({ ok: true });
globalThis.fetch = async (url, init) => {
  const corpo = JSON.parse(init.body);
  posts.push({ url, chave: init.headers["x-foundry-inbound-key"], corpo });
  return { ok: true, status: 200, json: async () => responder(corpo) };
};

const roladas = [];
const guldrum = {
  id: "AtorGuldrum", type: "character", name: "Guldrum", isOwner: true,
  testUserPermission: (u) => u.id === "renan",
  rollSkill: async (...a) => void roladas.push(a),
};
const consultas = [];
const gm = { id: "bruno", isGM: true, active: true, name: "Bruno" };
const renan = { id: "renan", isGM: false, active: true, name: "Renan", character: guldrum, query: async (nome, dados) => (consultas.push({ nome, dados }), CONFIG.queries[nome](dados)) };
const usuarios = [gm, renan];
const config = { inboundUrl: "https://x.supabase.co/functions/v1/foundry-inbound", inboundKeyLocal: "segredo", saqueAoCompanion: true };
globalThis.game = {
  user: gm,
  users: Object.assign(usuarios, { activeGM: gm }),
  actors: new Map([[guldrum.id, guldrum], ["AtorGoblin", { id: "AtorGoblin", name: "Goblin" }]]),
  messages: { get contents() { return mensagens; } },
  settings: { get: (_m, k) => config[k], register() {}, registerMenu() {} },
  i18n: { localize: (k) => k },
};

const { registerSaqueQueries, registerSaqueSync, receberComandoDeSaque } = await import("../../scripts/saque-foundry.js");
registerSaqueQueries();
registerSaqueSync();

/** Um botão de mentira, com o dataset que o cartão escreveu. */
function botoesDe(html) {
  return [...html.matchAll(/<button[^>]*data-cfb-acao="([^"]+)"([^>]*)>/g)].map(([, acao, resto]) => {
    const dataset = { cfbAcao: acao };
    for (const [, k, v] of resto.matchAll(/data-([a-z-]+)="([^"]*)"/g)) dataset[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    const b = { dataset, disabled: false, ouvintes: [], addEventListener: (_t, f) => b.ouvintes.push(f), closest: () => null };
    return b;
  });
}
async function clicar(mensagem, acao, filtro = () => true) {
  const botoes = botoesDe(mensagem.content);
  dispara("renderChatMessageHTML", mensagem, { querySelectorAll: () => botoes });
  const b = botoes.find((x) => x.dataset.cfbAcao === acao && filtro(x));
  assert.ok(b, `sem o botão ${acao}`);
  for (const f of b.ouvintes) f({ preventDefault() {} });
  await pausa();
}

// 1. o goblin vai a 0 PV: um aviso só, e o cartão sussurrado ao GM
const goblin = { type: "npc", id: "AtorGoblin", uuid: "Scene.s.Token.t1.Actor.AtorGoblin", name: "Goblin", token: { name: "Goblin Batedor" }, system: { attributes: { hp: { value: 0 } } } };
responder = (c) => (c.op === "saque.morreu" ? { ok: true, corpo_id: "corpo-1", ja_existia: false, nome: c.nome, alvo_tipo: "criatura", alvo_id: "x", pcs: [{ id: "pc-1", nome: "Guldrum", foundry_actor_id: "AtorGuldrum" }] } : { ok: true, id: "rev-1", estado: "rolada", pendentes: 0 });
dispara("dnd5e.damageActor", goblin, { hp: -7, temp: 0, total: -7 });
dispara("createActiveEffect", { statuses: new Set(["dead"]), parent: goblin });
dispara("updateCombatant", { actor: goblin, token: { name: "Goblin Batedor" } }, { defeated: true });
await pausa();
assert.equal(posts.length, 1, "os três sinais são um corpo só");
assert.equal(posts[0].url, "https://x.supabase.co/functions/v1/foundry-saque");
assert.equal(posts[0].chave, "segredo");
assert.deepEqual(posts[0].corpo, { op: "saque.morreu", ator_uuid: goblin.uuid, ator_id: "AtorGoblin", nome: "Goblin Batedor", nome_ator: "Goblin" });
assert.equal(mensagens.length, 1);
assert.deepEqual(mensagens[0].whisper, ["bruno"]);
assert.deepEqual(mensagens[0].flags[MODULE_ID].saque_cartao, { tipo: "morte", corpo_id: "corpo-1", revista_id: null });

// 2. o GM libera: a op, e o cartão perde os botões
await clicar(mensagens[0], "saque-liberar");
assert.deepEqual(posts[1].corpo, { op: "saque.liberar", corpo_id: "corpo-1", pc_id: "pc-1" });
assert.ok(mensagens[0].content.includes("Liberado para Guldrum.") && !mensagens[0].content.includes("<button"));

// 3. o Companion avisa "liberada": o cartão do jogador (dono + GM); repetido, não duplica
const base = { corpo: { id: "corpo-1", nome: "Goblin Batedor" }, pc: { id: "pc-1", nome: "Guldrum", foundry_actor_id: "AtorGuldrum" }, revista: { id: "rev-1", total: 17, faixa: "boa" } };
assert.deepEqual(receberComandoDeSaque({ aviso_id: "av1", acao: "liberada", ...base }), { recebido: true });
assert.equal(receberComandoDeSaque({ aviso_id: "av1", acao: "liberada", ...base }).repetido, true);
assert.deepEqual(receberComandoDeSaque({ acao: "explodir", ...base }), { recebido: false, motivo: "acao_desconhecida: explodir" });
await pausa();
assert.equal(mensagens.length, 2);
assert.deepEqual(mensagens[1].whisper, ["renan", "bruno"]);

// 4. o clique em "Rolar Investigação": a rolagem nativa com a nossa flag
await clicar(mensagens[1], "saque-rolar");
assert.equal(roladas.length, 1);
assert.equal(roladas[0][0].skill, "inv");
assert.deepEqual(roladas[0][2], { data: { flags: { [MODULE_ID]: { saque: "rev-1" } } } });

// 5. a mensagem da rolagem chega: saque.rolou, uma vez
const rolagem = { id: "MsgRol", flags: { [MODULE_ID]: { saque: "rev-1" }, dnd5e: { roll: { type: "skill", skillId: "inv" } } }, rolls: [{ total: 17 }] };
dispara("createChatMessage", rolagem);
dispara("createChatMessage", rolagem);
await pausa();
assert.deepEqual(posts.filter((p) => p.corpo.op === "saque.rolou").map((p) => p.corpo), [{ op: "saque.rolou", revista_id: "rev-1", total: 17, mensagem_id: "MsgRol" }]);
assert.ok(mensagens[1].content.includes("Investigação rolada: 17"));

// 6. o resultado (só o GM) e o Revelar
receberComandoDeSaque({ aviso_id: "av2", acao: "resultado", ...base, achados: [{ id: "a1", tipo: "item", nome: "Adaga", fonte: "usava" }] });
await pausa();
assert.deepEqual(mensagens[2].whisper, ["bruno"]);
await clicar(mensagens[2], "saque-revelar");
assert.deepEqual(posts.at(-1).corpo, { op: "saque.revelar", revista_id: "rev-1" });
assert.ok(mensagens[2].content.includes("Revelado a Guldrum."));

// 7. "revelada": a pergunta ao dono ativo abre a janela (aqui o mesmo processo faz os dois papéis)
receberComandoDeSaque({ aviso_id: "av3", acao: "revelada", ...base, achados: [{ id: "a1", tipo: "item", nome: "Adaga", identificado: true, nome_real: "segredo" }] });
await pausa();
assert.equal(consultas.length, 1);
assert.equal(consultas[0].nome, `${MODULE_ID}.saqueAbrir`);
assert.ok(!JSON.stringify(consultas[0].dados).includes("segredo"));
assert.equal(janelasAbertas.length, 1);
assert.equal(janelasAbertas[0].options.id, "cfb-saque-rev-1");

// 8. o "Pegar" do jogador chega ao GM e vira a op
const r = await CONFIG.queries[`${MODULE_ID}.saqueDecidir`]({ revista_id: "rev-1", achado_id: "a1", pegar: true });
assert.deepEqual(r, { ok: true, pendentes: 0 });
assert.deepEqual(posts.at(-1).corpo, { op: "saque.pegar", revista_id: "rev-1", achado_id: "a1" });
responder = () => ({ ok: false, error: "Outro personagem já pegou.", recusado: true });
assert.deepEqual(await CONFIG.queries[`${MODULE_ID}.saqueDecidir`]({ revista_id: "rev-1", achado_id: "a1", pegar: false }), { ok: false, error: "Outro personagem já pegou." });

// 9. sem dono no Foundry: o aviso ao GM; sem sessão: nada na tela; navegador que não é o GM ativo: nada sai
receberComandoDeSaque({ aviso_id: "av4", acao: "revelada", ...base, pc: { id: "pc-2", nome: "Talaniel", foundry_actor_id: null }, achados: [] });
await pausa();
assert.ok(avisos.at(-1).includes("Talaniel não está no Foundry"));
const antes = [posts.length, mensagens.length];
responder = () => ({ ok: false, motivo: "sem_sessao" });
dispara("dnd5e.damageActor", { ...goblin, uuid: "Scene.s.Token.t2.Actor.AtorGoblin" }, { hp: -3 });
await pausa();
assert.deepEqual([posts.length, mensagens.length], [antes[0] + 1, antes[1]], "sem sessão: pediu e não mostrou nada");
game.users.activeGM = null; // sem GM ativo: isReportingGm() diria "sou eu"; aqui, não
dispara("dnd5e.damageActor", { ...goblin, uuid: "Scene.s.Token.t3.Actor.AtorGoblin" }, { hp: -3 });
await pausa();
assert.equal(posts.length, antes[0] + 1, "sem GM ativo, ninguém manda");
assert.deepEqual(await CONFIG.queries[`${MODULE_ID}.saqueDecidir`]({ revista_id: "rev-1", achado_id: "a1", pegar: true }), { ok: false, error: "O Mestre não está conectado." });

console.log(`OK: ${posts.length} pedidos à edge, ${mensagens.length} cartões, ${consultas.length} pergunta ao jogador, 1 janela.`);
