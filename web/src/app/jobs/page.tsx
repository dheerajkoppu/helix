import type { Metadata } from "next";
import { Suspense } from "react";

import { JobsList } from "./jobs-list";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <Suspense>
      <JobsList />
    </Suspense>
  );
}
