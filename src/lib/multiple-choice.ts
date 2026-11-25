// Multiple-choice modes (Speed, Deep) need wrong options that differ from the right answer.
// The server compares answers after normalize_study_answer (lower case, accents and common
// punctuation removed, spaces collapsed); this mirrors it so the page can say up front that a
// deck cannot be played, instead of failing on a question.

export const MIN_MULTIPLE_CHOICE_CARDS = 4;

export function normalizeStudyAnswer(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,!?;:"'`()[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function distinctCount(values: string[]) {
  return new Set(values.map(normalizeStudyAnswer).filter(Boolean)).size;
}

/**
 * True when every question can get at least one wrong option, in both directions (the sides
 * can be swapped mid-run). That needs two or more different answers on each side.
 */
export function canPlayMultipleChoice(cards: { term: string; definition: string }[]) {
  return (
    cards.length >= MIN_MULTIPLE_CHOICE_CARDS &&
    distinctCount(cards.map((card) => card.definition)) >= 2 &&
    distinctCount(cards.map((card) => card.term)) >= 2
  );
}
