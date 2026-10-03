# Contributing to OrphaFold

OrphaFold is research software for rare-disease work. A contribution is useful when it makes a
statement more traceable, a prediction more honestly labelled, or a source or model available that
was not. This file covers setup, the checks to run and the rules every change keeps.

## Setup

```bash
make setup    # creates api/.venv, installs the API and the web dependencies
make dev      # API on http://localhost:8000, web on http://localhost:3000
```

Needs Python 3.14, Node.js 20.9 or later and pnpm. Details and configuration are in
[`docs/getting-started.md`](docs/getting-started.md).

## Before opening a pull request

```bash
make types    # after adding or changing a route or schema
make check    # strict API import, generated types current, tsc, eslint
make lint     # ruff check and format check over api/
```

`GET /api/v1/health` must report an empty `load_errors`. For interface changes, look at the page in
both themes and at a narrow width.

## What to contribute

| Contribution         | Where                                                 | Guide                                                                                                    |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A data source        | one new file in `api/orphafold/sources/`              | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) section 8, [`docs/data-sources.md`](docs/data-sources.md) |
| A model provider     | one new file in `api/orphafold/providers/`            | [`docs/adding-a-model.md`](docs/adding-a-model.md)                                                       |
| A job kind           | one new file in `api/orphafold/jobs/handlers/`        | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) section 8                                                 |
| A route              | new files in `api/orphafold/services/` and `routers/` | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) section 8                                                 |
| An interface change  | `web/src/`                                            | [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)                                                         |
| A glossary term      | `web/src/lib/glossary.ts`                             | Hand-written, short, literal                                                                             |
| A mapping correction | `api/scripts/seed/`, then `make seed`                 | [`data/seed/README.md`](data/seed/README.md)                                                             |

Source adapters, providers, handlers, routers and tables are plugins: add a file, do not edit
shared code. `data/seed/catalog.json`, `data/seed/SOURCES.json`, `data/seed/build_report.json`,
`ATTRIBUTION.md`, `api/openapi.json` and `web/src/lib/api/schema.ts` are generated; never edit them
by hand.

## Rules every change keeps

**Provenance**

- Every value shown to a user is traceable to a source record. A language model is never the source
  of a biological fact.
- A missing value is `null` in the API and Unknown or No source found in the interface. Never a
  guess, a default or a placeholder.
- One failing source never fails a page. Aggregated responses carry a status row per source.
- No cross-source composite scores. Each source keeps its own measure of strength.

**Predictions**

- Experimental, existing predicted and OrphaFold-generated structures are never presented as
  equivalent. Every structure carries its origin.
- A provider never returns output the model did not produce.
- Predictions are worded as predictions. No clinical recommendations, and none of these words about
  a result: cure, best candidate, potent, safe, effective, treatment recommendation.
- Limitations are stated as the model's or the source's own documentation states them. Do not
  invent citations or limitation statements.

**Licensing**

- Record the licence of a new source on its adapter and add its required citation. A source
  restricted to non-commercial use is declared `noncommercial_only = True`.
- Do not add OMIM content, clinical free text from the IUIS tables, or data whose licence forbids
  redistribution to the seeded dataset.
- New Python dependencies go in `api/pyproject.toml`, new web dependencies through `pnpm add` in
  `web/`. Check that the licence is compatible with Apache-2.0.

**Identifiers**

- Gene: HGNC symbol. Protein: UniProt accession. Residue numbering: UniProt canonical everywhere.
- Variant: `GENE-p.Ref3PosAlt3` (`BTK-p.Arg28His`), or a ClinVar VCV for anything that is not a
  protein substitution.
- Structure: `pdb:<ID>`, `afdb:<entryId>`, `of:<job_id>`. Compound: InChIKey.

**Code**

- Python is formatted and linted with `ruff` (line length 110). TypeScript passes `tsc` and
  `eslint`.
- Full variable names, few comments, no commented-out code.
- The web app uses the shared components and colour tokens in `web/src/components` and
  `web/src/app/globals.css`. No raw hex colours and no second visual language.

## Reporting a scientific problem

A wrong disease mapping, a mislabelled evidence class, a variant on the wrong residue or a missing
limitation is a bug with priority. Include the page or API URL, the identifiers involved, what is
shown and what the source record says. A link to the source record settles most reports.

## Security and personal data

OrphaFold is not built to hold patient data. Do not put patient identifiers, clinical notes or
unpublished patient variants into an issue, a project or a test fixture.

## Licence of contributions

By contributing you agree that your contribution is licensed under the Apache License, Version 2.0,
as described in section 5 of [`LICENSE`](LICENSE).
