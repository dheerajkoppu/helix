#!/usr/bin/env bash
# Build Helix_Code.zip, the source archive for the hackathon submission.
#
# The archive comes from `git archive HEAD`, so it holds the committed tree and
# nothing else: untracked and ignored paths (.venv, node_modules, .next,
# api/var, __pycache__, data/cache) can never reach the zip. Uncommitted
# working-tree edits are likewise absent — commit before building.
set -euo pipefail

# Resolve the root from where the script lives, so it runs from any directory.
script_directory="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(git -C "${script_directory}" rev-parse --show-toplevel)"
archive_name="Helix_Code.zip"
archive_path="${repository_root}/${archive_name}"

# Large committed artefacts that the code regenerates and nothing needs to run.
# Evidence stays: lab/experiments/results/, every markdown write-up, and each
# run's results/, report.md, record.jsonl and transcript.jsonl.
excluded_paths=(
  # 4 MB build product of `make seed`; a note replaces it in the zip.
  "data/seed/catalog.json"
  # Raw per-run retrieval dumps (~2.7 MB), the only thing in candidates/. Debug
  # intermediates re-created by the next run; the graded candidate set each one
  # produced is kept in the sibling results/T1.json.
  "lab/runs/*/candidates/lookup-*.json"
  # Untracked in this repository, so already absent from `git archive`. Listed
  # only to stay excluded should the HTTP cache ever be committed.
  "data/cache/*.gz"
)

staging_directory="$(mktemp -d)"
trap 'rm -rf "${staging_directory}"' EXIT

rm -f "${archive_path}"

git -C "${repository_root}" archive --format=tar HEAD | tar -x -C "${staging_directory}"

for pattern in "${excluded_paths[@]}"; do
  find "${staging_directory}" -path "${staging_directory}/${pattern}" -delete
done

# Drop directories the exclusions emptied, so the zip carries no bare entries.
find "${staging_directory}" -mindepth 1 -type d -empty -delete

# Point the reader at `make seed` where the omitted catalogue used to be.
mkdir -p "${staging_directory}/data/seed"
cat > "${staging_directory}/data/seed/README-catalog.md" <<'CATALOG_NOTE'
# data/seed/catalog.json is not in this archive

The seed catalogue is a 4 MB build product, left out to keep the archive small.
Rebuild it from its sources before running the API:

    make seed

Add `SEED_ARGS="--refresh all"` to refetch the upstream datasets rather than
reuse whatever is cached locally.
CATALOG_NOTE

( cd "${staging_directory}" && zip --quiet --recurse-paths -9 "${archive_path}" . )

archive_megabytes="$(du -k "${archive_path}" | awk '{printf "%.2f", $1/1024}')"
archive_file_count="$(unzip -Z1 "${archive_path}" | grep -cv '/$')"

printf '%s\n' "${archive_name}: ${archive_megabytes} MB, ${archive_file_count} files"
printf '%s\n' "${archive_path}"
