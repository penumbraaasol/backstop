"use client";

import dynamic from "next/dynamic";

// Sample data uses the current time, so render it only in the browser to avoid hydration mismatches.
export const ClientOnlyPreview = dynamic(() => import("./states").then((m) => m.PreviewStates), { ssr: false });
