import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import type { LearningLanguage } from "@/lib/languages";
import { isSpeechSupported, prepareSpeech, speakAloud, stopSpeaking } from "@/lib/speech";
import { cn } from "@/lib/utils";

type SpeakButtonProps = {
  text: string;
  language: LearningLanguage;
  className?: string;
  /** Hidden faces of a flip card stay out of the tab order. */
  tabIndex?: number;
};

/** Reads `text` aloud with the device voice. Renders nothing where speech is not available. */
export function SpeakButton({ text, language, className, tabIndex }: SpeakButtonProps) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const ok = isSpeechSupported();
    setSupported(ok);
    if (ok) prepareSpeech();
  }, []);

  if (!supported) return null;

  const onClick = (event: React.MouseEvent) => {
    // The button sits on cards that flip or open on click.
    event.stopPropagation();
    if (speaking) {
      stopSpeaking();
      return;
    }
    setSpeaking(true);
    void speakAloud(text, language).finally(() => setSpeaking(false));
  };

  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={(event) => event.stopPropagation()}
      tabIndex={tabIndex}
      aria-label={speaking ? "Stop reading" : "Read aloud"}
      aria-pressed={speaking}
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
        "text-current opacity-70 hover:opacity-100 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        speaking && "opacity-100 animate-pulse",
        className,
      )}
    >
      <Volume2 className="h-5 w-5" />
    </button>
  );
}
