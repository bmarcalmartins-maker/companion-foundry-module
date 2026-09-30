import { test } from "node:test";
import assert from "node:assert/strict";
import { chavesDoHint, semPrefixoDaFonte, slugify, uuidDoHint } from "../scripts/casar-compendio.js";

test("slug: minúsculas, sem acento, hífens", () => {
  assert.equal(slugify("Amulet of Health"), "amulet-of-health");
  assert.equal(slugify("  Bússola do Leitor! "), "bussola-do-leitor");
});

test("a chave do catálogo perde o prefixo da fonte (antes nunca casava)", () => {
  assert.equal(semPrefixoDaFonte("srd-2024_amulet-of-health"), "amulet-of-health");
  assert.equal(semPrefixoDaFonte("vom_accursed-idol"), "accursed-idol");
  assert.equal(semPrefixoDaFonte("amulet-of-health"), "amulet-of-health");
});

test("ordem: chave sem prefixo, chave inteira, nome — sem repetir", () => {
  assert.deepEqual(
    chavesDoHint({ source_key: "srd-2024_amulet-of-health", name: "Amuleto da Saúde" }),
    ["amulet-of-health", "srd-2024-amulet-of-health", "amuleto-da-saude"],
  );
  assert.deepEqual(chavesDoHint({ source_key: null, name: "Rope" }), ["rope"]);
  assert.deepEqual(chavesDoHint({ source_key: "rope", name: "Rope" }), ["rope"]);
});

test("uuid só de compêndio", () => {
  assert.equal(uuidDoHint({ uuid: "Compendium.world.ddb-items.Item.00EW7VdONVgjmiiR" }), "Compendium.world.ddb-items.Item.00EW7VdONVgjmiiR");
  assert.equal(uuidDoHint({ uuid: "Actor.x.Item.y" }), null);
  assert.equal(uuidDoHint({}), null);
});
