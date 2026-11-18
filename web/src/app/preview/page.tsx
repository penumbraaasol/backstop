import { notFound } from "next/navigation";
import { ClientOnlyPreview } from "./client-only";

// Design review only: every UI state rendered from fixed data. Not served in production builds.
export default function Preview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ClientOnlyPreview />;
}
