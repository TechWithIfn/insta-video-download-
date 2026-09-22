import type { Metadata } from "next";
import HelpClient from "./HelpClient";

export const metadata: Metadata = {
  title: "Help & Guide | Downloadit",
  description:
    "Learn how to use Downloadit, troubleshoot common download issues, and find answers to frequently asked questions.",
  openGraph: {
    title: "Help & Guide | Downloadit",
    description:
      "Learn how to use Downloadit, troubleshoot common download issues, and find answers to frequently asked questions.",
    type: "website",
    siteName: "Downloadit",
  },
};

export default function HelpPage() {
  return <HelpClient />;
}
