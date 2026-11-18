import type { Metadata } from "next";
import { HowItWorks } from "@/components/HowItWorks";

export const metadata: Metadata = { title: "How it works" };

export default function HowPage() {
  return <HowItWorks />;
}
