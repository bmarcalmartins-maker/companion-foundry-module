/**
 * Os eventos de combate (combate.js, v1.11.0), sem Foundry: a mensagem de
 * rolagem do dnd5e, o gancho dnd5e.damageActor, a fila e a resposta da edge.
 * As mensagens têm o formato do dnd5e 5.3.3 (flags.dnd5e.roll.type, targets,
 * rolls[0].options.target, isCritical, isFumble).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { depoisDoEnvio, enfileirar, eventoDaMensagem, eventoDaVida } from "../scripts/combate.js";

const tipos = { pc1: "character", lobo: "npc" };
const tipoDoAtor = (id) => tipos[id] ?? null;
const msg = (tipo, rolls, { actor = "pc1", alvos = [{ name: "Lobo", ac: 13 }], id = "abc" } = {}) => ({
  id,
  speaker: { actor },
  flags: { dnd5e: { roll: { type: tipo }, targets: alvos } },
  rolls,
});

test("ataque com UM alvo: acerto pela CA, crítico e falha", () => {
  const r = eventoDaMensagem(msg("attack", [{ total: 17, options: { target: 13 }, isCritical: false, isFumble: false }]), { tipoDoAtor, combateId: "c1" });
  assert.deepEqual(r, {
    actorId: "pc1",
    evento: { id: "m-abc", tipo: "ataque", alvo: "Lobo", combate_id: "c1", valor: 17, acertou: true, critico: false, falha: false },
  });
  const errou = eventoDaMensagem(msg("attack", [{ total: 9, options: { target: 13 }, isFumble: true }]), { tipoDoAtor });
  assert.equal(errou.evento.acertou, false);
  assert.equal(errou.evento.falha, true);
  const critico = eventoDaMensagem(msg("attack", [{ total: 25, options: { target: 13 }, isCritical: true }]), { tipoDoAtor });
  assert.equal(critico.evento.critico, true);
});

test("ataque sem alvo, ou com dois: o acerto fica desconhecido (o dnd5e não põe a CA)", () => {
  const semAlvo = eventoDaMensagem(msg("attack", [{ total: 15, options: {} }], { alvos: [] }), { tipoDoAtor });
  assert.equal(semAlvo.evento.acertou, null);
  assert.equal(semAlvo.evento.alvo, null);
  const dois = eventoDaMensagem(msg("attack", [{ total: 15, options: {} }], { alvos: [{ name: "A" }, { name: "B" }] }), { tipoDoAtor });
  assert.equal(dois.evento.acertou, null);
  assert.equal(dois.evento.alvo, null, "com dois alvos, nenhum nome");
});

test("dano e cura: a soma das rolagens; nunca negativo", () => {
  const dano = eventoDaMensagem(msg("damage", [{ total: 8 }, { total: 4 }]), { tipoDoAtor });
  assert.equal(dano.evento.tipo, "dano");
  assert.equal(dano.evento.valor, 12);
  const cura = eventoDaMensagem(msg("healing", [{ total: 7 }]), { tipoDoAtor });
  assert.equal(cura.evento.tipo, "cura");
  assert.equal(eventoDaMensagem(msg("damage", [{ total: -2 }]), { tipoDoAtor }).evento.valor, 0);
});

test("o que não vira evento: NPC, sem actor, outra rolagem, sem rolagem, total que não é número", () => {
  assert.equal(eventoDaMensagem(msg("attack", [{ total: 15 }], { actor: "lobo" }), { tipoDoAtor }), null, "o monstro não conta");
  assert.equal(eventoDaMensagem(msg("attack", [{ total: 15 }], { actor: null }), { tipoDoAtor }), null);
  assert.equal(eventoDaMensagem(msg("skill", [{ total: 15 }]), { tipoDoAtor }), null);
  assert.equal(eventoDaMensagem(msg("save", [{ total: 15 }]), { tipoDoAtor }), null);
  assert.equal(eventoDaMensagem(msg("attack", []), { tipoDoAtor }), null);
  assert.equal(eventoDaMensagem(msg("damage", [{ total: "x" }]), { tipoDoAtor }), null);
  assert.equal(eventoDaMensagem({ id: "x", content: "oi" }, { tipoDoAtor }), null, "mensagem comum");
});

test("dnd5e.damageActor: só a perda de PV do personagem do mundo", () => {
  const pc = { id: "pc1", type: "character", isToken: false };
  const r = eventoDaVida(pc, { hp: -6, temp: -2, total: -8 }, { novoId: () => "r1", combateId: "c1" });
  assert.deepEqual(r, { actorId: "pc1", evento: { id: "v-r1", tipo: "dano_tomado", valor: 8, combate_id: "c1" } });
  assert.equal(eventoDaVida(pc, { total: 5 }, { novoId: () => "r2" }), null, "a cura recebida não entra");
  assert.equal(eventoDaVida({ id: "lobo", type: "npc" }, { total: -5 }, { novoId: () => "r3" }), null);
  assert.equal(eventoDaVida({ id: "pc1", type: "character", isToken: true }, { total: -5 }, { novoId: () => "r4" }), null, "o token sem vínculo é uma cópia");
});

test("a fila tem teto e a resposta da edge decide", () => {
  let f = [];
  for (let i = 0; i < 205; i++) f = enfileirar(f, { id: `e${i}` });
  assert.equal(f.length, 200);
  assert.equal(f[0].id, "e5", "os mais velhos saem primeiro");
  assert.equal(depoisDoEnvio({ ok: true, gravados: 3 }), "pronto");
  assert.equal(depoisDoEnvio({ ok: true, gravados: 0, motivo: "sem_sessao" }), "pronto", "sem sessão: não repete");
  assert.equal(depoisDoEnvio({ ok: false, status: 404, code: "actor_nao_vinculado" }), "descarta");
  assert.equal(depoisDoEnvio({ ok: false, status: 400 }), "descarta");
  assert.equal(depoisDoEnvio({ ok: false, status: 429 }), "repete");
  assert.equal(depoisDoEnvio({ ok: false, status: 503 }), "repete");
  assert.equal(depoisDoEnvio(null), "repete", "rede");
});
