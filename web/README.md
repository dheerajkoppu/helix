# Helix web

The Helix front end: Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui on Base UI (Mira preset), IBM Plex Sans and Mono.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

From the repository root, `make dev` runs the API and this app together and `make web` runs this app alone. Both start `next dev` through `scripts/dev.mjs`, which starts it again if it exits abnormally. Next.js allows one dev server and one build per project at a time: a second `next dev` in this directory reports the running server instead of starting.

The app calls the Helix API at `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`), under `/api/v1`. It runs without the API: pages show which data is not loaded and the status line reads "API not reachable". Both variables can be set in the repository `.env` (read by `next.config.ts`) or in `web/.env.local`, which wins.

| Variable                     | Default                 | Purpose                                                      |
| ---------------------------- | ----------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_API_URL`        | `http://localhost:8000` | Base URL of the Helix API                                |
| `NEXT_PUBLIC_REPOSITORY_URL` | unset                   | Source repository linked from the top bar and the About page |

## Check

```bash
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm build        # production build
pnpm types        # regenerate src/lib/api/schema.ts from ../api/openapi.json (make types also refreshes that file)
node scripts/screenshot.mjs http://localhost:3000/dev/kit out.png [--dark] [--mobile] [--wait=ms] [--click=selector]
```

## Where things are

| Path                                                                    | Holds                                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/app/globals.css`                                                   | Design tokens: neutral surfaces, scientific colour scales, evidence and structure-origin tokens |
| `src/app/(workspace)/`                                                  | Disease, gene, protein, variant and compare routes, inside the persistent workspace frame       |
| `src/components/shell/`                                                 | Top bar, status line, command palette, page primitives                                          |
| `src/components/workspace/`                                             | Stage rail, subject bar, zones, sequence axis dock slot                                         |
| `src/components/evidence/`, `science/`, `data/`, `states/`              | Shared components every page uses                                                               |
| `src/components/viewer/`, `sequence/`                                   | Reserved contracts for the 3D viewer and the sequence axis                                      |
| `src/components/ui/`                                                    | shadcn/ui primitives, owned by this repository                                                  |
| `src/lib/state/`                                                        | Selection store, hover channel, URL sync, preferences, subject chain                            |
| `src/lib/api/`                                                          | Typed fetch client, React Query conventions, generated schema                                   |
| `src/lib/science/`, `evidence.ts`, `structure-origin.ts`, `glossary.ts` | Canonical scales, enums and the Learn Mode glossary                                             |

Two development routes show the system in use: `/dev/kit` (every component and token in both themes) and `/dev/frame` (a complete workspace stage on live UniProt and AlphaFold DB data).

The rules for building pages are in [`docs/DESIGN_SYSTEM.md`](../docs/DESIGN_SYSTEM.md). Read `AGENTS.md` before using Next.js APIs: this version differs from older ones.
