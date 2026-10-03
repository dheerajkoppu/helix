import type { Metadata } from "next";

import { LabHome } from "@/components/lab/lab-home";

export const metadata: Metadata = { title: "Lab" };

export default function LabPage() {
  return <LabHome />;
}
