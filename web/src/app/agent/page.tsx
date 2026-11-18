import type { Metadata } from "next";
import { AgentSection } from "@/components/AgentSection";

export const metadata: Metadata = { title: "Grok Bot" };

export default function AgentPage() {
  return <AgentSection />;
}
