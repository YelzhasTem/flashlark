import assert from "node:assert/strict";
import test from "node:test";
import {
  deckCsvFileName,
  deckNameFromFileName,
  parseDeckCsv,
  serializeDeckCsv,
} from "../src/lib/deck-csv.ts";

test("export round-trips through import, including quotes, commas and newlines", () => {
  const cards = [
    { term: "apple", definition: "яблоко" },
    { term: 'say "hi"', definition: "hello, friend" },
    { term: "multi", definition: "line one\nline two" },
    { term: "-ing", definition: "suffix" },
    { term: "=SUM(A1)", definition: "@mention" },
  ];
  const csv = serializeDeckCsv(cards);
  assert.ok(csv.startsWith("term,definition\r\n"));
  assert.deepEqual(parseDeckCsv(`\uFEFF${csv}`), { cards, skipped: 0 });
});

test("export neutralises spreadsheet formulas", () => {
  const csv = serializeDeckCsv([{ term: "=HYPERLINK(1)", definition: "+1" }]);
  assert.equal(csv.split("\r\n")[1], "'=HYPERLINK(1),'+1");
});

test("imports Quizlet-style tab separated text without a header", () => {
  const result = parseDeckCsv("dog\tсобака\ncat\tкошка\n");
  assert.deepEqual(result.cards, [
    { term: "dog", definition: "собака" },
    { term: "cat", definition: "кошка" },
  ]);
});

test("imports Anki exports and skips their directive lines", () => {
  const result = parseDeckCsv("#separator:tab\n#html:false\nhouse\tдом\n#tag\tхэштег\n");
  assert.deepEqual(result.cards, [
    { term: "house", definition: "дом" },
    { term: "#tag", definition: "хэштег" },
  ]);
});

test("detects semicolon files from European Excel and drops known headers", () => {
  const result = parseDeckCsv("Word;Translation\r\nbook;книга, том\r\n");
  assert.deepEqual(result.cards, [{ term: "book", definition: "книга, том" }]);
});

test("keeps a first row that is not a header", () => {
  const result = parseDeckCsv("hello,привет\nbye,пока");
  assert.equal(result.cards.length, 2);
});

test("counts incomplete and oversized rows as skipped", () => {
  const long = "x".repeat(301);
  const result = parseDeckCsv(`term,definition\nonly-term\n,no term\nok,fine\nlong,${long}\n\n`);
  assert.deepEqual(result, { cards: [{ term: "ok", definition: "fine" }], skipped: 3 });
});

test("keeps sides up to 150 characters and skips longer ones", () => {
  const max = "y".repeat(150);
  const tooLong = "z".repeat(151);
  const result = parseDeckCsv(`${max},${max}\n${tooLong},ok\nok,${tooLong}\n`);
  assert.deepEqual(result, { cards: [{ term: max, definition: max }], skipped: 2 });
});

test("ignores extra columns", () => {
  const result = parseDeckCsv("a,b,c,d\n");
  assert.deepEqual(result.cards, [{ term: "a", definition: "b" }]);
});

test("file names are safe and readable", () => {
  assert.equal(deckCsvFileName('IELTS: Speaking / "Part 1"'), "IELTS-Speaking-Part-1.csv");
  assert.equal(deckCsvFileName("???"), "deck.csv");
  assert.equal(deckNameFromFileName("my_travel-words.csv"), "my travel words");
});
