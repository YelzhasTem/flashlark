// Card text limits shared by the editors, CSV import and AI generation. Pure (no app imports)
// so node tests can load it.

/** Most characters one side of a card (word or translation) may hold. Short cards are easier to learn. */
export const CARD_SIDE_MAX_LENGTH = 150;

/** True when both sides fit the limit. */
export function cardFitsLimit(card: { term: string; definition: string }) {
  return card.term.length <= CARD_SIDE_MAX_LENGTH && card.definition.length <= CARD_SIDE_MAX_LENGTH;
}
