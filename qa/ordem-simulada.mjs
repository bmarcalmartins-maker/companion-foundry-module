// A ORDEM DO COMBATE (v1.24.0): o lado do GM (ordem-foundry.js) com um Foundry
// de mentira (os ganchos, o fetch e os relógios de verdade; ~25 s). Fora do CI.
// Uso: node qa/ordem-simulada.mjs "$PWD"
const pasta = process.argv[2];
const ganchos = new Map();
globalThis.Hooks = {
  on(n, f) { if (!ganchos.has(n)) ganchos.set(n, []); ganchos.get(n).push(f); return f; },
  once(n, f) { return this.on(n, f); },
  off() {},
};
const dispara = (n, ...a) => (ganchos.get(n) ?? []).forEach((f) => f(...a));
globalThis.foundry = { applications: { api: { DialogV2: class {}, ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c } }, utils: {} };
globalThis.CONFIG = { queries: {} };
const avisos = [];
globalThis.ui = { notifications: { warn: (t) => avisos.push(t) } };
const posts = [];
let respostaHttp = 200;
globalThis.fetch = async (url, init) => {
  posts.push({ url, corpo: JSON.parse(init.body), t: Date.now() });
  return { ok: respostaHttp === 200, status: respostaHttp, json: async () => (respostaHttp === 200 ? { ok: true } : { error: "x" }) };
};
const mapa = (arr) => { const m = new Map(arr.map((x) => [x.id, x])); m.contents = arr; m.filter = (f) => arr.filter(f); return m; };
const goblin = { id: "C2", tokenId: "T2", actorId: "A2", name: "Goblin", initiative: 15, hidden: false, isDefeated: false,
  token: { id: "T2", hidden: false, texture: { src: "tokens/goblin.webp" } },
  actor: { type: "npc", system: { attributes: { hp: { value: 7, max: 7, effectiveMax: 7, temp: 0 } } } } };
const pc = { id: "C1", tokenId: "T1", actorId: "A1", name: "Guldrum", initiative: 18, hidden: false, isDefeated: false,
  token: { id: "T1", hidden: false }, actor: { type: "character", system: { attributes: { hp: { value: 30, max: 40 } } } } };
const combate = { id: "Comb1", started: true, active: true, scene: { id: "Cena1", name: "A Ponte" }, round: 1, turn: 0,
  turns: [pc, goblin], get combatant() { return this.turns[this.turn]; }, combatants: mapa([pc, goblin]) };
const definicoes = { ordemAoCompanion: true, inboundUrl: "https://x.supabase.co/functions/v1/foundry-inbound", inboundKeyLocal: "k" };
globalThis.game = {
  settings: { get: (_m, k) => definicoes[k] },
  user: { id: "gm", name: "Bruno", isGM: true },
  users: Object.assign(mapa([{ id: "gm", name: "Bruno", isGM: true, active: true },
    { id: "p1", name: "Teste", isGM: false, active: true, query: async () => { throw new Error("sem handler"); } }]),
    { activeGM: { id: "gm" } }),
  modules: new Map([["companion-foundry-bridge", { version: "1.24.0" }]]),
  scenes: { active: { id: "Cena1" } },
  combats: [],
  i18n: { format: (k, d) => `${k} ${JSON.stringify(d)}`, localize: (k) => k },
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const m = await import(`${pasta}/scripts/ordem-foundry.js`);
const ok = (cond, txt) => console.log(`${cond ? "OK" : "FALHA"} ${txt}`);

m.registerOrdemSync();
await espera(700);
ok(posts.length === 1 && posts[0].corpo.combate === null && posts[0].url.endsWith("/foundry-combate"), `S1 no ready: um envio, "sem combate", à foundry-combate (${posts.length})`);
ok(JSON.stringify(posts[0].corpo.modulo.navegadores) === JSON.stringify([{ usuario: "Bruno", gm: true, codigo: "1.24.0" }, { usuario: "Teste", gm: false, codigo: null }]),
  "S2 a versão de cada navegador: o Teste sem resposta = código velho");

game.combats = [combate];
for (let i = 0; i < 10; i++) dispara("updateCombat", combate, {});
await espera(700);
ok(posts.length === 2 && posts[1].corpo.combate?.id === "Comb1" && posts[1].corpo.combate.vez === "C1", `S3 o combate começou: dez ganchos = um envio (${posts.length})`);

dispara("updateActor", {}, {});
await espera(700);
ok(posts.length === 2, "S4 gancho sem mudança na foto: nada sai");

goblin.actor.system.attributes.hp.value = 3; // a vida do token não ligado, sem gancho nenhum
await espera(4300);
ok(posts.length === 3 && posts[2].corpo.combate.combatentes[1].pv.valor === 3, `S5 a vida mudou sem gancho: a comparação de 4 s manda (${posts.length})`);

combate.turn = 1;
dispara("combatTurnChange", combate, {}, {});
await espera(700);
ok(posts.length === 4 && posts[3].corpo.combate.vez === "C2", "S6 passou a vez: manda");

respostaHttp = 503;
combate.round = 2; combate.turn = 0;
dispara("updateCombat", combate, {});
await espera(700);
const falhou = posts.length;
respostaHttp = 200;
await espera(5600);
ok(falhou === 5 && posts.length === 6 && posts[5].corpo.combate.rodada === 2, `S7 a edge caiu (503): manda de novo depois (${falhou} → ${posts.length})`);

definicoes.ordemAoCompanion = false;
combate.round = 3;
dispara("updateCombat", combate, {});
await espera(700);
ok(posts.length === 6, "S8 a chave desligada: nada sai");
definicoes.ordemAoCompanion = true;

game.users.activeGM = { id: "outro" };
combate.round = 4;
dispara("updateCombat", combate, {});
await espera(700);
ok(posts.length === 6, "S9 não é o GM ativo: nada sai");
game.users.activeGM = { id: "gm" };

game.combats = [];
dispara("deleteCombat", combate, {});
await espera(700);
ok(posts.at(-1).corpo.combate === null, "S10 o combate acabou: manda nulo (a ordem some)");
const depoisDoFim = posts.length;
await espera(4300);
ok(posts.length === depoisDoFim, "S11 sem combate: o 'estou vivo' não fica mandando");

// o "Turno anterior" sem os eventos de turno
let opcoesVistas = null;
const combate2 = { id: "Comb2", started: true, round: 1, turn: 1, turns: [pc, goblin], get combatant() { return this.turns[this.turn]; },
  async previousTurn() { const o = { direction: -1, worldTime: { delta: 0 } }; dispara("combatTurn", this, { turn: 0 }, o); opcoesVistas = o; this.turn = 0; },
  async nextTurn() { const o = { direction: 1 }; dispara("combatTurn", this, { turn: 1 }, o); opcoesVistas = o; this.turn = 1; } };
game.combats = Object.assign(mapa([combate2]), {});
const r1 = await m.comandoDaOrdem({ acao: "anterior", combate_id: "Comb2", vez_vista: "C2" });
ok(r1.passou && opcoesVistas.turnEvents === false, "S12 o Turno anterior vai com turnEvents: false");
const r2 = await m.comandoDaOrdem({ acao: "proximo", combate_id: "Comb2", vez_vista: "C1" });
ok(r2.passou && opcoesVistas.turnEvents === undefined, "S13 o Próximo turno vai normal (com os eventos)");
const r3 = await m.comandoDaOrdem({ acao: "proximo", combate_id: "Comb2", vez_vista: "C1" });
ok(r3.recusado === "a_vez_mudou", "S14 o segundo clique na mesma vez é recusado");

// o aviso do código velho
game.modules.set("companion-foundry-bridge", { version: "1.25.0" });
m.avisarCodigoVelho();
ok(avisos.length === 1 && avisos[0].includes("1.25.0") && avisos[0].includes("1.24.0"), "S15 código velho no cache: o aviso na tela");
game.modules.set("companion-foundry-bridge", { version: "1.24.0" });
m.avisarCodigoVelho();
ok(avisos.length === 1, "S16 código em dia: nada");
m.registerVersaoQuery();
ok(JSON.stringify(CONFIG.queries["companion-foundry-bridge.versao"]()) === '{"codigo":"1.24.0"}', "S17 a pergunta da versão responde o código");
process.exit(0);
