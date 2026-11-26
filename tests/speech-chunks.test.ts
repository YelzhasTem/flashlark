import assert from "node:assert/strict";
import test from "node:test";
import { splitTextForSpeech } from "../src/lib/speech-chunks.ts";

test("short text is read in one piece", () => {
  assert.deepEqual(splitTextForSpeech("  hello   world "), ["hello world"]);
  assert.deepEqual(splitTextForSpeech("   "), []);
});

test("long text splits at sentence ends first", () => {
  const text = "The weather is nice today. We are going to the park! Will you come with us?";
  assert.deepEqual(splitTextForSpeech(text, 40), [
    "The weather is nice today.",
    "We are going to the park!",
    "Will you come with us?",
  ]);
});

test("a long sentence splits at commas, then between words", () => {
  const text = "First part of the sentence, second part of it, and a final part that is long";
  const pieces = splitTextForSpeech(text, 30);
  assert.ok(pieces.every((piece) => piece.length <= 30));
  assert.equal(pieces.join(" ").replace(/\s+/g, " "), text);
});

test("text without spaces is cut at the limit", () => {
  const text = "我".repeat(25);
  assert.deepEqual(splitTextForSpeech(text, 10), [
    "我".repeat(10),
    "我".repeat(10),
    "我".repeat(5),
  ]);
});

test("Chinese and Japanese sentence ends split without spaces", () => {
  assert.deepEqual(splitTextForSpeech("今天天气很好。我们去公园吧！", 8), [
    "今天天气很好。",
    "我们去公园吧！",
  ]);
});

test("every piece fits for a 300 character card", () => {
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  const pieces = splitTextForSpeech(words);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every((piece) => piece.length <= 120));
  assert.equal(pieces.join(" "), words);
});
