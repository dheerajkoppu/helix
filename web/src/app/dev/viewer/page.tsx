import type { Metadata } from "next";
import { Suspense } from "react";

import { ViewerDemo } from "./viewer-demo";

export const metadata: Metadata = { title: "3D viewer" };

/** Every feature of the Mol* viewport on BTK, loaded straight from AlphaFold DB and RCSB PDB. */
export default function ViewerPage() {
  return (
    <Suspense fallback={null}>
      <ViewerDemo />
    </Suspense>
  );
}
