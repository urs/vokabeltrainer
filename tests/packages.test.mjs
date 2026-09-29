import assert from "node:assert/strict";
import test from "node:test";

import { createPackageExport, normalizePackages, parsePackageImport } from "../src/packages.js";

test("migrates old English packages and removes pronunciation", () => {
  assert.deepEqual(normalizePackages([{ id: "old", name: "Alt", words: [{ en: "local [ləʊkəl]", de: "örtlich" }] }]), [{
    id: "old",
    name: "Alt",
    language: "en",
    words: [{ foreign: "local", de: "örtlich" }],
  }]);
});

test("exports only package vocabulary and language metadata", () => {
  const payload = createPackageExport([{ id: "one", name: "Voyage", language: "fr", words: [{ foreign: "partir", de: "abreisen" }], photos: ["secret"] }]);
  assert.equal(payload.format, "wortklar-vocabulary-packages");
  assert.deepEqual(payload.packages, [{ name: "Voyage", language: "fr", words: [{ foreign: "partir", de: "abreisen" }] }]);
  assert.equal(JSON.stringify(payload).includes("photos"), false);
  assert.equal(JSON.stringify(payload).includes("learning"), false);
});

test("imports English and French packages with fresh ids", () => {
  const imported = parsePackageImport(JSON.stringify({
    format: "wortklar-vocabulary-packages",
    version: 1,
    packages: [
      { name: "English", language: "en", words: [{ foreign: "home", de: "Zuhause" }] },
      { name: "Français", language: "fr", words: [{ foreign: "maison", de: "Haus" }] },
    ],
  }));
  assert.deepEqual(imported.map((item) => item.language), ["en", "fr"]);
  assert.ok(imported.every((item) => item.id));
});

test("rejects unrelated JSON files", () => {
  assert.throws(() => parsePackageImport('{"packages":[]}'), /kein unterstützter/);
});
