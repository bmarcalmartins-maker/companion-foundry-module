import { test } from "node:test";
import assert from "node:assert/strict";
import { criarFila } from "../scripts/fila-por-ator.js";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test("mesma chave: a segunda só começa quando a primeira termina", async () => {
  const fila = criarFila();
  const ordem = [];
  const a = fila("ator1", async () => { ordem.push("a início"); await espera(30); ordem.push("a fim"); return "A"; });
  const b = fila("ator1", async () => { ordem.push("b início"); await espera(5); ordem.push("b fim"); return "B"; });
  assert.deepEqual(await Promise.all([a, b]), ["A", "B"]);
  assert.deepEqual(ordem, ["a início", "a fim", "b início", "b fim"]);
});

test("chaves diferentes correm juntas", async () => {
  const fila = criarFila();
  const ordem = [];
  const a = fila("ator1", async () => { ordem.push("a início"); await espera(30); ordem.push("a fim"); });
  const b = fila("ator2", async () => { ordem.push("b início"); await espera(5); ordem.push("b fim"); });
  await Promise.all([a, b]);
  assert.deepEqual(ordem, ["a início", "b início", "b fim", "a fim"]);
});

test("a que falhou não trava a próxima, e o erro chega a quem chamou", async () => {
  const fila = criarFila();
  const a = fila("ator1", async () => { throw new Error("actor not found"); });
  const b = fila("ator1", async () => "depois");
  await assert.rejects(a, /actor not found/);
  assert.equal(await b, "depois");
});

test("a fila vazia sai do mapa", async () => {
  const fila = criarFila();
  await fila("ator1", async () => 1);
  await espera(0);
  assert.equal(fila.tamanho(), 0);
});
