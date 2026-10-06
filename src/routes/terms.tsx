import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/LegalPage";
import { MINIMUM_AGE, SUPPORT_EMAIL } from "@/lib/legal";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — Flashlark" },
      { name: "description", content: "The rules for using Flashlark and its community." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        By creating an account or using Flashlark you agree to these Terms and to our Privacy
        Policy. If you do not agree, do not use the app.
      </p>

      <LegalSection title="Your account">
        <p>
          You must give a valid email address and keep your password safe. You are responsible for
          activity on your account. You must be at least {MINIMUM_AGE} years old to use Flashlark.
        </p>
      </LegalSection>

      <LegalSection title="Community rules (zero tolerance)">
        <p>
          Flashlark lets you publish decks and collections and see content from other users. There
          is <strong>no tolerance for objectionable content or abusive users</strong>. You must not
          post or share content that:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>is hateful, harassing, threatening, sexually explicit or violent;</li>
          <li>targets or bullies a person or group;</li>
          <li>is illegal, promotes illegal activity, or infringes someone else's rights;</li>
          <li>is spam, a scam, or misleading;</li>
          <li>contains other people's personal data without their permission.</li>
        </ul>
        <p>
          You can report any public deck, collection or user, and you can block users so you no
          longer see their content. We review reports within 24 hours, remove content that breaks
          these rules, and suspend or delete the accounts of users who post it.
        </p>
      </LegalSection>

      <LegalSection title="Your content">
        <p>
          You keep ownership of the content you create. By publishing content to the community you
          allow other users to view and copy it into their own decks inside Flashlark, and you allow
          us to host and display it. Only publish content you have the right to share.
        </p>
      </LegalSection>

      <LegalSection title="AI features">
        <p>
          AI features generate suggestions automatically and may be wrong. Check generated cards
          before you rely on them. Do not submit personal or sensitive information to AI features.
          Usage limits apply to prevent abuse.
        </p>
      </LegalSection>

      <LegalSection title="Ending your use">
        <p>
          You can stop using Flashlark and delete your account at any time in Profile. We may
          suspend or close accounts that break these Terms.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimer">
        <p>
          Flashlark is provided "as is" without warranties of any kind. To the extent permitted by
          law, we are not liable for indirect or consequential damages, or for loss of data, arising
          from your use of the app.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          We may update these Terms; the date above shows the latest version. Continued use means
          you accept the updated Terms. Questions or reports:{" "}
          <a className="text-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
