import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { resolveAiConsent, subscribeAiConsent } from "@/lib/ai-consent";

// Asked once per device, the first time an AI feature is used (see src/lib/ai-consent.ts).
export function AiConsentDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeAiConsent(setOpen), []);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resolveAiConsent(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Allow AI features?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                To create cards, translations, associations and reading texts, Flashlark sends the
                words, text, web page or image you submit to Google&apos;s Gemini API. Your email
                and account details are not sent.
              </p>
              <p>
                Please don&apos;t include personal or confidential information. Read more in the{" "}
                <Link
                  to="/privacy"
                  className="font-medium text-primary underline underline-offset-2"
                  onClick={() => resolveAiConsent(false)}
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolveAiConsent(false)}>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={() => resolveAiConsent(true)}>Allow</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
