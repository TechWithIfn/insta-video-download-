import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "DMCA / Copyright — Downloadit",
  description: "Downloadit copyright and DMCA information.",
};

export default function DmcaPage() {
  return (
    <LegalPage title="DMCA / Copyright" updated="September 2026">
      <p>
        Downloadit respects the intellectual property rights of others. Only download content
        you own or have permission to save.
      </p>
      <p>
        If you believe content accessible through Downloadit infringes your copyright, you may
        report it via the email link on this page. Please include identification of the
        copyrighted work, the location of the material in question, and your contact
        information so we can review the report.
      </p>
    </LegalPage>
  );
}
