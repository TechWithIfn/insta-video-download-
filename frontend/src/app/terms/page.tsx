import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — SnapSave",
  description: "SnapSave terms of service.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="September 2026">
      <p>
        SnapSave is a tool for downloading publicly available media that you have the right
        to save, for personal use.
      </p>
      <p>
        You agree not to misuse the service, attempt to access non-public content through it,
        or use it in any way that violates applicable law or the rights of others.
      </p>
      <p>
        The service is provided as-is, without warranties of any kind. Availability of any
        given link depends on the source platform and its own access rules.
      </p>
    </LegalPage>
  );
}
