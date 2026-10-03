import type { Metadata } from "next";

import { FrameDemo } from "./frame-demo";

export const metadata: Metadata = { title: "Reference stage" };

/** A complete workspace stage wired to live UniProt and AlphaFold DB data, for builders to copy. */
export default function FramePage() {
  return <FrameDemo />;
}
