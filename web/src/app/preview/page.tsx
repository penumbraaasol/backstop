import { notFound } from "next/navigation";
import { PreviewStates } from "./states";

// Design review only: every UI state rendered from fixed data. Not served in production builds.
export default function Preview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PreviewStates />;
}
