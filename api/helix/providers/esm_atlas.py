"""ESM Atlas provider: real remote ESMFold v1 inference through the public fold API.

One protein chain of at most 400 residues, pLDDT only. Structures it returns carry origin
predicted_internal: the inference was triggered by this deployment.
"""

import asyncio
import json
import random
import time
from typing import Any

import gemmi
import httpx

from helix.ids import utcnow
from helix.providers.base import (
    Availability,
    Capability,
    ChainInput,
    ConfidenceSample,
    ExecutionMode,
    ModelCode,
    ModelIdentity,
    ProviderError,
    ProviderFile,
    RunContext,
    StructurePredictor,
    StructureRequest,
    StructureResult,
    register_provider,
)
from helix.schemas.common import (
    Citation,
    ConfidenceSummary,
    PlddtFractions,
    ResidueRange,
    SourceState,
    StructureCoverage,
    StructureDescriptor,
    StructureOrigin,
)
from helix.schemas.jobs import ArtifactRole, StageSpec
from helix.sources.base import get_http_client
from helix.sources.esm_atlas import MAX_RESIDUES, esm_atlas

AVAILABILITY_TTL_SECONDS = 300.0
FAILED_AVAILABILITY_TTL_SECONDS = 120.0
PROBE_TIMEOUT_SECONDS = 20.0
PROBE_LENGTH = 16
# The gateway can time out while the model is still working; a later request is then answered
RETRY_PAUSES_SECONDS = (20.0, 40.0)

STANDARD_RESIDUES = frozenset("ACDEFGHIKLMNPQRSTVWY")

STAGE_RUN = "run_model"
STAGE_READ = "read_model"

MODEL_FILE = "model_0.cif"
RAW_FILE = "model_0.esm_atlas.pdb"
PLDDT_FILE = "model_0.plddt.json"

LENGTH_LIMIT = (
    "Accepts one protein chain of at most 400 residues. Longer proteins are predicted as a residue "
    "window, which removes every contact with the rest of the chain."
)
MONOMER_ONLY = "Complexes, ligands, nucleic acids and modified residues are not supported."
SINGLE_SEQUENCE = "Single-sequence language-model prediction; generally less accurate than MSA-based models."
PLDDT_ONLY = "Returns one model with pLDDT only. PAE and pTM are not provided by this model."
NO_SLA = (
    "Public service with no key, no documented rate limit and no service-level agreement. It can "
    "become unavailable without notice."
)
DETERMINISTIC = (
    "ESMFold is deterministic: there is no seed and one model per sequence, so run-to-run variation "
    "is not estimated."
)
MUTATION_CAVEAT = (
    "Structure predictors are not validated for single-residue substitutions. A variant model that "
    "matches the reference carries no information about whether the variant is tolerated."
)
LOW_CONFIDENCE = (
    "Low pLDDT means either disorder or insufficient information for a confident prediction, never "
    "misfolding caused by a variant."
)


def validate_sequence(sequence: str) -> None:
    """Reject before calling the service what it would reject or what would be ambiguous."""
    if not sequence:
        raise ProviderError("invalid_input", "The sequence is empty.")
    unknown = sorted(set(sequence) - STANDARD_RESIDUES)
    if unknown:
        raise ProviderError(
            "invalid_input",
            "ESM Atlas predictions in Helix accept the 20 standard amino acids only; found "
            + ", ".join(unknown)
            + ".",
            {"residues": unknown},
        )
    if len(sequence) > MAX_RESIDUES:
        raise ProviderError(
            "sequence_exceeds_400_residues",
            f"The sequence has {len(sequence)} residues; the ESM Atlas fold API accepts at most "
            f"{MAX_RESIDUES}. Choose a residue window.",
            {"length": len(sequence), "max_residues": MAX_RESIDUES},
        )


def plddt_fractions(scores: list[float]) -> PlddtFractions | None:
    """Share of residues per band, lower-inclusive cut-offs at 90, 70 and 50."""
    if not scores:
        return None
    total = len(scores)
    return PlddtFractions(
        very_low=sum(score < 50 for score in scores) / total,
        low=sum(50 <= score < 70 for score in scores) / total,
        confident=sum(70 <= score < 90 for score in scores) / total,
        very_high=sum(score >= 90 for score in scores) / total,
    )


def _read_response(pdb_text: str, sequence: str, residue_start: int, title: str) -> dict[str, Any]:
    """Parse the PDB answer, check it against the submitted sequence, read pLDDT from the C-alpha
    B-factors and write an mmCIF copy numbered from residue_start with pLDDT on the 0-100 scale."""
    structure = gemmi.read_pdb_string(pdb_text)
    if len(structure) != 1 or len(structure[0]) != 1:
        raise ValueError("expected one model with one chain")
    chain = structure[0][0]
    names = [residue.name for residue in chain]
    modelled = gemmi.one_letter_code(names).upper()
    if modelled != sequence:
        raise ValueError(
            f"the returned coordinates cover {len(names)} residues that do not match the submitted "
            f"sequence of {len(sequence)}"
        )
    raw_scores: list[float] = []
    for residue in chain:
        atom = residue.find_atom("CA", "*")
        if atom is None:
            raise ValueError(f"residue {residue.seqid.num} has no C-alpha atom")
        raw_scores.append(atom.b_iso)

    # The PDB endpoint reports pLDDT on 0-1; anything above 1 means the service changed scale
    native_scale = "0-1" if max(raw_scores) <= 1.0 else "0-100"
    factor = 100.0 if native_scale == "0-1" else 1.0
    for index, residue in enumerate(chain):
        residue.seqid = gemmi.SeqId(residue_start + index, " ")
        residue.label_seq = index + 1
        for atom in residue:
            atom.b_iso = atom.b_iso * factor
    structure.name = "esmfold_v1_prediction"
    structure.setup_entities()
    document = structure.make_mmcif_document()
    block = document.sole_block()
    # The date in the PDB header is the service's own constant, not the date of this prediction
    block.find_mmcif_category("_pdbx_database_status.").erase()
    block.set_pair("_struct.entry_id", "esmfold_v1_prediction")
    block.set_pair("_struct.title", gemmi.cif.quote(title))

    header_lines = pdb_text.splitlines()
    return {
        "cif": document.as_string(),
        "plddt": [round(score * factor, 2) for score in raw_scores],
        "raw_min": min(raw_scores),
        "raw_max": max(raw_scores),
        "native_scale": native_scale,
        "atoms": sum(len(residue) for residue in chain),
        "title_line": next((line.strip() for line in header_lines if line.startswith("TITLE")), None),
        "remarks": [line.rstrip() for line in header_lines if line.startswith("REMARK")],
    }


def _license_text(remarks: list[str]) -> str | None:
    """The licence statement of the response header, verbatim."""
    lines: list[str] = []
    collecting = False
    for remark in remarks:
        text = remark[10:].strip() if len(remark) > 10 else ""
        if "LICENSE AND DISCLAIMERS" in text:
            collecting = True
            continue
        if collecting and text:
            lines.append(text)
    return " ".join(lines) or None


@register_provider
class EsmAtlasProvider(StructurePredictor):
    id = "esm_atlas"
    name = "ESM Atlas (ESMFold v1)"
    model_name = "ESMFold v1"
    model_version = "esmfold_v1"
    license = "CC-BY-4.0"
    license_url = "https://creativecommons.org/licenses/by/4.0/"
    commercial_use = True
    capabilities = (Capability.MONOMER, Capability.PLDDT)
    execution_mode = ExecutionMode.REMOTE_API
    structure_origin = StructureOrigin.PREDICTED_INTERNAL
    max_residues = MAX_RESIDUES
    limitations = (
        LENGTH_LIMIT,
        MONOMER_ONLY,
        SINGLE_SEQUENCE,
        PLDDT_ONLY,
        DETERMINISTIC,
        MUTATION_CAVEAT,
        LOW_CONFIDENCE,
        NO_SLA,
    )
    citation = (
        Citation(
            text="Lin Z et al., Science (2023)",
            title="Evolutionary-scale prediction of atomic-level protein structure with a language model",
            year=2023,
            doi="10.1126/science.ade2574",
        ),
    )
    attribution = esm_atlas.attribution
    homepage = esm_atlas.homepage
    job_kinds = ("structure_prediction", "variant_comparison")
    deterministic = True

    def __init__(self) -> None:
        self._availability: Availability | None = None
        self._availability_checked = 0.0
        self._running = 0
        self._probe_task: asyncio.Task[Availability] | None = None

    def _remember(self, availability: Availability) -> Availability:
        self._availability = availability
        self._availability_checked = time.monotonic()
        return availability

    async def _probe(self) -> Availability:
        """Fold a new 16-residue sequence. The service answers a sequence it has seen before from
        its own cache, so only a new one shows that inference is running."""
        sequence = "".join(random.choice(sorted(STANDARD_RESIDUES)) for _ in range(PROBE_LENGTH))
        down = "Real inference is not available right now."
        try:
            response = await get_http_client().post(
                esm_atlas.fold_url,
                content=sequence,
                headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "*/*"},
                timeout=PROBE_TIMEOUT_SECONDS,
            )
        except httpx.TimeoutException:
            reason = (
                "The ESM Atlas fold API did not answer a probe prediction within "
                f"{PROBE_TIMEOUT_SECONDS:g} s."
            )
            return self._remember(Availability(available=False, reason=f"{reason} {down}"))
        except httpx.HTTPError as error:
            reason = f"The ESM Atlas fold API could not be reached ({type(error).__name__})."
            return self._remember(Availability(available=False, reason=reason))
        if response.status_code == 200 and "ATOM" in response.text:
            return self._remember(
                Availability(
                    available=True,
                    reason="The ESM Atlas fold API folded a new probe sequence. No key or GPU required; "
                    f"sequences of at most {MAX_RESIDUES} residues.",
                )
            )
        reason = (
            f"The ESM Atlas fold API answered HTTP {response.status_code} to a probe prediction of "
            f"{PROBE_LENGTH} residues."
        )
        return self._remember(Availability(available=False, reason=f"{reason} {down}"))

    def _start_probe(self) -> asyncio.Task[Availability]:
        if self._probe_task is None or self._probe_task.done():
            self._probe_task = asyncio.get_running_loop().create_task(self._probe())
        return self._probe_task

    async def check_availability(self) -> Availability:
        """Probe real inference, at most every five minutes while it works and every two minutes
        while it does not. Only the first check waits for the probe: later ones answer with the
        last known state and refresh it in the background, so a listing never waits for a remote
        prediction. The state is also updated by every real prediction."""
        known = self._availability
        if known is None:
            if self._running:
                return Availability(
                    available=True,
                    reason="A prediction is running on this deployment; the fold API is being called now.",
                )
            return await asyncio.shield(self._start_probe())
        ttl = AVAILABILITY_TTL_SECONDS if known.available else FAILED_AVAILABILITY_TTL_SECONDS
        if not self._running and time.monotonic() - self._availability_checked >= ttl:
            self._start_probe()
        return known

    def plan(self, request: StructureRequest) -> list[StageSpec]:
        return [
            StageSpec(id=STAGE_RUN, label="Running ESMFold v1 on the ESM Atlas fold API"),
            StageSpec(id=STAGE_READ, label="Reading coordinates and pLDDT"),
        ]

    async def predict(self, request: StructureRequest, context: RunContext) -> StructureResult:
        if len(request.chains) != 1 or request.ligands:
            raise ProviderError("unsupported_input", "ESM Atlas predicts one protein chain. " + MONOMER_ONLY)
        chain: ChainInput = request.chains[0]
        if chain.molecule_type != "protein":
            raise ProviderError("unsupported_input", MONOMER_ONLY)
        sequence = chain.sequence.strip().upper()
        validate_sequence(sequence)
        residue_end = chain.residue_start + len(sequence) - 1
        warnings: list[str] = []

        async with context.stage(STAGE_RUN):
            await context.check_cancelled()
            await context.log(
                f"POST {esm_atlas.fold_url}: {len(sequence)} residues "
                f"({chain.residue_start}-{residue_end}), no MSA, no seed."
            )
            self._running += 1
            started = time.perf_counter()
            try:
                for attempt, pause in enumerate((*RETRY_PAUSES_SECONDS, None), start=1):
                    answer = await esm_atlas.fold(sequence)
                    if answer.ok or answer.state is not SourceState.UNAVAILABLE or pause is None:
                        break
                    if answer.status_code is not None and answer.status_code < 500:
                        break
                    await context.log(
                        f"{answer.message or 'The fold API did not answer.'} Trying again in {pause:g} s "
                        f"(round {attempt + 1} of {len(RETRY_PAUSES_SECONDS) + 1}).",
                        level="warning",
                    )
                    await asyncio.sleep(pause)
                    await context.check_cancelled()
            finally:
                self._running -= 1
            elapsed = time.perf_counter() - started
            if not answer.ok or not answer.data:
                message = answer.message or "The ESM Atlas fold API returned no model."
                if answer.state is SourceState.UNAVAILABLE:
                    self._remember(Availability(available=False, reason=message))
                raise ProviderError("source_unavailable", message, {"status_code": answer.status_code})
            pdb_text = answer.data
            self._remember(
                Availability(
                    available=True,
                    reason="The ESM Atlas fold API returned a prediction. No key or GPU required; "
                    f"sequences of at most {MAX_RESIDUES} residues.",
                )
            )
            await context.log(f"The service returned a model in {elapsed:.1f} s.")

        accession = chain.uniprot_accession
        subject = (
            f"{accession} residues {chain.residue_start}-{residue_end}" if accession else "input sequence"
        )
        variants = ", ".join(chain.applied_variant_ids)
        title = f"ESMFold v1 prediction of {subject}" + (f" with {variants}" if variants else "")

        async with context.stage(STAGE_READ):
            try:
                parsed = await asyncio.to_thread(
                    _read_response, pdb_text, sequence, chain.residue_start, title
                )
            except Exception as error:
                raise ProviderError(
                    "invalid_model_file", f"The returned PDB file could not be used: {error}"
                ) from error
            if parsed["native_scale"] != "0-1":
                warnings.append("esm_atlas_plddt_scale_changed")
                await context.log(
                    "B-factors above 1.0: pLDDT was read as already on the 0-100 scale.", level="warning"
                )
            scores: list[float] = parsed["plddt"]
            mean = sum(scores) / len(scores)
            await context.log(
                f"{len(scores)} residues, {parsed['atoms']} atoms; mean pLDDT {mean:.1f} "
                f"(C-alpha B-factor x 100; native scale {parsed['native_scale']})."
            )

        generated_at = utcnow()
        native = {
            "title_line": parsed["title_line"],
            "plddt_b_factor_min": parsed["raw_min"],
            "plddt_b_factor_max": parsed["raw_max"],
            "plddt_native_scale": parsed["native_scale"],
        }
        confidence = ConfidenceSummary(
            plddt_mean=round(mean, 2),
            plddt_native_scale=parsed["native_scale"],
            plddt_fractions=plddt_fractions(scores),
            pae_available=False,
            provider_native=native,
        )
        protein_length = request.parameters.get("protein_length")
        descriptor = StructureDescriptor(
            id=f"of:{context.job_id or 'detached'}",
            origin=StructureOrigin.PREDICTED_INTERNAL,
            title=title,
            provider=self.id,
            provider_name=self.name,
            source_url=esm_atlas.fold_url,
            model_name=self.model_name,
            model_version=self.model_version,
            method=self.model_name,
            coverage=StructureCoverage(
                uniprot_accession=accession,
                ranges=[ResidueRange(start=chain.residue_start, end=residue_end, chain="A")],
                covered_residues=len(sequence),
                sequence_length=protein_length,
                fraction=round(len(sequence) / protein_length, 4) if protein_length else None,
            ),
            confidence=confidence,
            license=_license_text(parsed["remarks"]) or self.license,
            attribution=self.attribution,
            created_date=generated_at.date(),
            retrieved_at=generated_at,
            limitations=list(self.limitations),
            warnings=warnings,
            provenance=answer.provenance,
        )
        plddt_document = {
            "provider": self.id,
            "model": self.model_version,
            "numbering": "uniprot_canonical" if accession else "sequence_index",
            "residue_numbers": list(range(chain.residue_start, residue_end + 1)),
            "plddt": scores,
            "scale": "0-100",
            "native_scale": parsed["native_scale"],
            "source": "C-alpha B-factor of the returned PDB file",
        }
        return StructureResult(
            descriptor=descriptor,
            model=ModelIdentity(
                provider=self.id,
                name=self.model_name,
                version=self.model_version,
                license=self.license,
                execution_mode=self.execution_mode,
                code=ModelCode(repository="https://github.com/facebookresearch/esm"),
            ),
            files=[
                ProviderFile(
                    name=MODEL_FILE,
                    role=ArtifactRole.STRUCTURE,
                    media_type="chemical/x-mmcif",
                    content=parsed["cif"].encode("utf-8"),
                    structure_origin=StructureOrigin.PREDICTED_INTERNAL,
                    sample_index=0,
                ),
                ProviderFile(
                    name=RAW_FILE,
                    role=ArtifactRole.SOURCE_RESPONSE,
                    media_type="chemical/x-pdb",
                    content=pdb_text.encode("utf-8"),
                    source_url=esm_atlas.fold_url,
                ),
                ProviderFile(
                    name=PLDDT_FILE,
                    role=ArtifactRole.PLDDT,
                    media_type="application/json",
                    content=json.dumps(plddt_document).encode("utf-8"),
                ),
            ],
            sequences=[chain.model_copy(update={"sequence": sequence})],
            parameters={
                "endpoint": esm_atlas.fold_url,
                "msa": "none (single-sequence language model)",
                "seed": None,
                "deterministic": True,
                "samples": 1,
                "response_title": parsed["title_line"],
                "plddt_native_scale": parsed["native_scale"],
                "residue_start": chain.residue_start,
                "residue_end": residue_end,
            },
            confidence_samples=[
                ConfidenceSample(
                    sample_index=0,
                    structure_file=MODEL_FILE,
                    metrics={
                        "plddt_mean": round(mean, 2),
                        "plddt_min": min(scores),
                        "plddt_max": max(scores),
                        **native,
                    },
                )
            ],
            plddt_per_residue=scores,
            database_identifiers=[f"uniprot:{accession}"] if accession else [],
            provider_native={"remarks": parsed["remarks"], "response_sha256": _response_hash(answer)},
        )


def _response_hash(answer: Any) -> str | None:
    return answer.provenance.response_sha256 if answer.provenance else None
