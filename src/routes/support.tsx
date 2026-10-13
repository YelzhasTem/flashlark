import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Support — Flashlark" },
      { name: "description", content: "Get help with Flashlark." },
    ],
  }),
  component: SupportPage,
});

function SupportPage() {
  return (
    <LegalPage title="Support">
      <p>
        Need help, found a bug, or want to report content? Write to{" "}
        <a className="text-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        . We usually reply within one or two days.
      </p>

      <LegalSection title="Common questions">
        <p>
          <strong>I did not get the confirmation email.</strong> Check your spam folder. The link
          opens in your browser; after confirming, return to the app and sign in with your email and
          password.
        </p>
        <p>
          <strong>I forgot my password.</strong> On the sign-in screen enter your email and tap
          "Forgot password?". Open the link from the email, set a new password, then sign in.
        </p>
        <p>
          <strong>How do I report or block someone?</strong> Open the deck, collection or creator
          page and use Report or Block. Reported content is reviewed within 24 hours.
        </p>
        <p>
          <strong>How do I delete my account?</strong> Open Profile and choose Delete account. This
          permanently removes your account and data.
        </p>
      </LegalSection>

      <LegalSection title="Policies">
        <p>
          Read our{" "}
          <Link to="/privacy" className="text-primary underline">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link to="/terms" className="text-primary underline">
            Terms of Use
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
