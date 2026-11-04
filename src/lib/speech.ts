// Reads card text aloud with the device's built-in voices (Web Speech API). It is free, needs no
// AI or network, and works in the iOS app's WebView too.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getLearningLanguageOption, type LearningLanguage } from "@/lib/languages";
import { splitTextForSpeech } from "@/lib/speech-chunks";

const SPEECH_LOCALES: Record<LearningLanguage, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  "zh-CN": "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  ru: "ru-RU",
  pt: "pt-BR",
  it: "it-IT",
};

// Joke voices that iOS and macOS list next to the real ones.
const NOVELTY_VOICES = new Set(
  [
    "albert",
    "bad news",
    "bahh",
    "bells",
    "boing",
    "bubbles",
    "cellos",
    "deranged",
    "good news",
    "hysterical",
    "jester",
    "organ",
    "pipe organ",
    "superstar",
    "trinoids",
    "whisper",
    "wobble",
    "zarvox",
  ].map((name) => name.toLowerCase()),
);

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

export function isSpeechSupported() {
  return synth() !== null && typeof SpeechSynthesisUtterance !== "undefined";
}

function normalizeTag(tag: string) {
  return tag.replace(/_/g, "-").toLowerCase();
}

// Voices load asynchronously in Chrome and Safari; the first getVoices() call can be empty.
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const speech = synth();
  if (!speech) return Promise.resolve([]);
  const voices = speech.getVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const done = () => {
      speech.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      resolve(speech.getVoices());
    };
    const timer = setTimeout(done, 1000);
    speech.addEventListener("voiceschanged", done);
  });
}

function pickVoice(voices: SpeechSynthesisVoice[], locale: string) {
  const wanted = normalizeTag(locale);
  const primary = wanted.split("-")[0];
  const candidates = voices.filter((voice) => {
    const tag = normalizeTag(voice.lang);
    return (
      (tag === primary || tag.startsWith(`${primary}-`)) &&
      !NOVELTY_VOICES.has(voice.name.toLowerCase())
    );
  });
  const score = (voice: SpeechSynthesisVoice) =>
    (normalizeTag(voice.lang) === wanted ? 4 : 0) +
    (voice.default ? 2 : 0) +
    (voice.localService ? 1 : 0);
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Starts loading the voice list early, so the first tap can speak right away. */
export function prepareSpeech() {
  void loadVoices();
}

// Chrome can drop an utterance that is garbage collected before it ends, so keep a reference.
let activeUtterances: SpeechSynthesisUtterance[] = [];
let speakRun = 0;
let finishActive: ((result: SpeakResult) => void) | null = null;

export function stopSpeaking() {
  speakRun++;
  activeUtterances = [];
  // Engines differ in which events a cancelled queue fires, so settle the caller here.
  finishActive?.("interrupted");
  finishActive = null;
  synth()?.cancel();
}

export type SpeakResult = "done" | "interrupted" | "no-voice" | "unsupported";

/**
 * Reads text aloud in the given language, stopping anything already being read. Long text is
 * read piece by piece so engines that cut off long utterances still read all of it.
 */
export async function speakText(text: string, language: LearningLanguage): Promise<SpeakResult> {
  const speech = synth();
  if (!speech || !isSpeechSupported()) return "unsupported";
  const pieces = splitTextForSpeech(text);
  if (!pieces.length) return "done";

  stopSpeaking();
  const run = speakRun;
  const locale = SPEECH_LOCALES[language] ?? language;
  // Speak in the same task as the tap when voices are ready: iOS only lets a page start
  // speech from a user gesture, so an await before the first speak() could block it.
  let voices = speech.getVoices();
  if (!voices.length) {
    voices = await loadVoices();
    if (run !== speakRun) return "interrupted";
  }
  const voice = pickVoice(voices, locale);
  // With voices listed but none in this language the engine would read with a wrong accent.
  if (voices.length && !voice) return "no-voice";

  return new Promise<SpeakResult>((settle) => {
    let settled = false;
    const resolve = (result: SpeakResult) => {
      if (settled) return;
      settled = true;
      if (finishActive === resolve) finishActive = null;
      settle(result);
    };
    finishActive = resolve;
    let remaining = pieces.length;
    activeUtterances = pieces.map((piece) => {
      const utterance = new SpeechSynthesisUtterance(piece);
      utterance.lang = voice?.lang ?? locale;
      if (voice) utterance.voice = voice;
      utterance.rate = 0.95;
      utterance.onend = () => {
        remaining--;
        if (remaining === 0) resolve(run === speakRun ? "done" : "interrupted");
      };
      utterance.onerror = () => resolve("interrupted");
      return utterance;
    });
    // Safari sometimes stays paused after the app returns from the background.
    if (speech.paused) speech.resume();
    for (const utterance of activeUtterances) speech.speak(utterance);
  });
}

/** Speaks text and tells the user when the device has no voice for the language. */
export async function speakAloud(text: string, language: LearningLanguage) {
  const result = await speakText(text, language);
  if (result === "no-voice") {
    toast.error(
      `This device has no ${getLearningLanguageOption(language).label} voice. You can add one in the system speech settings.`,
      { id: `no-voice-${language}` },
    );
  }
  return result;
}

let speechUnlocked = false;

/**
 * iOS lets a page start speech only from a tap until the page has spoken once. Auto-speak runs
 * after a render, not in the tap itself, so with auto-speak on the first tap anywhere in the app
 * speaks an empty phrase to allow later speech. Returns a cleanup function.
 */
export function installSpeechUnlock() {
  if (typeof window === "undefined") return () => {};
  const events = ["touchend", "click", "keydown"] as const;
  const unlock = () => {
    if (speechUnlocked || !isAutoSpeakEnabled() || !isSpeechSupported()) return;
    speechUnlocked = true;
    const utterance = new SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    synth()?.speak(utterance);
    for (const name of events) window.removeEventListener(name, unlock, true);
  };
  for (const name of events) window.addEventListener(name, unlock, true);
  return () => {
    for (const name of events) window.removeEventListener(name, unlock, true);
  };
}

const AUTO_SPEAK_KEY = "flashlark.autoSpeak.v1";
const AUTO_SPEAK_EVENT = "autoSpeak:changed";

export function isAutoSpeakEnabled() {
  try {
    return localStorage.getItem(AUTO_SPEAK_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoSpeakEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(AUTO_SPEAK_KEY, "1");
    else localStorage.removeItem(AUTO_SPEAK_KEY);
  } catch {
    // Storage can be unavailable (private mode); the setting then lasts for this page only.
  }
  window.dispatchEvent(new Event(AUTO_SPEAK_EVENT));
}

/** Whether cards are read aloud automatically when they open. Saved on this device. */
export function useAutoSpeak(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(isAutoSpeakEnabled());
    sync();
    window.addEventListener(AUTO_SPEAK_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(AUTO_SPEAK_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [on, setAutoSpeakEnabled];
}
