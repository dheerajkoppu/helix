import type { Metadata } from "next";

import { ProjectWorkspace } from "@/components/project/project-workspace";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Project ${decodeParam((await params).id)}` };
}

export default async function ProjectPage({ params }: Props) {
  return <ProjectWorkspace projectId={decodeParam((await params).id)} />;
}
