import assert from "node:assert/strict";
import test from "node:test";

import { removePronunciation } from "../src/vocabulary.js";

test("removes bracketed pronunciation from scanned vocabulary", () => {
  assert.equal(removePronunciation("local [ləʊkəl]"), "local");
  assert.equal(removePronunciation("volunteer [ˌvɒlənˈtɪə] (to)"), "volunteer (to)");
  assert.equal(removePronunciation("  youth   [juːθ]  "), "youth");
});

test("preserves grammatical additions and ordinary vocabulary text", () => {
  assert.equal(removePronunciation("(to) raise money (for sth.)"), "(to) raise money (for sth.)");
  assert.equal(removePronunciation("north-west"), "north-west");
});
