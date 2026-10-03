# UI libraries and design system for Helix

Research date: 2026-10-03. Scope: the ten sites collected from X, the current React UI foundation landscape, and a build-ready token set.

How facts were checked: npm registry (`npm view`), GitHub API (`gh api`), live HTTP fetch of every listed site, the shadcn CLI 4.21.1 run in two throwaway projects and in a scratch copy of this repository's `web/` app, and production builds (Next 16.3.8 with pnpm 12.8.1 in the `web/` copy, Next 16.3.6 in the template probes; Turbopack, TypeScript 5.9.3) on the exact `globals.css`, `layout.tsx`, `theme-provider.tsx` and dependency set in sections 4 to 7. Nothing inside `web/` was modified. Colour numbers are computed: WCAG 2 contrast, and OKLab ΔE×100 under Machado 2009 protan/deutan simulation (target ≥ 8, floor 6; normal-vision floor 15). Anything that could not be checked is in section 10.

## 0. Recommendation for Helix

1. **Foundation: shadcn/ui on Base UI, style Mira.** Run `pnpm dlx shadcn@latest init -b base -p mira` inside the existing `web/` app. Base UI has been the shadcn default since 2026-07-02. Mira is the densest official style (28px controls, 12px control text). The generated source lives in `components/ui` and is owned by the repo.
2. **None of the ten listed sites is a foundation.** Seven are motion-first component collections, effect packages or inspiration galleries, one is unreachable to bots, one is a video SaaS. Astryx (Meta) is the only real design system on the list and is still beta. Borrow motion values from transitions.dev and component vocabulary from Astryx and Arc. Install none of them.
3. **Styling: Tailwind CSS 4.3.3 with CSS-variable tokens** (section 7), class-based dark mode through `next-themes`. No `tailwind.config.js`.
4. **Type: IBM Plex Sans + IBM Plex Mono through `next/font/google`.** Of the sans faces tested, Plex Sans is the only one whose Google Fonts build separates `I`, `l` and `1` (IL2RG, IL7R, IKBKG, `Il2rg`), it ships tabular digits by default, a Greek subset and a width axis for dense columns.
5. **Data views: TanStack Table 9.2.4 + TanStack Virtual 3.14.13.** Override the shadcn `table` component: every style ships 40px rows.
6. **Motion: CSS transitions first.** Ceiling 250ms, strong ease-out, closes faster than opens, zero animation on keyboard-triggered actions. `motion` 14 only for layout or gesture work. React `<ViewTransition>` for route continuity.
7. **Colour: monochrome chrome.** Ink-on-paper primary actions, neutral focus ring. Saturated colour is reserved for pLDDT, AlphaMissense, the variant marker, structure provenance, and destructive/warning states.
8. **Scientific colours are copied from the AlphaFold DB production front-end** (hex values in section 8) and are identical in light and dark. Every Helix-defined colour carries a second, non-colour channel, because the canonical palettes already use up the colour-blind-safe range.

## 1. The ten listed sites

| Site                                           | What it actually is                                                                                                                                                                                                       | Licence                                                                                                                                                                                | Tech requirements                                                                                                                                            | Maintenance on 2026-10-03                                                                                       | Fit for Helix                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [uiarc.dev](https://uiarc.dev)                 | "Arc UI": animated React components and blocks, shadcn registry `@uiarc`, free tier plus paid Pro                                                                                                                         | MIT for the free repo ([kuratlielia/arc-library](https://github.com/kuratlielia/arc-library))                                                                                          | React 19, CSS modules on its own tokens, `motion`, some `@radix-ui/*`, `lucide-react`; Tailwind optional                                                     | Repo created 2026-09-24 (9 days old), 241 stars, one contributor, pushed today                                  | Ideas only. Too young, CSS-modules tokens and Radix parts clash with a Tailwind + Base UI stack                                                                |
| [libraries.dev](https://libraries.dev)         | Effect packages by Jakub Antalik: `border-beam` 1.4.1, `thinking-orbs` 0.3.2, `liquid-gooey` 0.2.2, `metal-fx` 2.0.11, `img-fx` 0.5.1, plus Voice and Bot Avatars                                                         | MIT (npm and repo); paid "Pro" studio                                                                                                                                                  | React 18+; `img-fx` needs `three`                                                                                                                            | 4,046 stars, pushed 2026-10-02                                                                                  | None. Purely decorative                                                                                                                                        |
| [transitions.dev](https://transitions.dev)     | Catalogue of CSS UI transitions (repo says 43+, 32 free skill files) with a CLI (`transitions-dev` 0.3.0), an agent skill and a "Refine" tool                                                                             | Custom "Transitions.dev License": free personal and commercial use and modification; redistributing the collection as a competing kit is prohibited; tooling MIT; Pro transitions paid | Plain CSS custom properties, small JS for some; no runtime dependency                                                                                        | 4,529 stars, pushed today                                                                                       | Good source of restrained timing values (section 2)                                                                                                            |
| [astryx.atmeta.com](https://astryx.atmeta.com) | Meta's open-source design system, "Currently in Beta"                                                                                                                                                                     | MIT                                                                                                                                                                                    | `@astryxdesign/core` 0.6.5, peers `react >=19`, `@stylexjs/stylex ^0.19.0`; pre-built CSS, themes are CSS custom property overrides; CLI `@astryxdesign/cli` | 13,532 stars, 533 open issues, pushed today, releases roughly weekly (v0.6.2 09-15, v0.6.3 09-23, v0.6.4 10-01) | Closest in spirit (built for internal tools). Rejected as foundation: beta with breaking minors, second styling system beside Tailwind, Meta's visual identity |
| [beui.dev](https://beui.dev)                   | "beUI": animated components built with Motion and Tailwind, shadcn registry `@beui`, paid Pro tier                                                                                                                        | MIT ([starc007/ui-components](https://github.com/starc007/ui-components))                                                                                                              | React 19, Tailwind 4, Motion                                                                                                                                 | 1,729 stars, repo since 2024-01, pushed today                                                                   | Low. Dynamic Island, Tilt Card, Bloom Menu, Bouncy Accordion are showpieces                                                                                    |
| [bencho.dev/finds](https://bencho.dev/finds)   | Curated wall of 139 credited UI interaction clips. The parent site also has live blocks, 82 UI sounds and a canvas                                                                                                        | No licence, repo or install command on the fetched pages                                                                                                                               | n/a                                                                                                                                                          | Live                                                                                                            | Inspiration only                                                                                                                                               |
| [obsidianui.dev](https://obsidianui.dev)       | React + Tailwind components, blocks and landing-page templates                                                                                                                                                            | MIT ([Atharvsinh-codez/ObsidianUI](https://github.com/Atharvsinh-codez/ObsidianUI))                                                                                                    | `@radix-ui/*`, `motion`, `gsap`, `three`, `@react-three/fiber`, `lenis`                                                                                      | 278 stars, one contributor                                                                                      | None. Marketing-site effects (cursor effects, scroll animation, text reveals, WebGL backgrounds)                                                               |
| [designeer.xyz](https://designeer.xyz)         | Returned HTTP 429 "Vercel Security Checkpoint" to every automated request. Search index describes a link directory: Design Engineers (132), Inspiration (122), Components (120), Build (64), Utilities (61), Visuals (55) | n/a                                                                                                                                                                                    | n/a                                                                                                                                                          | Live, not machine-readable                                                                                      | A bookmark list, not a library                                                                                                                                 |
| [inspora.design](https://inspora.design)       | Archive of visual design work (Web, Branding, Product, Motion, Illustration, 3D, Print), contact @neropursue                                                                                                              | No code                                                                                                                                                                                | n/a                                                                                                                                                          | Live                                                                                                            | Inspiration only                                                                                                                                               |
| [reelfolio.io](https://reelfolio.io)           | SaaS that turns screenshots and clips into portfolio showreel videos, $12/month billed annually                                                                                                                           | Commercial                                                                                                                                                                             | n/a                                                                                                                                                          | Live                                                                                                            | Not a UI library. Irrelevant to the build                                                                                                                      |

Notes:

- Arc's counts disagree across its own surfaces: site copy "147 components and 85 blocks", README badge "105 components / 22 blocks", `registry.json` 128 items.
- Astryx component directory (150+): `Table`, `TreeList`, `PowerSearch`, `Tokenizer`, `Typeahead`, `CommandPalette`, `Resizable`, `SegmentedControl`, `MetadataList`, `OverflowList`, `StatusDot`, `Timestamp`, `Citation`, `AppShell`, `Toolbar`. Charts (`@astryxdesign/charts`, `@astryxdesign/vega`) exist only under the `canary` dist-tag.
- Third-party shadcn registries built on Radix (Arc, ObsidianUI) pull `@radix-ui/*` into a Base UI project and use `asChild` where Base UI uses the `render` prop. Treat them as reference code.

## 2. What to borrow and what to avoid

| Borrow                                 | Source                                                                                                                                                                                                                                                           | Values or idea                                                                                                            | Helix adjustment                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Menu and popover open/close            | transitions.dev [`05-menu-dropdown.md`](https://github.com/Jakubantalik/transitions.dev/blob/main/skills/transitions-dev/05-menu-dropdown.md)                                                                                                                    | Origin-aware scale 0.97 to 1 plus opacity; open 250ms, close 150ms, `cubic-bezier(0.22, 1, 0.36, 1)`; closing scale 0.99  | Open 200ms, close 150ms; use Base UI's `--transform-origin`      |
| Dialog                                 | [`06-modal.md`](https://github.com/Jakubantalik/transitions.dev/blob/main/skills/transitions-dev/06-modal.md)                                                                                                                                                    | Scale 0.96, open 250ms, close 150ms, centre origin                                                                        | Keep                                                             |
| Tooltip                                | [`17-tooltip.md`](https://github.com/Jakubantalik/transitions.dev/blob/main/skills/transitions-dev/17-tooltip.md)                                                                                                                                                | In 150ms, out 50ms, scale 0.98; one shared bubble slides between neighbouring triggers in 160ms                           | Use Base UI provider grouping (section 3.7)                      |
| Tabs indicator                         | [`16-tabs-sliding.md`](https://github.com/Jakubantalik/transitions.dev/blob/main/skills/transitions-dev/16-tabs-sliding.md)                                                                                                                                      | Indicator translates and resizes in 250ms; snaps without transition on first paint and resize                             | Pointer only. Keyboard tab changes are instant                   |
| Skeleton to content                    | [`14-skeleton-reveal.md`](https://github.com/Jakubantalik/transitions.dev/blob/main/skills/transitions-dev/14-skeleton-reveal.md)                                                                                                                                | Skeleton and content share one slot, cross-fade, single pulse of 1000ms                                                   | Cross-fade 200ms, no blur on large panels                        |
| Open/close asymmetry and stagger rules | [`_refine-rules.md`](https://github.com/Jakubantalik/transitions.dev/blob/main/skills/transitions-polish/_refine-rules.md)                                                                                                                                       | Closes are faster and quieter than opens; never delay a close; overshoot only on entrances                                | No overshoot anywhere                                            |
| Animation decision table               | Emil Kowalski [`STANDARDS.md`](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md) (MIT)                                                                                                                                     | 100+ uses/day: no animation; `ease-out` for enter and exit; under 300ms; never `scale(0)`; only `transform` and `opacity` | Adopt as review checklist                                        |
| Record metadata vocabulary             | Astryx [`packages/core/src`](https://github.com/facebook/astryx/tree/main/packages/core/src)                                                                                                                                                                     | `MetadataList`, `Citation`, `Timestamp`, `StatusDot`, `OverflowList`, `Tokenizer`, `PowerSearch`                          | Rebuild on Base UI for source IDs, provenance rows, filter chips |
| Tool-style components                  | Arc: [tree-view](https://uiarc.dev/components/tree-view), [filter-toolbar](https://uiarc.dev/components/filter-toolbar), [json-viewer](https://uiarc.dev/components/json-viewer), `sortable-data-table`, `shortcut-recorder`, `image-compare`, `hold-to-confirm` | Interaction design reference                                                                                              | Strip the entrance motion                                        |
| Interaction references                 | Bencho blocks: "Heat map (Hover)", "Image compare (Drag)", "Time scrubber (Slide)" at [bencho.dev](https://bencho.dev)                                                                                                                                           | Hover readout and scrub behaviour                                                                                         | For residue heatmaps and reference/variant comparison            |
| Web interface rules                    | [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines)                                                                                                                                                                                          | Section 9                                                                                                                 | Adopt                                                            |

Avoid (decorative, or harmful to scientific reading):

- Border beams, glows, gooey and liquid-metal effects, orbs, voice glows, bot avatars (all of libraries.dev).
- 3D tilt cards, card stacks, dynamic islands, confetti, like-button bursts, gradient or shimmer text, text reveal on scroll, smooth-scroll hijacking (`lenis`), cursor effects, UI sounds.
- Rolling or spinning number counters and number pop-ins on any scientific value (pLDDT, scores, counts). A value that animates is a value that cannot be read or trusted mid-flight.
- Chart or heatmap entrance animations, bouncy springs, staggered list entrances on data tables.
- transitions.dev panel reveal (400ms / 350ms) and toast (350ms) durations as published: over the 250ms ceiling.

Licence note: transitions.dev snippets are under a custom licence with a redistribution restriction. Helix is open source. Re-implement the values in Helix's own CSS instead of copying snippet files into the repository.

## 3. React UI foundations in October 2026

### 3.1 Headless primitives

| Library               | Package and version                 | Licence    | Status                                                                            | Notes                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------- | ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base UI               | `@base-ui/react` 1.8.0 (2026-09-04) | MIT        | 11.1k stars, pushed 2026-10-03, minors 1.5 (May), 1.6 (Jun), 1.7 (Aug), 1.8 (Sep) | 37 components including Autocomplete, Combobox, Drawer, Toast, Number Field, OTP Field, Menubar, Meter, Toolbar, Preview Card. Built by the people behind Radix, MUI and Floating UI. Old name `@base-ui-components/react` stopped at 1.0.0-rc.0 |
| Radix                 | `radix-ui` 1.6.7 (2026-07-31)       | MIT        | 19.4k stars, maintained by WorkOS, last push 2026-08-08, 364 open issues          | Still fully supported by shadcn (`-b radix`). No Combobox or Autocomplete                                                                                                                                                                        |
| React Aria Components | `react-aria-components` 1.21.1      | Apache-2.0 | Adobe, published 2026-10-03                                                       | shadcn base since 2026-07-17 (`-b aria`). Widest coverage: Table, GridList, Tree, date and colour pickers, drag and drop, Virtualizer. Larger API                                                                                                |
| Ark UI                | `@ark-ui/react` 5.39.2              | MIT        | Chakra team, 5.4k stars, 13 open issues                                           | Not a shadcn base                                                                                                                                                                                                                                |

Decision: Base UI. It is the shadcn default, actively released, and one package covers every overlay Helix needs. Add `react-aria-components` only if a later feature needs an ARIA grid, tree or drag and drop that Base UI lacks.

Base UI setup requirements ([quick start](https://base-ui.com/react/overview/quick-start)): put `isolation: isolate` on the app root so portalled popups stack above the page, and `position: relative` on `body` for iOS 26 Safari backdrops. Both are in section 7.

### 3.2 shadcn/ui state

Source: changelog files in [shadcn-ui/ui](https://github.com/shadcn-ui/ui/tree/main/apps/v4/content/docs/changelog) and `npx shadcn@latest --help` (CLI 4.21.1, MIT, 125k stars).

| Date          | Change                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-12-12    | `npx shadcn create`; five styles: Vega (classic), Nova (compact), Maia (soft), Lyra (boxy, pairs with mono), Mira ("Compact. Made for dense interfaces.") |
| 2026-03-06    | CLI v4: presets (`--preset`), `--dry-run`, `--diff`, `--view`, templates, `npx skills add shadcn/ui`                                                      |
| 2026-03 to 05 | Styles Luma, Sera, Rhea. `shadcn eject` inlines `shadcn/tailwind.css`                                                                                     |
| 2026-07-02    | "Base UI is the default component library in shadcn/ui". Radix remains supported, no migration required                                                   |
| 2026-07-17    | React Aria added as third base (`--base aria`)                                                                                                            |
| 2026-07-23    | `toast` component on Base UI Toast                                                                                                                        |
| 2026-07-31    | Registries can search server-side: `GET /r/registry.json?q=button&limit=50&offset=0` returns `items[]` and `pagination {total, offset, limit, hasMore}`   |
| 2026-08       | Private GitHub registries                                                                                                                                 |
| 2026-09-03    | Components import `cn` from the `cn` package; `clsx` + `tailwind-merge` no longer scaffolded. Migration: `npx shadcn@latest migrate cn`                   |

CLI facts verified by running it:

- `init` options: `-t <next|start|vite|react-router|laravel|astro>`, `-b <base|radix|aria>`, `-p <preset>`, `-d` (= `--template=next --preset=base-nova`), `--no-monorepo`, `-n <name>`, `-y`.
- Preset names are `nova, vega, maia, lyra, mira, luma, sera, rhea`. `-p base-mira` is rejected; `-p mira` with `-b base` writes `"style": "base-mira"`.
- Registry item URL: `https://ui.shadcn.com/r/styles/base-mira/<name>.json`. Fields: `name`, `type`, `dependencies`, `registryDependencies`, `files[] {path, type, content}`.
- Commands: `add`, `apply`, `docs`, `view`, `search|list`, `migrate`, `eject`, `info`, `build`, `mcp`, `preset`, `registry`.

Measured control geometry per style (Base UI variants, from the registry JSON):

| Style                     | Button default / sm / xs | Input | Radius class   | Control text     |
| ------------------------- | ------------------------ | ----- | -------------- | ---------------- |
| `base-mira`               | 28 / 24 / 20 px          | 28 px | `rounded-md`   | `text-xs` (12px) |
| `base-nova` (CLI default) | 32 / 28 / 24 px          | 32 px | `rounded-lg`   | `text-sm`        |
| `base-lyra`               | 32 / 28 / 24 px          | 32 px | `rounded-none` | `text-xs`        |
| `base-vega`               | 36 / 32 / 24 px          | 36 px | `rounded-md`   | `text-sm`        |
| `base-rhea`               | 32 / 28 / 24 px          | 32 px | `rounded-2xl`  | `text-sm`        |

Caveats found in the generated output:

- The Mira preset sets `"iconLibrary": "hugeicons"` and loads Inter + Geist Mono. Change both (section 5).
- `table` is identical in every style: `th` is `h-10 px-2`, `td` is `p-2`. Rewrite it for 28px rows.
- `tooltip.tsx` sets the provider `delay` to `0`.
- `drawer.tsx` imports `@base-ui/react/drawer`. Vaul is no longer involved.

### 3.3 Command palette

| Option                                  | State                                                                                                                                                                                                                  | Verdict                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cmdk` 1.1.1                            | Repo moved to [dip/cmdk](https://github.com/dip/cmdk); last release 2025-03-14, last commit 2025-10-29, 77 open issues. Depends on four `@radix-ui/*` packages, which installed 16 `@radix-ui/*` packages in the probe | Use now. shadcn `command` wraps it on every base, and it is the pick in Emil Kowalski's [library list](https://github.com/emilkowalski/skills/blob/main/skills/pick-ui-library/SKILL.md) |
| Base UI `Autocomplete` in a `Dialog`    | Documented "Command palette" example with inline list, groups and `ScrollArea` at [base-ui.com/react/components/autocomplete](https://base-ui.com/react/components/autocomplete)                                       | Migration target if cmdk stalls or the Radix transitive packages become a problem                                                                                                        |
| `kbar` 1.0.0, React Aria `Autocomplete` | Maintained                                                                                                                                                                                                             | Not needed                                                                                                                                                                               |

Rules: open and close with zero animation; show shortcuts with the `kbd` component; results grouped by entity type (disease, gene, variant, structure, job).

### 3.4 Motion

| Tool                                                                                    | Version                                                                                   | Use                                                                                    |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| CSS transitions, `@starting-style`, Base UI `data-starting-style` / `data-ending-style` | platform                                                                                  | Default for every overlay, hover and state change                                      |
| `tw-animate-css`                                                                        | 1.4.0                                                                                     | Keyframe utilities used by shadcn components (`animate-in`, `fade-in-0`, `zoom-in-95`) |
| `motion`                                                                                | 14.0.0 (released 2026-10-02; changelog lists only removal of internal compatibility APIs) | Import from `motion/react`. Layout animation, drag, interruptible gestures only        |
| React `<ViewTransition>`                                                                | `import { ViewTransition } from 'react'`                                                  | Route-level continuity                                                                 |

View transitions, from the Next.js 16.3.8 guide (updated 2026-08-25): "View transitions work in the App Router with no configuration. The App Router uses React canary releases". `<Link transitionTypes={['nav-forward']}>` and `router.push` accept transition types. Checked by inspecting packages: `react@19.3.0` exports `ViewTransition` and `addTransitionType`; `react@19.2.8` does not; Next's vendored React does. Needs Chromium 125+ or recent Safari/Firefox, and degrades to no animation.

Use it for one thing: the shared-element morph when an entity (gene symbol, variant label, structure thumbnail) moves from a list row into the detail header. No directional page slides.

### 3.5 Tailwind CSS v4 theming

- `tailwindcss` and `@tailwindcss/postcss` 4.3.3 (2026-07-16). PostCSS config is the single plugin `"@tailwindcss/postcss": {}`.
- Tokens are CSS variables on `:root` and `.dark`, exposed to utilities through `@theme inline { --color-x: var(--x); }`. Dark variant: `@custom-variant dark (&:is(.dark *));`.
- Namespaces used: `--color-*`, `--font-*`, `--text-*` with `--text-*--line-height`, `--radius-*`, `--shadow-*`, `--ease-*`. Durations are plain variables on `:root`, used as `duration-(--dur-base)` (compiles to `transition-duration: var(--dur-base)`).
- 4.3.0 added `scrollbar-{auto,thin,none}`, `scrollbar-thumb-*`, `scrollbar-gutter-*`: use `scrollbar-thin` and `scrollbar-gutter-stable` on panels to stop layout shift.
- Do not change `--spacing`. It is a multiplier and redefines every utility (the reason shadcn shipped Rhea as a separate style).

### 3.6 Data-dense tables and virtualisation

| Library          | Version                                                           | Licence | Verdict                                                                                    |
| ---------------- | ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| TanStack Table   | `@tanstack/react-table` 9.2.4 (v9 stable since 2026-08-04)        | MIT     | Use. Headless, features are opt-in and tree-shaken. The shadcn data-table guide targets v9 |
| TanStack Virtual | `@tanstack/react-virtual` 3.14.13                                 | MIT     | Use for rows and for horizontal residue windows                                            |
| react-virtuoso   | 4.18.16                                                           | MIT     | Alternative for variable-height lists                                                      |
| virtua           | 0.52.10                                                           | MIT     | Alternative named in the Vercel guidelines                                                 |
| AG Grid          | `ag-grid-community` 36.2.0 MIT; `ag-grid-enterprise` "Commercial" | mixed   | Only if pivoting, range selection or Excel export become requirements                      |
| Glide Data Grid  | `@glideapps/glide-data-grid` 6.0.3                                | MIT     | Canvas grid; consider past 100k cells in view                                              |

v9 API as compiled in the probe (v8's `useReactTable` and `getCoreRowModel` are gone):

```tsx
import { createSortedRowModel, rowSortingFeature, sortFns, tableFeatures, useTable, type ColumnDef } from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns })
const columns: Array<ColumnDef<typeof features, Variant>> = [{ accessorKey: "hgvs", header: "HGVS" }]

const table = useTable({ features, columns, data })
const rows = table.getRowModel().rows
const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 28, overscan: 12 })
// render with <table.FlexRender cell={cell} /> and <table.FlexRender header={header} />
```

Checked against the installed 9.2.4 package: `useReactTable` and `getCoreRowModel` are not exported. Feature objects that are exported: `rowSortingFeature`, `columnFilteringFeature`, `globalFilteringFeature`, `rowSelectionFeature`, `columnVisibilityFeature`, `columnPinningFeature`, `columnSizingFeature`, `columnResizingFeature`, `columnOrderingFeature`, `rowExpandingFeature`, `rowPinningFeature`, `columnGroupingFeature`, `columnFacetingFeature`, plus `stockFeatures` (everything) and the row-model factories `createSortedRowModel`, `createFilteredRowModel`, `createPaginatedRowModel`.

### 3.7 Toast, sheet, drawer, resizable panels, tooltip

| Need             | Choice                                                                  | Facts                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toast            | `sonner` 2.0.8 (2026-08-09, MIT) through shadcn `sonner`                | Peer React 18/19. `toast.promise` suits long-running prediction jobs. Alternative: shadcn `toast` on Base UI Toast                                                      |
| Drawer           | shadcn `drawer` on `@base-ui/react/drawer`                              | `vaul` 1.1.2 (2024-12): README says "This repo is unmaintained". Do not install                                                                                         |
| Sheet            | shadcn `sheet` (Base UI Dialog)                                         | Small screens only. On desktop the inspector is a resizable panel so the structure viewer stays visible                                                                 |
| Split panes      | `react-resizable-panels` 4.14.2 (MIT, pushed 2026-10-02, 0 open issues) | v4 API is `Group` / `Panel` / `Separator` with `orientation`. Numbers are pixels, unit-less strings are percentages. Persist with `defaultLayout` + `onLayoutChanged`   |
| Tooltip, popover | Base UI through shadcn                                                  | Trigger `delay` default 600ms, `closeDelay` 0, provider `timeout` 400ms. Popups expose `--transform-origin`, `data-starting-style`, `data-ending-style`, `data-instant` |

Tooltip and popover rules:

- One `TooltipProvider` at the root with `delay={500} closeDelay={0} timeout={400}`: the first tooltip waits, neighbours within 400ms open at once.
- Base UI: "Tooltips alone are not accessible to touch or screen reader users". Every icon button also gets `aria-label`. Scientific values, source IDs and provenance never live only in a tooltip.
- Popovers scale from `--transform-origin`. Dialogs scale from centre.
- Residue hover readouts in tracks and heatmaps are immediate (no delay, no animation) and follow the pointer. They are data readouts, and a 500ms wait would break scanning.

### 3.8 Typography and `next/font`

Measured on the Fontsource 5.3.0 builds (which mirror the Google Fonts subsets) with fontTools, and by rendering a specimen (`0O Il1| P0DTC2 O00522 p.Leu858Arg c.2573T>G -> >= !=`).

| Font           | In `next/font/google` | Axes                      | Greek subset        | Digits tabular by default | `I` `l` `1` distinct                 | Zero vs `O`  | Ligature hazard                  | x-height / em |
| -------------- | --------------------- | ------------------------- | ------------------- | ------------------------- | ------------------------------------ | ------------ | -------------------------------- | ------------- |
| IBM Plex Sans  | yes                   | wght 100-700, wdth 75-100 | yes                 | yes                       | yes (serifed I, tailed l, flagged 1) | width only   | none seen                        | 0.516         |
| Inter          | yes                   | wght 100-900, opsz 14-32  | yes                 | no (`tnum` present)       | no (two bare strokes)                | width only   | `calt` turns `->` into an arrow  | 0.546         |
| Geist          | yes                   | wght 100-900              | no                  | no (`tnum` present)       | weak                                 | width only   | `liga` turns `->` into an arrow  | 0.530         |
| IBM Plex Mono  | yes                   | static 100-700            | no                  | yes                       | yes                                  | dotted zero  | none                             | 0.516         |
| JetBrains Mono | yes                   | wght 100-800              | yes                 | yes                       | yes                                  | marked zero  | `calt` rewrites `->`, `>=`, `!=` | 0.550         |
| Geist Mono     | yes                   | wght 100-900              | no                  | yes                       | yes                                  | slashed zero | none                             | 0.530         |
| Commit Mono    | no                    | static in Fontsource      | yes (in latin file) | yes                       | yes                                  | marked zero  | none by default                  | 0.540         |

Findings:

- The Google Fonts build of Inter contains only `calt ccmp dnom frac locl numr pnum tnum`. Stylistic sets, character variants and slashed zero are absent, so `IL2RG` and mouse `Il2rg` cannot be told apart through `next/font/google`.
- Geist and Geist Mono have no Greek subset (α, β, Δ fall back to a system font).
- Commit Mono needs `next/font/local` or `@fontsource/commit-mono`.
- Licences: IBM Plex OFL-1.1, Inter OFL-1.1, Geist OFL-1.1, JetBrains Mono OFL-1.1.

Decision: IBM Plex Sans + IBM Plex Mono. Set `font-variant-ligatures: none` globally so notation such as `c.2573T>G` or `->` is never rewritten. Plex Mono lacks Greek; Greek in running text is set in Plex Sans. Fallback mono if a variable weight axis or Greek is needed: JetBrains Mono with ligatures disabled.

`next/font` (Next 16.3.8 docs): fonts are downloaded at build time and self-hosted, "No requests are sent to Google by the browser". Use the `variable` option and map it in `@theme inline`. The build output contained Plex Sans faces with `font-weight: 100 700`, `font-stretch: 75% 100%` and a Greek `unicode-range`; total font payload 388 KB across subset files, loaded per `unicode-range`.

## 4. Dependency list

Versions are npm `latest` on 2026-10-03 unless noted. "Built" means present in the `web/` copy that passed `pnpm build` and type-check. `web/` already contains `next`, `react`, `tailwindcss`, `typescript`, `molstar` ^5.12.0 and `playwright` ^1.63.0.

| Package                               | Version                                                     | Licence    | Role                                     | Built      |
| ------------------------------------- | ----------------------------------------------------------- | ---------- | ---------------------------------------- | ---------- |
| `next` | 16.3.8 (already in `web/package.json`) | MIT | Framework, `next/font` | 16.3.8 |
| `react`, `react-dom` | 19.2.8 (already in `web/`; npm latest 19.3.0) | MIT | | 19.2.8 |
| `typescript` | 5.9.3, resolved from `^5` (npm latest 7.0.2) | Apache-2.0 | | 5.9.3 |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.3                                                       | MIT        | Styling                                  | yes        |
| `shadcn`                              | 4.21.1                                                      | MIT        | CLI and the `shadcn/tailwind.css` import | yes        |
| `@base-ui/react`                      | 1.8.0                                                       | MIT        | Primitives                               | yes        |
| `cn`                                  | 0.4.0                                                       | MIT        | Class merging                            | yes        |
| `class-variance-authority`            | 0.7.1                                                       | Apache-2.0 | Variants                                 | yes        |
| `tw-animate-css`                      | 1.4.0                                                       | MIT        | Enter/exit keyframes                     | yes        |
| `next-themes`                         | 0.4.6                                                       | MIT        | Light/dark switch without flash          | yes        |
| `lucide-react`                        | 1.51.0                                                      | ISC        | Icons                                    | yes        |
| `cmdk`                                | 1.1.1                                                       | MIT        | Command palette                          | yes        |
| `sonner`                              | 2.0.8                                                       | MIT        | Toasts                                   | yes        |
| `react-resizable-panels` | 4.14.2 (pnpm resolved 4.14.1 in the `web/` copy) | MIT | Split panes | 4.14.1 |
| `@tanstack/react-table`               | 9.2.4                                                       | MIT        | Table logic                              | yes        |
| `@tanstack/react-virtual`             | 3.14.13                                                     | MIT        | Virtualisation                           | yes        |
| `motion`                              | 14.0.0                                                      | MIT        | JS animation where CSS cannot do it      | yes        |
| `prettier-plugin-tailwindcss` (dev)   | 0.8.1                                                       | MIT        | Class order                              | scaffolded |

Optional, add when first needed: `nuqs` 2.10.1 (URL state), `@tanstack/react-hotkeys` 0.12.1 or `react-hotkeys-hook` 5.3.3 (shortcuts), `d3-scale-chromatic` 3.1.0 (ISC, PAE `Greens`), `@axe-core/playwright` 4.13.0 (MPL-2.0, accessibility tests), `react-aria-components` 1.21.1 (Apache-2.0).

Do not install: `vaul` (unmaintained), `tailwindcss-animate` (last published 2023-08; the scaffold uses `tw-animate-css`), `clsx` + `tailwind-merge` (replaced by `cn` in new output), `framer-motion` directly (it arrives through `motion`), `@base-ui-components/react` (old name), `radix-ui` directly, `geist`, any libraries.dev effect package, `gsap`, `three` or `lenis` for chrome.

## 5. Setup commands

Run and verified in a scratch copy of `web/` (Next 16.3.8, React 19.2.8, Tailwind 4.3.3, pnpm 12.8.1), in this order:

```bash
cd web
pnpm dlx shadcn@latest init -b base -p mira -y
# edit components.json: "iconLibrary": "hugeicons" -> "lucide"
pnpm remove @hugeicons/react @hugeicons/core-free-icons
pnpm add lucide-react@1.51.0 next-themes@0.4.6 @tanstack/react-table@9.2.4 @tanstack/react-virtual@3.14.13 motion@14.0.0
pnpm dlx shadcn@latest add button command sonner tooltip popover dialog sheet tabs resizable table scroll-area \
  dropdown-menu context-menu combobox select input input-group field checkbox switch toggle-group \
  badge separator skeleton kbd collapsible hover-card breadcrumb sidebar spinner empty -y
# write src/components/theme-provider.tsx and src/app/layout.tsx (section 6), src/app/globals.css (section 7.6)
pnpm build
```

What the CLI does in the existing app: `init` writes `components.json` (`"style": "base-mira"`, css `src/app/globals.css`) and `src/lib/utils.ts`, rewrites `globals.css` and adds an Inter import to `layout.tsx`. It adds no `next-themes`, no theme provider and no component. `add` installs `cmdk`, `sonner` and `react-resizable-panels` itself and writes 34 files to `src/components/ui` plus `src/hooks/use-mobile.ts`. Inspect before writing with `pnpm dlx shadcn@latest add <name> --dry-run` or `--view`.

For a brand-new app the equivalent is `npx shadcn@latest init -t next -b base -p mira -n <name> --no-monorepo -y`, which also generates a theme provider and `button`.

Component map for the core journey:

| Helix surface                                               | Build from                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| App frame: navigation, workspace, inspector | `resizable` three-pane workspace with a slim icon rail. Use `sidebar` only for the collapsible rail; the brief rules out the stock sidebar-plus-cards layout |
| Global search across disease, gene, variant, structure          | `command` in a `dialog`, opened with Cmd/Ctrl+K                                              |
| Variant, structure, pocket and intervention lists               | Rewritten `table` + TanStack Table + TanStack Virtual                                        |
| Filters                                                         | `combobox`, `toggle-group`, `checkbox`, removable `badge` chips                              |
| Inspector sections                                              | `tabs`, `collapsible`, `scroll-area`                                                         |
| Source IDs and provenance                                       | Custom `EvidenceBadge` on `badge`; details in `hover-card` with the ID as copyable mono text |
| Colour-mode switch (pLDDT, AlphaMissense, reference vs variant) | `toggle-group`, state in the URL                                                             |
| Legends and residue readouts                                    | Custom; swatch + label + value, no library                                                   |
| Prediction jobs                                                 | `sonner` `toast.promise`, `spinner`, `skeleton`, `empty`                                     |
| Row and viewer actions                                          | `dropdown-menu`, `context-menu`, `tooltip` + `kbd`                                           |

## 6. Root layout

`src/app/layout.tsx`, compiled as shown. Add the project's `metadata` export.

```tsx
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

const fontSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext", "greek"],
  axes: ["wdth"],
  variable: "--font-plex-sans",
  display: "swap",
})

const fontMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
})

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable} antialiased`}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider delay={500} closeDelay={0} timeout={400}>
            <div className="isolate min-h-dvh">{children}</div>
          </TooltipProvider>
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
```

`src/components/theme-provider.tsx`, compiled as shown. The existing app has none.

```tsx
"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
```

The `shadcn init -t next` template generates its own theme provider, which also binds the bare `d` key to toggle the theme. Leave that handler out: Helix needs single-key shortcuts for the viewer.

## 7. Visual direction and tokens

Direction: paper and ink. One white working surface divided by 1px rules, no cards floating on grey, no shadows on in-flow content. Dense rows, calm type. Hue appears only where it encodes a scientific fact or a destructive consequence. Light and dark are two designed palettes with the same roles.

### 7.1 Neutral colour scale (hue 250, chroma ≤ 0.008)

| Role (utility)                                                                          | Light OKLCH       | Light hex | Dark OKLCH        | Dark hex  |
| --------------------------------------------------------------------------------------- | ----------------- | --------- | ----------------- | --------- |
| Working surface (`bg-background`, `bg-card`)                                            | `1 0 0`           | `#ffffff` | `0.18 0.004 250`  | `#101213` |
| Frame, sidebar, gutters (`bg-sunken`, `bg-sidebar`)                                     | `0.98 0.002 250`  | `#f7f8fa` | `0.145 0.004 250` | `#090a0c` |
| Table header, inset, zebra (`bg-muted`)                                                 | `0.97 0.003 250`  | `#f4f5f7` | `0.21 0.005 250`  | `#17181b` |
| Hover (`bg-accent`)                                                                     | `0.95 0.004 250`  | `#eceff1` | `0.245 0.006 250` | `#1e2123` |
| Selected, pressed (`bg-active`)                                                         | `0.925 0.005 250` | `#e4e6e9` | `0.285 0.007 250` | `#282a2d` |
| Popover, menu (`bg-popover`)                                                            | `1 0 0`           | `#ffffff` | `0.225 0.005 250` | `#1a1c1e` |
| Row divider (`border-border-subtle`)                                                    | `0.93 0.004 250`  | `#e6e8ea` | `0.25 0.005 250`  | `#202224` |
| Panel edge (`border-border`)                                                            | `0.885 0.005 250` | `#d7d9dc` | `0.3 0.006 250`   | `#2c2e31` |
| Input edge, swatch ring (`border-border-strong`, `border-input`)                        | `0.64 0.008 250`  | `#898d91` | `0.52 0.008 250`  | `#66696d` |
| Primary text, primary button, focus ring (`text-foreground`, `bg-primary`, `ring-ring`) | `0.205 0.006 250` | `#15171a` | `0.95 0.003 250`  | `#edeff0` |
| Secondary text (`text-muted-foreground`)                                                | `0.445 0.008 250` | `#515458` | `0.74 0.006 250`  | `#a8abae` |
| Tertiary text, placeholders (`text-subtle-foreground`)                                  | `0.53 0.008 250`  | `#686c70` | `0.64 0.006 250`  | `#898c90` |
| Disabled text (`text-disabled-foreground`)                                              | `0.7 0.006 250`   | `#9c9fa2` | `0.45 0.006 250`  | `#535659` |
| Destructive (`text-destructive`)                                                        | `0.53 0.2 27`     | `#c51e21` | `0.7 0.17 25`     | `#f66d67` |
| Warning (`text-warning`)                                                                | `0.55 0.11 70`    | `#9a6418` | `0.78 0.14 80`    | `#e6ac3d` |

Measured contrast (WCAG 2):

| Pair                                                | Light                         | Dark                          |
| --------------------------------------------------- | ----------------------------- | ----------------------------- |
| Primary text on surface / muted / hover / selected  | 17.96 / 16.46 / 15.55 / 14.36 | 16.28 / 15.39 / 14.04 / 12.48 |
| Secondary text on surface / hover / selected        | 7.61 / 6.59 / 6.09            | 8.14 / 7.02 / 6.24            |
| Tertiary text on surface / muted / hover / selected | 5.29 / 4.85 / 4.58 / 4.23     | 5.56 / 5.26 / 4.79 / 4.26     |
| Input edge on surface (needs 3:1)                   | 3.34                          | 3.40                          |
| Focus ring at 50% alpha on surface (needs 3:1)      | 3.41                          | 4.74                          |
| Destructive / warning text on surface               | 5.86 / 4.99                   | 6.53 / 9.24                   |

Rule from the table: tertiary text switches to secondary on selected rows (4.23 and 4.26 are under 4.5).

### 7.2 Type scale

Sans for everything; mono for sequences, HGVS, accessions, coordinates and numeric columns. Weights 400, 500, 600 only.

| Utility     | Size / line height | Use                                                                      |
| ----------- | ------------------ | ------------------------------------------------------------------------ |
| `text-2xs`  | 11 / 16 px         | Column headers, badges, axis ticks, legends. Weight 500, tracking 0.02em |
| `text-xs`   | 12 / 16 px         | Table cells, controls (Mira), metadata, mono identifiers                 |
| `text-sm`   | 13 / 20 px         | Body default, panel content, form labels                                 |
| `text-base` | 14 / 20 px         | Long-form explanatory text, hypothesis narrative                         |
| `text-lg`   | 16 / 24 px         | Panel titles (500)                                                       |
| `text-xl`   | 18 / 24 px         | Page section titles (600)                                                |
| `text-2xl`  | 22 / 28 px         | Entity title: gene symbol, disease name (600)                            |
| `text-3xl`  | 28 / 32 px         | Rare single headline number                                              |

Rules: `font-variant-numeric: tabular-nums` on every table cell and readout (set globally on `td`, `th`, `.tabular`). Numeric columns right-aligned in mono. No uppercase except `text-2xs` column headers. Use the Plex Sans width axis (`font-stretch-semi-condensed`, 87.5%) for crowded column headers before reducing size. Minimum size 11px.

### 7.3 Spacing and density

4px grid (Tailwind default `--spacing: 0.25rem`).

| Element                   | Value                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Control height            | 28px default (`h-7`), 24px small, 32px large; 20px only inside table cells, with the hit area padded to 24px |
| Table row                 | 28px (`h-7`), `px-2`, `text-xs`; comfortable mode 32px                                                       |
| Table header              | 28px, `text-2xs`, weight 500, `bg-muted`, sticky                                                             |
| Panel header and toolbars | 36px (`h-9`), `px-3`                                                                                         |
| Panel padding             | 12px (`p-3`); 8px inside popovers                                                                            |
| Gaps                      | 4px icon to label, 8px between controls, 16px between groups, 24px between sections                          |
| Sidebar                   | 240px, collapsed 44px                                                                                        |
| Inspector panel           | minimum 320px, default 40%                                                                                   |
| Icons                     | 14px in 28px controls, 16px elsewhere, stroke 1.5                                                            |

### 7.4 Radii, borders, elevation

| Token                      | Value | Use                                                       |
| -------------------------- | ----- | --------------------------------------------------------- |
| `rounded-xs`               | 2px   | Badges, chips, legend swatches. Heatmap cells stay square |
| `rounded-md`, `rounded-lg` | 4px   | Buttons, inputs, selects, tabs                            |
| `rounded-xl`               | 6px   | Popovers, menus, tooltips                                 |
| `rounded-2xl`              | 8px   | Dialogs                                                   |

- Child radius never exceeds parent radius.
- Every separation is a 1px line: `border-border-subtle` between rows and inside panels, `border-border` between panels, `border-border-strong` on inputs and around any colour swatch whose contrast with the surface is under 3:1.
- Elevation exists on two layers only: `shadow-popover` and `shadow-dialog`. In dark mode elevation is a lighter surface plus a 1px light ring; the shadow is secondary.
- Selected row: `bg-active` plus a 2px ink bar on the inline-start edge. No coloured selection.
- Focus: visible ring on `:focus-visible` only, never removed.

### 7.5 Motion

| Token                | Value                             | Use                                                                                           |
| -------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `--dur-instant`      | 0ms                               | Anything keyboard-triggered, command palette, tab change by key, row selection, residue hover |
| `--dur-fast`         | 100ms                             | Hover background, pressed state (`scale(0.98)`)                                               |
| `--dur-base`         | 150ms                             | Tooltip in, every close, text swap                                                            |
| `--dur-moderate`     | 200ms                             | Popover, menu, select open; skeleton cross-fade                                               |
| `--dur-slow`         | 250ms                             | Dialog and sheet open, tab indicator, panel collapse. Ceiling                                 |
| `ease-out-strong`    | `cubic-bezier(0.23, 1, 0.32, 1)`  | Enter and exit                                                                                |
| `ease-in-out-strong` | `cubic-bezier(0.77, 0, 0.175, 1)` | Elements moving while on screen                                                               |
| `ease-drawer`        | `cubic-bezier(0.32, 0.72, 0, 1)`  | Sheet and drawer                                                                              |

Rules: animate `transform` and `opacity` only, never `transition: all`. Enter scale starts at 0.96 to 0.98, never 0. Closes use `--dur-base`. No `ease-in`. No bounce. Spinners and skeletons appear after a 200ms delay and stay at least 300ms. `prefers-reduced-motion` collapses all durations (in the CSS below). Usage: `transition-[opacity,transform] duration-(--dur-moderate) ease-out-strong`.

### 7.6 `src/app/globals.css`

Compiled with Tailwind 4.3.3 in the `web/` copy and in the template probe. Token utilities were spot-checked in the emitted CSS (`bg-plddt-very-high`, `bg-am-pathogenic`, `bg-variant`, `text-2xs`, `text-subtle-foreground`, `border-ev-generated`, `shadow-popover`, `rounded-xs`, `ease-out-strong`, `duration-(--dur-base)`), and the emitted hex fallbacks match the tables above.

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, "SF Mono", Menlo, monospace;
  --font-heading: var(--font-sans);

  /* shadcn contract: registry components read these names */
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive); --color-border: var(--border);
  --color-input: var(--input); --color-ring: var(--ring);
  --color-sidebar: var(--sidebar); --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary); --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent); --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border); --color-sidebar-ring: var(--sidebar-ring);

  /* Helix neutral extensions */
  --color-sunken: var(--surface-sunken); --color-active: var(--surface-active);
  --color-subtle-foreground: var(--fg-subtle); --color-disabled-foreground: var(--fg-disabled);
  --color-border-subtle: var(--border-subtle); --color-border-strong: var(--border-strong);
  --color-warning: var(--warning);

  /* scientific meaning: the only saturated colour in the product */
  --color-plddt-very-high: var(--sci-plddt-very-high); --color-plddt-high: var(--sci-plddt-high);
  --color-plddt-low: var(--sci-plddt-low); --color-plddt-very-low: var(--sci-plddt-very-low);
  --color-plddt-none: var(--sci-plddt-none);
  --color-am-benign: var(--sci-am-benign); --color-am-ambiguous: var(--sci-am-ambiguous);
  --color-am-pathogenic: var(--sci-am-pathogenic);
  --color-reference: var(--sci-reference); --color-variant: var(--sci-variant);
  --color-ev-experimental: var(--ev-experimental); --color-ev-predicted: var(--ev-predicted);
  --color-ev-generated: var(--ev-generated);

  --text-2xs: 0.6875rem; --text-2xs--line-height: 1rem;
  --text-xs: 0.75rem; --text-xs--line-height: 1rem;
  --text-sm: 0.8125rem; --text-sm--line-height: 1.25rem;
  --text-base: 0.875rem; --text-base--line-height: 1.25rem;
  --text-lg: 1rem; --text-lg--line-height: 1.5rem;
  --text-xl: 1.125rem; --text-xl--line-height: 1.5rem;
  --text-2xl: 1.375rem; --text-2xl--line-height: 1.75rem;
  --text-3xl: 1.75rem; --text-3xl--line-height: 2rem;

  --radius-xs: 2px; --radius-sm: 3px; --radius-md: 4px; --radius-lg: 4px;
  --radius-xl: 6px; --radius-2xl: 8px; --radius-3xl: 10px; --radius-4xl: 12px;

  --shadow-popover: var(--elevation-popover);
  --shadow-dialog: var(--elevation-dialog);

  --ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out-strong: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}

:root {
  --radius: 0.25rem;

  --background: oklch(1 0 0);
  --surface-sunken: oklch(0.98 0.002 250);
  --muted: oklch(0.97 0.003 250);
  --accent: oklch(0.95 0.004 250);
  --surface-active: oklch(0.925 0.005 250);
  --card: oklch(1 0 0);
  --popover: oklch(1 0 0);

  --foreground: oklch(0.205 0.006 250);
  --card-foreground: var(--foreground);
  --popover-foreground: var(--foreground);
  --muted-foreground: oklch(0.445 0.008 250);
  --accent-foreground: var(--foreground);
  --fg-subtle: oklch(0.53 0.008 250);
  --fg-disabled: oklch(0.7 0.006 250);

  --primary: oklch(0.205 0.006 250);
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.97 0.003 250);
  --secondary-foreground: var(--foreground);

  --border-subtle: oklch(0.93 0.004 250);
  --border: oklch(0.885 0.005 250);
  --border-strong: oklch(0.64 0.008 250);
  --input: oklch(0.64 0.008 250);
  --ring: oklch(0.205 0.006 250);

  --destructive: oklch(0.53 0.2 27);
  --warning: oklch(0.55 0.11 70);

  --sidebar: oklch(0.98 0.002 250);
  --sidebar-foreground: var(--foreground);
  --sidebar-primary: var(--primary);
  --sidebar-primary-foreground: var(--primary-foreground);
  --sidebar-accent: oklch(0.95 0.004 250);
  --sidebar-accent-foreground: var(--foreground);
  --sidebar-border: oklch(0.885 0.005 250);
  --sidebar-ring: var(--ring);

  --elevation-popover: 0 0 0 1px oklch(0 0 0 / 0.08), 0 4px 12px -2px oklch(0 0 0 / 0.1), 0 2px 4px -2px oklch(0 0 0 / 0.06);
  --elevation-dialog: 0 0 0 1px oklch(0 0 0 / 0.08), 0 16px 40px -8px oklch(0 0 0 / 0.18), 0 4px 12px -4px oklch(0 0 0 / 0.08);

  --dur-instant: 0ms;
  --dur-fast: 100ms;
  --dur-base: 150ms;
  --dur-moderate: 200ms;
  --dur-slow: 250ms;

  /* canonical, identical in light and dark: do not theme */
  --sci-plddt-very-high: #0053d6;
  --sci-plddt-high: #65cbf3;
  --sci-plddt-low: #ffdb13;
  --sci-plddt-very-low: #ff7d45;
  --sci-plddt-none: #aaaaaa;
  --sci-am-benign: #2166ac;
  --sci-am-ambiguous: #a8a9ac;
  --sci-am-pathogenic: #b2182b;

  /* Helix-defined: stepped per mode */
  --sci-reference: oklch(0.74 0.008 250);
  --sci-variant: oklch(0.46 0.19 345);
  --ev-experimental: oklch(0.5 0.12 155);
  --ev-predicted: var(--muted-foreground);
  --ev-generated: oklch(0.52 0.2 295);
}

.dark {
  --background: oklch(0.18 0.004 250);
  --surface-sunken: oklch(0.145 0.004 250);
  --muted: oklch(0.21 0.005 250);
  --accent: oklch(0.245 0.006 250);
  --surface-active: oklch(0.285 0.007 250);
  --card: oklch(0.18 0.004 250);
  --popover: oklch(0.225 0.005 250);

  --foreground: oklch(0.95 0.003 250);
  --muted-foreground: oklch(0.74 0.006 250);
  --fg-subtle: oklch(0.64 0.006 250);
  --fg-disabled: oklch(0.45 0.006 250);

  --primary: oklch(0.95 0.003 250);
  --primary-foreground: oklch(0.18 0.004 250);
  --secondary: oklch(0.21 0.005 250);

  --border-subtle: oklch(0.25 0.005 250);
  --border: oklch(0.3 0.006 250);
  --border-strong: oklch(0.52 0.008 250);
  --input: oklch(0.52 0.008 250);
  --ring: oklch(0.95 0.003 250);

  --destructive: oklch(0.7 0.17 25);
  --warning: oklch(0.78 0.14 80);

  --sidebar: oklch(0.145 0.004 250);
  --sidebar-accent: oklch(0.245 0.006 250);
  --sidebar-border: oklch(0.3 0.006 250);

  --elevation-popover: 0 0 0 1px oklch(1 0 0 / 0.1), 0 8px 24px -4px oklch(0 0 0 / 0.6);
  --elevation-dialog: 0 0 0 1px oklch(1 0 0 / 0.1), 0 24px 56px -12px oklch(0 0 0 / 0.7);

  --sci-reference: oklch(0.5 0.008 250);
  --sci-variant: oklch(0.66 0.22 345);
  --ev-experimental: oklch(0.72 0.15 155);
  --ev-generated: oklch(0.7 0.15 295);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  html { @apply font-sans; color-scheme: light; }
  html.dark { color-scheme: dark; }
  body { @apply bg-background text-foreground text-sm; font-variant-ligatures: none; position: relative; }
  td, th, .tabular { font-variant-numeric: tabular-nums; }
}

@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 8. Scientific colour scales

### 8.1 pLDDT (canonical)

Hex values and labels are from the AlphaFold DB production bundle (`alphafold.ebi.ac.uk`, fetched 2026-10-03) and match Mol*'s pLDDT theme (`src/extensions/model-archive/quality-assessment/color/plddt.ts`). Band edges follow `docs/research/structure-models.md`.

| Band      | Range           | Hex       | Utility              | Contrast on `#ffffff` | On dark `#101213` | Label text on the fill |
| --------- | --------------- | --------- | -------------------- | --------------------- | ----------------- | ---------------------- |
| Very high | pLDDT > 90      | `#0053D6` | `bg-plddt-very-high` | 6.55                  | 2.87              | white (6.55)           |
| High      | 70 < pLDDT ≤ 90 | `#65CBF3` | `bg-plddt-high`      | 1.84                  | 10.19             | ink `#15171a` (9.74)   |
| Low       | 50 < pLDDT ≤ 70 | `#FFDB13` | `bg-plddt-low`       | 1.36                  | 13.77             | ink (13.16)            |
| Very low  | pLDDT ≤ 50      | `#FF7D45` | `bg-plddt-very-low`  | 2.54                  | 7.40              | ink (7.07)             |
| No score  | n/a             | `#AAAAAA` | `bg-plddt-none`      |                       |                   | ink                    |

- Colour-blind separation is good: worst pair low vs very low, ΔE 16.9 (deutan), 23.1 normal vision.
- Three bands are under 3:1 on white and very high is under 3:1 on dark. Every swatch gets a 1px `border-border-strong` ring, every legend entry a text label, and the numeric value is always available on hover and in the table view.
- Text never takes a band colour. The value is written in ink beside a swatch.
- Boundary caveat: the AlphaFold DB sequence track maps a three-value domain `[50, 70, 90]` to four colours, which is the shape of a d3 threshold scale (a value of exactly 70 would be "High"); the Mol\* theme tests `score <= 50`, `<= 70`, `<= 90` (exactly 70 is "Low"). Use one function for both the track and the viewer.

### 8.2 AlphaMissense pathogenicity (canonical)

From the same AlphaFold DB bundle. Class thresholds are documented in `docs/research/variant-effect.md` (`likely_benign` < 0.34, `likely_pathogenic` > 0.564, `ambiguous` otherwise).

| Class             | AlphaFold DB label | Hex       | Utility            | Contrast on white / dark | Text on fill |
| ----------------- | ------------------ | --------- | ------------------ | ------------------------ | ------------ |
| likely_benign     | Likely benign      | `#2166AC` | `bg-am-benign`     | 5.90 / 3.19              | white (5.90) |
| ambiguous         | Uncertain          | `#A8A9AC` | `bg-am-ambiguous`  | 2.35 / 7.99              | ink (7.64)   |
| likely_pathogenic | Likely pathogenic  | `#B2182B` | `bg-am-pathogenic` | 6.87 / 2.74              | white (6.87) |

Continuous heatmap ramp (score to colour, linear interpolation between stops):

| Score | 0         | 0.1132    | 0.2264    | 0.3395    | 0.4527    | 0.5895    | 0.7264    | 0.8632    | 1         |
| ----- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| Hex   | `#2166ac` | `#4290bf` | `#8cbcd4` | `#c3d6e0` | `#e2e2e2` | `#edcdba` | `#e99e7c` | `#d15e4b` | `#b2182b` |

- Class separation: every pair ≥ 21.1 ΔE under protan and deutan.
- The mid stops are close to white (`#e2e2e2` is 1.30:1). Heatmap cells need a 1px surface-coloured gap and a frame so extent is visible; "no data" is a hatch, never a light fill.
- White text only on the two poles; ink on every other stop.
- The same ramp is kept in dark mode for recognisability against AlphaFold DB. The plot sits in a framed plate.
- AlphaMissense is a prediction. Every use carries the label "AlphaMissense (predicted)" and never shares a visual form with curated assertions.

### 8.3 Predicted aligned error (canonical)

AlphaFold DB renders PAE with `ColorScale.continuous("Greens", [0, 32], [1, 0])`: the ColorBrewer/d3 Greens scheme, reversed, over 0 to 32 Å. With d3's `interpolateGreens` endpoints that puts 0 Å at `#00441b` and 32 Å at `#f7fcf5`. Dark green is 1.65:1 on the dark surface, so the matrix keeps a frame and a labelled colour bar in both modes.

### 8.4 Reference vs variant (Helix-defined)

| Role                  | Light                             | Dark                             | Utility                      |
| --------------------- | --------------------------------- | -------------------------------- | ---------------------------- |
| Reference (wild type) | `oklch(0.74 0.008 250)` `#a7abb0` | `oklch(0.5 0.008 250)` `#606468` | `bg-reference`               |
| Variant               | `oklch(0.46 0.19 345)` `#9a0a70`  | `oklch(0.66 0.22 345)` `#e849b0` | `bg-variant`, `text-variant` |

Measured:

- Variant vs reference: ΔE 33.8 normal, 36.6 protan, 27.4 deutan (light); 27.1 / 11.6 / 16.7 (dark). The pair is separated mainly by lightness, so it survives colour-vision deficiency and greyscale print.
- Variant text on surface: 7.92:1 light, 5.38:1 dark.
- Variant against pLDDT bands: worst 17.6 (light), 10.6 (dark). Safe as a marker on a pLDDT-coloured structure.
- Variant against AlphaMissense: light worst 10.3 under simulation, 12.5 normal vision against the pathogenic red; dark fails against benign blue under protan (4.8) and is marginal against uncertain grey under deutan (7.8).
- Light reference grey is indistinguishable from AlphaMissense "Uncertain" grey (ΔE 0.6).

Rules that follow:

- One colour mode at a time in the viewer and tracks: `plddt`, `alphamissense` or `reference-variant`. Never two.
- The variant site always has a second channel: ball-and-stick representation, a 2px outline, and a text label (`p.Arg123Cys`). In tracks it is a marker glyph above the row.
- In `reference-variant` mode the reference chain is also drawn thinner or translucent.
- Mol\* renderer parameter defaults (`src/mol-gl/renderer.ts`) clash with these tokens: `highlightColor` is RGB (1.0, 0.4, 0.6) = `#FF6699`, `selectColor` is (0.2, 1.0, 0.1) = `#33FF19`, both at strength 0.3, and `backgroundColor` is `0x000000`. The default hover pink sits ΔE 8.9 (normal vision, floor 15) from the dark-mode variant magenta, so a hovered residue reads as a variant. Set the canvas background to the surface token and make hover and selection neutral (ink in light, near-white in dark).

### 8.5 Evidence classes (Helix-defined)

Structure provenance is always shown. Form carries the class; hue is an accent.

| Class                                         | Badge form                        | Text                           | Light                           | Dark                             | Utility                |
| --------------------------------------------- | --------------------------------- | ------------------------------ | ------------------------------- | -------------------------------- | ---------------------- |
| Experimental structure (PDB)                  | Solid 1px border, filled dot      | `EXP` + method and resolution  | `oklch(0.5 0.12 155)` `#0b7643` | `oklch(0.72 0.15 155)` `#43c07a` | `text-ev-experimental` |
| Existing prediction (AlphaFold DB and others) | Solid 1px border, hollow dot      | `PRED` + source and version    | secondary ink                   | secondary ink                    | `text-ev-predicted`    |
| Helix-generated prediction                | Dashed 1px border, hatched dot    | `GEN` + model, version, run ID | `oklch(0.52 0.2 295)` `#7544cd` | `oklch(0.7 0.15 295)` `#a689f1`  | `text-ev-generated`    |
| Hypothesis text (LLM-written)                 | Dotted inline-start rule, no fill | `HYPOTHESIS`                   | secondary ink                   | secondary ink                    | none                   |

Measured: badge text contrast on the working surface, in the order experimental / predicted / generated, is 5.70 / 7.61 / 6.06 (light) and 8.10 / 8.14 / 6.68 (dark). On the light table-header surface `#f4f5f7` experimental is 5.22 and generated 5.56. Experimental vs generated ΔE is 22.4 under deutan simulation (light) and 19.2 (dark). Generated violet collapses against pLDDT very-high blue for protan viewers (ΔE 1.6, light) and experimental green against AlphaMissense red for deutan viewers (4.2, light).

Rules: these two hues appear only on chrome badges and never as fills in the viewer, tracks or plots. The badge text and border style are mandatory. In 3D, an Helix-generated model is marked by a persistent "GEN" tag in the viewer corner and the panel title.

Proposal for curated clinical significance (ClinVar): reuse the AlphaMissense stops so red means pathogenic and blue means benign everywhere: P `#b2182b`, LP `#d15e4b`, VUS `#a8a9ac`, LB `#4290bf`, B `#2166ac`. Adjacent classes differ by only 12.6 to 14.9 ΔE in normal vision, so the abbreviation is always printed in the chip. Curated chips are filled rectangles with text; predicted scores are a gradient bar with a number. This scheme is an Helix convention with no external standard behind it.

### 8.6 Chain, pocket and selection colours (constraints only)

`docs/PRODUCT_BRIEF.md` also names protein chains, selected residues and binding sites as colour-bearing. They are outside this topic. These constraints keep them compatible with the scales above:

- Chain colouring is a fourth exclusive colour mode. A three-colour set that passes all-pairs separation: light `#2a78d6`, `#eb6834`, `#1baf7a`; dark `#3987e5`, `#d95926`, `#199e70`. Worst protan/deutan ΔE 9.2 (light) and 9.4 (dark). The aqua is 2.82:1 on white, so chains always carry letter labels. Past three chains, label them and fall back to neutral greys.
- The categorical list inside the AlphaFold DB bundle begins with ColorBrewer Dark2 (`#1b9e77`, `#d95f02`, `#7570b3`, `#e7298a`). Its first four fail all-pairs separation (pink vs green ΔE 1.7 under deutan). Do not adopt it.
- Selection and hover stay neutral (section 8.4). Pockets and binding sites are an outline or mesh in ink plus a label, with no new hue.

### 8.7 Why redundancy is mandatory

pLDDT occupies blue, cyan, yellow and orange; AlphaMissense occupies blue, grey and red. Together they cover the hue range that survives red-green colour-vision deficiency. A grid search over OKLCH (lightness 0.40 to 0.60, chroma 0.08 to 0.23, every 10° of hue) for one additional colour scored against the four pLDDT bands, the three AlphaMissense classes and the experimental green found nothing above ΔE 12.6 under protan/deutan simulation, and that best candidate is a dark plum separated by lightness. No added colour can be trusted alone.

## 9. Interaction rules to adopt

From the [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) and Emil Kowalski's standards:

- Every flow works from the keyboard; `:focus-visible` rings are always present.
- Hit targets at least 24px, even when the visual is smaller.
- Loading indicators: show after 150 to 300ms, keep at least 300 to 500ms; skeletons match the final layout exactly.
- State that defines a view (selected gene, variant, colour mode, panel layout, filters, sort) lives in the URL.
- "Don't rely on color alone; include text labels."
- Virtualise long lists; reserve scrollbar gutter; no layout shift when data arrives.
- Destructive actions (cancel a running prediction, delete a hypothesis) need confirmation or undo.
- `color-scheme` is set on `html` per theme so native controls and scrollbars match.
- Current design-engineering consensus on X: shadcn (2026-01-22) on design engineering, "it's mostly deciding what not to animate"; Emil Kowalski (2026-09-23) replaced a spring with ease-out and matched overlay and dialog durations in Linear's dialog.

## 10. Unverified or open

- designeer.xyz content: bot wall (HTTP 429 "Vercel Security Checkpoint"); description comes from a search index only.
- ObsidianUI: an X trending item (refreshed 2026-09-22) reports the RareUI author alleging that obsidianui.dev rebrands RareUI components. Not checked.
- Bencho: operator, licence and whether block source can be reused are not stated on the fetched pages.
- Arc UI component and block counts are inconsistent across its site, README and registry.
- X posts were read through search summaries; x.com pages were not fetched, view counts are unconfirmed, and post dates were derived from the post IDs. Astryx's "13,000+ apps" is Meta's own figure.
- `react` 19.3.0 and `typescript` 7.0.2 were not build-tested. The builds ran React 19.2.8 and TypeScript 5.9.3, the versions `web/` resolves today.
- `motion` 14.0.0 is one day old. It compiled and pre-rendered; nothing was exercised in a browser.
- No browser or visual QA was done on the tokens: values are computed, builds pass, nobody has looked at a rendered screen. APCA was not computed. No testing with colour-blind users.
- AlphaFold DB colours were read from a minified production bundle and can change without notice. Re-check before release. The threshold-scale reading of its pLDDT track and the Greens endpoints for PAE are inferred from that minified code.
- Font measurements used Fontsource 5.3.0 files on the assumption that they equal what `next/font/google` downloads. Inter's full feature set in the upstream rsms distribution was not checked. Commit Mono's licence is reported as OFL-1.1 by Fontsource and MIT by the GitHub repository metadata.
- The Mol* marker colour change (section 8.4) and the ClinVar chip scheme (section 8.5) are proposals and untested.
- Whether transitions.dev's licence is compatible with copying its snippets into Helix's repository needs the project owner's decision. This document recommends re-implementing the values.
- Sonner against Base UI Toast, and cmdk against Base UI Autocomplete, were compared on maintenance data only.

## 11. Sources

- shadcn/ui: [changelog](https://ui.shadcn.com/docs/changelog), [Base UI default](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-07-base-ui-default.mdx), [React Aria base](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-07-react-aria.mdx), [CLI v4](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-03-cli-v4.mdx), [cn](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-09-cn.mdx), [Next.js install](https://ui.shadcn.com/docs/installation/next), [@shadcn announcement](https://x.com/shadcn/status/2073021571342520343)
- Base UI: [releases](https://base-ui.com/react/overview/releases), [quick start](https://base-ui.com/react/overview/quick-start), [tooltip](https://base-ui.com/react/components/tooltip), [autocomplete](https://base-ui.com/react/components/autocomplete)
- TanStack Table v9: [overview](https://tanstack.com/table/latest/docs/overview), [quick start](https://github.com/TanStack/table/blob/main/docs/framework/react/quick-start.md)
- Next.js 16.3.8: [font module](https://nextjs.org/docs/app/api-reference/components/font), [view transitions](https://nextjs.org/docs/app/guides/view-transitions); React [`ViewTransition`](https://react.dev/reference/react/ViewTransition)
- Motion [changelog](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md); Tailwind CSS [v4.3.0 release](https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.3.0)
- [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels), [cmdk](https://github.com/dip/cmdk), [sonner](https://github.com/emilkowalski/sonner), [vaul](https://github.com/emilkowalski/vaul), [AG Grid licence](https://github.com/ag-grid/ag-grid/blob/latest/LICENSE.txt)
- Emil Kowalski [skills](https://github.com/emilkowalski/skills); posts [ease-out](https://x.com/emilkowalski_/status/1970144111261868487), [Linear dialog](https://x.com/emilkowalski/status/2102798004281635184); shadcn on [restraint](https://x.com/shadcn/status/2014318190306750695)
- [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines)
- Listed sites and repos: [uiarc.dev](https://uiarc.dev), [arc-library](https://github.com/kuratlielia/arc-library), [libraries.dev](https://libraries.dev), [Libraries.dev repo](https://github.com/Jakubantalik/Libraries.dev), [transitions.dev](https://transitions.dev), [transitions.dev repo and LICENSE](https://github.com/Jakubantalik/transitions.dev), [astryx.atmeta.com](https://astryx.atmeta.com), [facebook/astryx](https://github.com/facebook/astryx), [beui.dev](https://beui.dev), [ui-components](https://github.com/starc007/ui-components), [bencho.dev/finds](https://bencho.dev/finds), [obsidianui.dev](https://obsidianui.dev), [ObsidianUI repo](https://github.com/Atharvsinh-codez/ObsidianUI), [designeer.xyz](https://designeer.xyz), [inspora.design](https://inspora.design), [reelfolio.io](https://reelfolio.io)
- Astryx on X: [launch](https://x.com/Astryxdesign/status/2069888353139626315), [vjeux](https://x.com/Vjeux/status/2069891089826566377); transitions.dev on X: [skill](https://x.com/Jakubantalik/status/2090473433175921148)
- Scientific colours: AlphaFold DB entry page bundle at [alphafold.ebi.ac.uk](https://alphafold.ebi.ac.uk/entry/P00520), Mol* [`plddt.ts`](https://github.com/molstar/molstar/blob/master/src/extensions/model-archive/quality-assessment/color/plddt.ts) and [`renderer.ts`](https://github.com/molstar/molstar/blob/master/src/mol-gl/renderer.ts), [AlphaMissense repository](https://github.com/google-deepmind/alphamissense)
- Foundation comparisons (secondary, vendor-written): [Untitled UI](https://www.untitledui.com/blog/base-ui-vs-react-aria), [PkgPulse](https://www.pkgpulse.com/guides/shadcn-ui-vs-base-ui-vs-radix-components-2026)
