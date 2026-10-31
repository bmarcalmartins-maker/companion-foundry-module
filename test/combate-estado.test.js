import assert from "node:assert/strict";
import { test } from "node:test";
import { criarVigiaDoCombate, depoisDoEnvioDoEstado, TENTATIVAS } from "../scripts/combate-estado.js";

function vigia(respostas = []) {
  const enviados = [];
  const v = criarVigiaDoCombate({
    enviar: async (corpo) => {
      enviados.push(corpo);
      return respostas.length ? respostas.shift() : { ok: true };
    },
    esperar: async () => {},
  });
  return { v, enviados };
}

test("começou: manda o início uma vez só", async () => {
  const { v, enviados } = vigia();
  await v.aoAtualizar({ id: "c1", started: false });
  await v.aoAtualizar({ id: "c1", started: true });
  await v.aoAtualizar({ id: "c1", started: true }); // a rodada seguinte
  assert.deepEqual(enviados, [{ op: "combate.estado", combate_id: "c1", fase: "inicio" }]);
});

test("encerrar (apagar) o começado manda o fim; o não começado não manda nada", async () => {
  const { v, enviados } = vigia();
  await v.aoAtualizar({ id: "c1", started: true });
  await v.aoApagar({ id: "c1", started: true });
  await v.aoApagar({ id: "c2", started: false });
  assert.deepEqual(enviados.map((e) => e.fase), ["inicio", "fim"]);
});

test("voltou a não ter rodada também é fim", async () => {
  const { v, enviados } = vigia();
  await v.aoAtualizar({ id: "c1", started: true });
  await v.aoAtualizar({ id: "c1", started: false });
  assert.deepEqual(enviados.map((e) => e.fase), ["inicio", "fim"]);
});

test("ao abrir o mundo, o combate já começado não manda início; o fim dele sim", async () => {
  const { v, enviados } = vigia();
  v.conhecer([{ id: "c1", started: true }, { id: "c2", started: false }]);
  await v.aoAtualizar({ id: "c1", started: true });
  assert.equal(enviados.length, 0);
  await v.aoApagar({ id: "c1" });
  assert.deepEqual(enviados, [{ op: "combate.estado", combate_id: "c1", fase: "fim" }]);
});

test("rede ou 5xx: tenta de novo até 3 vezes; 400 não repete", async () => {
  const r1 = vigia([null, { ok: false, status: 503 }, { ok: true }]);
  await r1.v.aoAtualizar({ id: "c1", started: true });
  assert.equal(r1.enviados.length, 3);
  const r2 = vigia([null, null, null, null]);
  await r2.v.aoAtualizar({ id: "c1", started: true });
  assert.equal(r2.enviados.length, TENTATIVAS);
  const r3 = vigia([{ ok: false, status: 400 }]);
  await r3.v.aoAtualizar({ id: "c1", started: true });
  assert.equal(r3.enviados.length, 1);
});

test("a decisão depois do envio", () => {
  assert.equal(depoisDoEnvioDoEstado({ ok: true, motivo: "sem_sessao" }), "pronto");
  assert.equal(depoisDoEnvioDoEstado({ ok: false, status: 401 }), "descarta");
  assert.equal(depoisDoEnvioDoEstado({ ok: false, status: 429 }), "repete");
  assert.equal(depoisDoEnvioDoEstado(null), "repete");
});
