import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/LegalPage";
import { MINIMUM_AGE, SUPPORT_EMAIL } from "@/lib/legal";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Flashlark" },
      { name: "description", content: "How Flashlark collects, uses and protects your data." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Flashlark is a flashcard app for learning vocabulary. This policy explains what data we
        collect when you use the Flashlark app and website, why we collect it, and the choices you
        have. We do not sell your data, we do not show ads, and we do not track you across other
        apps or websites.
      </p>

      <LegalSection title="Data we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account data:</strong> your email address, password (stored only as a secure
            hash by our authentication provider), username, display name and, if you upload one,
            your profile picture.
          </li>
          <li>
            <strong>Your content:</strong> decks, cards, words, translations, notes, images and
            collections you create or import.
          </li>
          <li>
            <strong>Learning data:</strong> your answers, study sessions, progress, streaks and
            review schedule, so the app can plan your repetitions.
          </li>
          <li>
            <strong>Community data:</strong> decks and collections you publish, people you follow or
            add as friends, users you block, and reports you send about content.
          </li>
          <li>
            <strong>AI requests:</strong> when you use an AI feature (for example, generating cards,
            translations or examples), the text, link or image you submit is processed to produce
            the result. To prevent abuse we keep a usage counter and a one-way, salted hash of your
            IP address; we do not store the IP address itself.
          </li>
          <li>
            <strong>Technical data:</strong> standard server logs (such as request time and error
            details) kept by our hosting providers for security and troubleshooting.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use your data">
        <p>
          We use your data only to provide and improve Flashlark: to create and secure your account,
          store and sync your decks, schedule reviews, show your statistics, run community features
          you choose to use, answer AI requests, moderate reported content, and respond to support
          requests.
        </p>
      </LegalSection>

      <LegalSection title="Service providers">
        <p>We share data only with providers that run the service for us:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Supabase</strong> — database, authentication and file storage.
          </li>
          <li>
            <strong>Vercel</strong> — hosting of the app and its server.
          </li>
          <li>
            <strong>Google (Gemini API)</strong> — processes the text, links or images you submit to
            AI features. Only the content of that request is sent; your email and account details
            are not. Before your first AI request on a device, the app asks for your permission, and
            nothing is sent if you choose Not now.
          </li>
          <li>
            <strong>Google Fonts</strong> — delivers the app's typeface; your device requests the
            font files directly from Google.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Public content">
        <p>
          Your username, display name and profile picture can be seen by other users. Decks and
          collections you publish to the community are visible to others until you make them private
          or delete them. Private decks are visible only to you.
        </p>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <p>
          We keep your data while your account exists. You can delete your account at any time in
          the app under <strong>Profile → Delete account</strong>. This permanently removes your
          account, decks, cards, learning history and profile. Content you published is removed with
          it. Backups held by our providers are overwritten on their normal schedule.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          You can view and edit your data in the app, export your decks as CSV, and delete your
          account. To ask for a copy of your data or any other privacy request, contact us at{" "}
          <a className="text-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Minimum age">
        <p>
          Flashlark is only for people who are {MINIMUM_AGE} or older, and we do not knowingly
          collect data from anyone younger. If you believe someone under {MINIMUM_AGE} has created
          an account, contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Data is sent over encrypted connections (HTTPS). Access to your private data is limited to
          your own account by database access rules.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          If we change this policy we will update the date above. Questions:{" "}
          <a className="text-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
