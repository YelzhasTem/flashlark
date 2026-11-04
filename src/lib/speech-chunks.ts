// Splits text into pieces short enough for every speech engine. Pure so node tests can load it.

/**
 * Some engines stop reading a long utterance part way (Chrome after about 15 seconds), so long
 * text is read as a queue of short pieces. 120 characters is a few seconds of speech.
 */
export const SPEECH_CHUNK_MAX_LENGTH = 120;

const SENTENCE_END = /(?<=[.!?…。！？])\s+|(?<=[。！？])/u;
const CLAUSE_END = /(?<=[,;:，、；：])\s*/u;

function splitBy(pieces: string[], pattern: RegExp, maxLength: number) {
  return pieces.flatMap((piece) =>
    piece.length > maxLength ? piece.split(pattern).filter((part) => part.trim()) : [piece],
  );
}

function splitWords(piece: string, maxLength: number): string[] {
  if (piece.length <= maxLength) return [piece];
  const chunks: string[] = [];
  let current = "";
  for (const word of piece.split(/\s+/)) {
    if (!word) continue;
    if (word.length > maxLength) {
      // A long run with no spaces (Chinese, Japanese) is cut at the limit.
      if (current) chunks.push(current);
      current = "";
      const chars = Array.from(word);
      for (let i = 0; i < chars.length; i += maxLength) {
        chunks.push(chars.slice(i, i + maxLength).join(""));
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Splits at sentence ends, then at commas, then between words, so every piece fits. */
export function splitTextForSpeech(text: string, maxLength = SPEECH_CHUNK_MAX_LENGTH): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxLength) return [clean];
  const sentences = splitBy([clean], SENTENCE_END, maxLength);
  const clauses = splitBy(sentences, CLAUSE_END, maxLength);
  return clauses.flatMap((piece) => splitWords(piece.trim(), maxLength)).filter(Boolean);
}
