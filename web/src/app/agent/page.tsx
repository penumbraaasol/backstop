import type { Metadata } from "next";
import { AgentSection } from "@/components/AgentSection";

export const metadata: Metadata = { title: "Grok agent" };

export default function AgentPage() {
  return <AgentSection />;
}
