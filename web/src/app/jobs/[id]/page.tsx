import type { Metadata } from "next";

import { decodeParam } from "@/lib/ids";

import { JobDetail } from "./job-detail";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Job ${decodeParam((await params).id)}` };
}

export default async function JobPage({ params }: Props) {
  const jobId = decodeParam((await params).id);
  return <JobDetail key={jobId} jobId={jobId} />;
}
