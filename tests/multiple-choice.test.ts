import assert from "node:assert/strict";
import test from "node:test";

import { canPlayMultipleChoice, normalizeStudyAnswer } from "../src/lib/multiple-choice.ts";

const card = (term: string, definition: string) => ({ term, definition });

test("normalizes like the server", () => {
  assert.equal(normalizeStudyAnswer("  Café,  Olé! "), "cafe ole");
  assert.equal(normalizeStudyAnswer("(Hello)"), "hello");
});

test("needs four cards", () => {
  assert.equal(canPlayMultipleChoice([card("a", "1"), card("b", "2"), card("c", "3")]), false);
  assert.equal(
    canPlayMultipleChoice([card("a", "1"), card("b", "2"), card("c", "3"), card("d", "4")]),
    true,
  );
});

test("rejects decks whose answers are all the same after normalizing", () => {
  const sameDefinitions = [
    card("a", "Café"),
    card("b", "cafe"),
    card("c", "CAFÉ!"),
    card("d", "café"),
  ];
  assert.equal(canPlayMultipleChoice(sameDefinitions), false);
  const sameTerms = [card("Run", "1"), card("run", "2"), card("RUN", "3"), card("run.", "4")];
  assert.equal(canPlayMultipleChoice(sameTerms), false);
  const twoDistinct = [card("a", "cat"), card("b", "cat"), card("c", "cat"), card("d", "dog")];
  assert.equal(canPlayMultipleChoice(twoDistinct), true);
});
