import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — SnapSave",
  description: "SnapSave privacy policy.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="September 2026">
      <p>
        SnapSave does not require an account, sign-up, or login. We do not keep a download
        history in your browser.
      </p>
      <p>
        When you paste a link, it is sent to our backend solely to resolve publicly available
        media and deliver your download. Links and resolved media references are kept only
        transiently to complete your request and expire automatically.
      </p>
      <p>
        We do not sell personal information. If you have any privacy questions, contact us
        using the email link on this page.
      </p>
    </LegalPage>
  );
}
