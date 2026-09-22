import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Disclaimer — Downloadit",
  description: "Downloadit disclaimer.",
  alternates: { canonical: "/disclaimer" },
};

export default function DisclaimerPage() {
  return (
    <LegalPage title="Disclaimer" updated="September 2026">
      <p>Downloadit is not affiliated with Instagram or Meta.</p>
      <p>
        The tool only works with publicly available content and does not bypass logins,
        private profiles, or platform access controls. You are responsible for ensuring you
        have the right to download and use any media you save.
      </p>
      <p>The service is provided as-is, without warranties of any kind.</p>
    </LegalPage>
  );
}
