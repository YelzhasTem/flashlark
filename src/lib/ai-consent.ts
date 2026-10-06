// App Review (guideline 5.1.2) requires explicit permission before user content is sent to a
// third-party AI. Every AI request goes through executeAiRequest, which asks once per device via
// the dialog mounted in the root layout (AiConsentDialog).

const STORAGE_KEY = "lingocards.aiConsent.v1";

export const AI_CONSENT_DECLINED_MESSAGE =
  "You did not allow AI features. Try again and tap Allow to use them.";

const FALLBACK_PROMPT =
  "Flashlark sends the words, text, web page or image you submit to Google's Gemini API to create the result. Your email and account details are not sent. Allow AI features?";

type Listener = (open: boolean) => void;

const listeners = new Set<Listener>();
let waiting: Array<(granted: boolean) => void> = [];

export function hasAiConsent() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "granted";
  } catch {
    return false;
  }
}

function rememberConsent() {
  try {
    localStorage.setItem(STORAGE_KEY, "granted");
  } catch {
    // Without storage the question is simply asked again next time.
  }
}

/** Resolves true when AI may be used: stored consent, or the person taps Allow now. */
export function requestAiConsent(): Promise<boolean> {
  if (hasAiConsent()) return Promise.resolve(true);
  if (listeners.size === 0) {
    // The dialog is not mounted (should not happen): ask with the browser prompt instead.
    const granted = typeof window !== "undefined" && window.confirm(FALLBACK_PROMPT);
    if (granted) rememberConsent();
    return Promise.resolve(granted);
  }
  return new Promise((resolve) => {
    waiting.push(resolve);
    listeners.forEach((listener) => listener(true));
  });
}

export function resolveAiConsent(granted: boolean) {
  if (granted) rememberConsent();
  const pending = waiting;
  waiting = [];
  pending.forEach((resolve) => resolve(granted));
  listeners.forEach((listener) => listener(false));
}

export function subscribeAiConsent(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
