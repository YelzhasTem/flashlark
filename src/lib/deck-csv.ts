// CSV import/export for decks. Pure helpers (no app imports) so they run in node tests.

import { CARD_SIDE_MAX_LENGTH } from "./card-limits.ts";

export const CSV_MAX_TERM_LENGTH = CARD_SIDE_MAX_LENGTH;
export const CSV_MAX_DEFINITION_LENGTH = CARD_SIDE_MAX_LENGTH;
export const CSV_MAX_FILE_BYTES = 1024 * 1024;

export type CsvCard = { term: string; definition: string };

export type ParsedDeckCsv = {
  cards: CsvCard[];
  /** Rows that were empty, had one column, or exceeded the card length limits. */
  skipped: number;
};

const TERM_HEADERS = new Set(["term", "word", "front", "question", "слово", "термин"]);
const DEFINITION_HEADERS = new Set([
  "definition",
  "translation",
  "meaning",
  "back",
  "answer",
  "перевод",
  "определение",
  "значение",
]);

// Spreadsheet apps execute cells that start with these characters as formulas.
const FORMULA_START = /^[=+\-@\t\r]/;
const ANKI_DIRECTIVE = /^#[a-z ]+:/i;

function escapeCell(value: string) {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function unguardCell(value: string) {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

export function serializeDeckCsv(cards: CsvCard[]) {
  const lines = ["term,definition"];
  for (const card of cards) {
    lines.push(`${escapeCell(card.term)},${escapeCell(card.definition)}`);
  }
  return `${lines.join("\r\n")}\r\n`;
}

function detectDelimiter(lines: string[]) {
  const sample = lines.find((line) => line.trim() && !ANKI_DIRECTIVE.test(line)) ?? "";
  if (sample.includes("\t")) return "\t";
  const unquoted = sample.replace(/"[^"]*"/g, "");
  const commas = unquoted.split(",").length - 1;
  const semicolons = unquoted.split(";").length - 1;
  return semicolons > commas ? ";" : ",";
}

function parseRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let atRowStart = true;

  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
    atRowStart = true;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    // Anki exports start with "#separator:tab"-style directives; skip those lines.
    if (atRowStart && ch === "#" && ANKI_DIRECTIVE.test(text.slice(i, i + 40))) {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    atRowStart = false;
    if (ch === '"' && cell.trim() === "") {
      cell = "";
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += ch;
    }
  }
  if (!atRowStart || cell || row.length) endRow();
  return rows;
}

function isHeaderRow(cells: string[]) {
  const [term = "", definition = ""] = cells.map((cell) => cell.trim().toLocaleLowerCase());
  return TERM_HEADERS.has(term) && DEFINITION_HEADERS.has(definition);
}

/**
 * Parses comma, semicolon, or tab separated word lists (our own export, Excel/Sheets,
 * Quizlet and Anki text exports). The first column is the term, the second the definition.
 */
export function parseDeckCsv(input: string): ParsedDeckCsv {
  const text = input.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text.split(/\r\n|\n|\r/));
  const rows = parseRows(text, delimiter);
  if (rows.length && isHeaderRow(rows[0])) rows.shift();

  const cards: CsvCard[] = [];
  let skipped = 0;
  for (const cells of rows) {
    if (cells.every((cell) => !cell.trim())) continue;
    const term = unguardCell(cells[0]?.trim() ?? "");
    const definition = unguardCell(cells[1]?.trim() ?? "");
    if (
      !term ||
      !definition ||
      term.length > CSV_MAX_TERM_LENGTH ||
      definition.length > CSV_MAX_DEFINITION_LENGTH
    ) {
      skipped++;
      continue;
    }
    cards.push({ term, definition });
  }
  return { cards, skipped };
}

export function deckCsvFileName(deckName: string) {
  const base = deckName
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${base || "deck"}.csv`;
}

export function deckNameFromFileName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function downloadDeckCsv(deck: { name: string; cards: CsvCard[] }) {
  // The BOM makes Excel read non-Latin words (Cyrillic, CJK) as UTF-8.
  const blob = new Blob([`\uFEFF${serializeDeckCsv(deck.cards)}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = deckCsvFileName(deck.name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
