import type { Metadata } from "next";
import HelpClient from "./HelpClient";

export const metadata: Metadata = {
  title: "Help & Guide | SnapSave",
  description:
    "Learn how to use SnapSave, troubleshoot common download issues, and find answers to frequently asked questions.",
  openGraph: {
    title: "Help & Guide | SnapSave",
    description:
      "Learn how to use SnapSave, troubleshoot common download issues, and find answers to frequently asked questions.",
    type: "website",
    siteName: "SnapSave",
  },
};

export default function HelpPage() {
  return <HelpClient />;
}
