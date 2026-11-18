import type { Metadata } from "next";
import { MyCover } from "@/components/MyCover";

export const metadata: Metadata = { title: "My cover" };

export default function CoverPage() {
  return <MyCover />;
}
