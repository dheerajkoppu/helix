const repositoryUrl = process.env.NEXT_PUBLIC_REPOSITORY_URL?.trim() || null;

export const site = {
  name: "Helix",
  tagline: "Open protein research for rare disease.",
  description:
    "An open research workspace for rare genetic disease: follow a disease to its gene, variant, protein structure and candidate mechanisms, with the source of every statement shown.",
  license: "Apache-2.0",
  /** Set NEXT_PUBLIC_REPOSITORY_URL to link the source repository. Null renders the in-app open-source page. */
  repositoryUrl,
  researchUseNotice: "Research use only. Not for clinical decisions.",
} as const;

export interface NavItem {
  label: string;
  href: string;
  /** path prefixes that mark the item as current */
  match: string[];
}

/** The three destinations printed in the top bar. */
export const PRIMARY_NAV: NavItem[] = [
  { label: "Lab", href: "/lab", match: ["/lab"] },
  {
    label: "Explore",
    href: "/explore",
    match: [
      "/explore",
      "/disease",
      "/gene",
      "/protein",
      "/variant",
      "/compare",
    ],
  },
  {
    label: "Projects",
    href: "/projects",
    match: ["/projects", "/project", "/s/"],
  },
];

/** Simple mode prints one destination; Explore and Projects move into the overflow menu. */
export const SIMPLE_NAV: NavItem[] = PRIMARY_NAV.filter(
  (item) => item.href === "/lab",
);

/** Everything else, listed in the top bar's overflow menu. */
export const SECONDARY_NAV: NavItem[] = [
  { label: "Jobs", href: "/jobs", match: ["/jobs"] },
  { label: "Models", href: "/models", match: ["/models"] },
  { label: "Docs", href: "/docs", match: ["/docs"] },
  { label: "About", href: "/about", match: ["/about"] },
];
