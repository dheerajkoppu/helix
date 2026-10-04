"""The required-action rule and the direction-of-effect filter. Pure functions, no I/O.

THE REQUIRED-ACTION RULE TABLE

A pure function of (mechanism class, direction). Nothing else is read.

| mechanism class    | direction          | required actions                             |
| ------------------ | ------------------ | -------------------------------------------- |
| gain_of_function   | increased_activity | inhibit, antagonise, block_upstream          |
| neomorph           | increased_activity | inhibit, antagonise, block_upstream          |
| loss_of_function   | decreased_activity | restore, activate, stabilise, chaperone,     |
|                    |                    | replace, bypass, release_a_brake             |
| haploinsufficiency | decreased_activity | the same as loss_of_function                 |
| dominant_negative  | decreased_activity | remove_the_mutant_protein, restore,          |
|                    |                    | stabilise, bypass, release_a_brake           |
| unknown            | any                | (none)                                       |
| any                | unknown            | (none)                                       |

Why each row is what it is: too much activity can only be helped by reducing it; too little can only
be helped by bringing it back; a broken copy that blocks the working one is cleared or worked around;
and when no record states which way the activity moves, no action is derived and nothing is ruled out
on direction.

DIRECTION OF EFFECT

Three signs are multiplied, and every one of them has to come from a record:

1. required direction: less activity for a gain, more activity for a loss.
2. what the molecule does to the protein it acts on: the ChEMBL mechanism `action_type`
   (INHIBITOR lowers, AGONIST raises, MODULATOR is unknown).
3. how an effect on that protein carries over to the subject: the bridge supplies this. Acting on
   the subject's own protein carries over the same way. Acting on a protein that produces the
   subject's active form also carries over the same way. Acting on a brake - a protein that removes
   the subject's active form - carries over the opposite way, which is why inhibiting a brake
   upstream of a weakened protein RESTORES the pathway and is a match.

verdict = matches when the product equals the required direction, opposes when it is the reverse,
unknown when any of the three is unknown. "opposes" is ruled out. "unknown" is ranked below
"matches" and labelled. The word "inhibitor" alone never decides anything.

A CONTRADICTED action_type CANNOT CARRY A REJECTION

A rejection is the dangerous verdict: it removes a molecule from the list a reader sees. ChEMBL's
`action_type` is one curated field and it is sometimes wrong for this purpose, so a rejection is
not allowed to stand on it when another record of the same molecule against the same protein
contradicts it. Two signals are read, each from a different record than `action_type`:

- the measured assay types ChEMBL holds for the molecule against that protein. An IC50 or a percent
  inhibition is an inhibition measurement; an EC50 or a percent activation is an activation one; a
  Ki or a Kd measures binding only and says nothing about direction, so it is never a signal here.
- a second mechanism record for the same molecule on the same target whose `action_type` points the
  other way.

If either contradicts the direction read from `action_type`, the verdict is "unknown", the reason
names both records, and the molecule appears as a candidate carrying the 'may push the wrong way'
caveat rather than being hidden. When nothing contradicts the field, the filter rejects exactly as
it did before: this is not an exception list and not a relaxation, it is a requirement that the one
field not be contradicted by the measurements sitting beside it.

The "matches" side of the filter is untouched. A contradiction can only hold a rejection back; it
can never turn an unknown into a match.

This exists because the accuracy experiment caught the filter rejecting PLERIXAFOR for WHIM
syndrome. ChEMBL records its single mechanism on P61073 with action_type PARTIAL AGONIST, while
blocking CXCR4 is the molecule's entire pharmacology and ChEMBL's own four activities against that
protein are all IC50. One field said raise, four measurements said lower, and the filter believed
the field.
"""

from dataclasses import dataclass
from typing import Literal

from helix.schemas.discovery import (
    ActionRule,
    ActionRuleRow,
    Direction,
    DirectionCheck,
    MechanismClass,
    RequiredAction,
    Verdict,
)

NeedDirection = Literal["less_activity", "more_activity", "none"]
MoleculeEffect = Literal["lowers", "raises", "unknown"]
RelationEffect = Literal["same_way", "opposite_way", "unknown"]

LESS: list[RequiredAction] = ["inhibit", "antagonise", "block_upstream"]
MORE: list[RequiredAction] = [
    "restore",
    "activate",
    "stabilise",
    "chaperone",
    "replace",
    "bypass",
    "release_a_brake",
]
MORE_DOMINANT_NEGATIVE: list[RequiredAction] = [
    "remove_the_mutant_protein",
    "restore",
    "stabilise",
    "bypass",
    "release_a_brake",
]

ACTION_LABELS: dict[RequiredAction, str] = {
    "inhibit": "block the protein",
    "antagonise": "stop the protein being switched on",
    "block_upstream": "block something that switches the protein on",
    "restore": "bring the missing activity back",
    "activate": "switch the protein on",
    "stabilise": "help the protein hold its shape",
    "chaperone": "help the protein fold and reach the right place",
    "replace": "supply the activity from outside",
    "bypass": "use a parallel route to the same result",
    "release_a_brake": "block something that holds the pathway back",
    "remove_the_mutant_protein": "clear away the broken copy",
}

# The direction each mechanism class implies, as the catalog words it.
CLASS_DIRECTION: dict[MechanismClass, Direction] = {
    "gain_of_function": "increased_activity",
    "neomorph": "increased_activity",
    "loss_of_function": "decreased_activity",
    "haploinsufficiency": "decreased_activity",
    "dominant_negative": "decreased_activity",
    "unknown": "unknown",
}

_WHY: dict[MechanismClass, str] = {
    "gain_of_function": "The protein does too much, so a molecule can only help by reducing what it does.",
    "neomorph": "The protein does something it should not do, so a molecule can only help by removing "
    "that activity.",
    "loss_of_function": "The protein does too little, so a molecule can only help by bringing the "
    "activity back.",
    "haploinsufficiency": "One working copy makes too little protein, so a molecule can only help by "
    "bringing the activity back.",
    "dominant_negative": "The broken copy blocks the working copy, so a molecule can only help by "
    "clearing the broken copy or by working around it.",
    "unknown": "No record states which way this protein's activity moves, so no required action is "
    "derived and nothing is ruled out on direction.",
}

_RULE_TEXT: dict[MechanismClass, str] = {
    "gain_of_function": "gain_of_function + increased_activity -> reduce the activity",
    "neomorph": "neomorph + increased_activity -> remove the new activity",
    "loss_of_function": "loss_of_function + decreased_activity -> restore the activity",
    "haploinsufficiency": "haploinsufficiency + decreased_activity -> restore the activity",
    "dominant_negative": "dominant_negative + decreased_activity -> clear the broken copy or work around it",
    "unknown": "unknown mechanism or unknown direction -> no action",
}

_ACTIONS: dict[MechanismClass, list[RequiredAction]] = {
    "gain_of_function": LESS,
    "neomorph": LESS,
    "loss_of_function": MORE,
    "haploinsufficiency": MORE,
    "dominant_negative": MORE_DOMINANT_NEGATIVE,
    "unknown": [],
}

# ChEMBL action_type values, grouped by what they do to the protein they act on.
LOWERING_ACTIONS = frozenset(
    {
        "INHIBITOR",
        "ANTAGONIST",
        "NEGATIVE ALLOSTERIC MODULATOR",
        "NEGATIVE MODULATOR",
        "INVERSE AGONIST",
        "BLOCKER",
        "DOWN REGULATOR",
        "DEGRADER",
        "DISRUPTING AGENT",
        "ANTISENSE INHIBITOR",
        "RNAI INHIBITOR",
        "SEQUESTERING AGENT",
        "PROTEOLYTIC ENZYME",
        "CROSS-LINKING AGENT",
    }
)
RAISING_ACTIONS = frozenset(
    {
        "AGONIST",
        "PARTIAL AGONIST",
        "ACTIVATOR",
        "POSITIVE ALLOSTERIC MODULATOR",
        "POSITIVE MODULATOR",
        "UP REGULATOR",
        "OPENER",
        "STABILISER",
        "CHAPERONE",
    }
)


def molecule_effect(action_type: str | None) -> MoleculeEffect:
    """What a ChEMBL action_type does to the protein it acts on."""
    value = (action_type or "").strip().upper()
    if value in LOWERING_ACTIONS:
        return "lowers"
    if value in RAISING_ACTIONS:
        return "raises"
    return "unknown"


# Measured assay types that state a direction. A Ki or a Kd measures how tightly a molecule binds
# and is deliberately absent: binding alone does not say which way the protein moves.
LOWERING_ASSAYS = frozenset({"IC50", "INHIBITION", "XC50", "IC90", "IC95", "KI APP", "PIC50"})
RAISING_ASSAYS = frozenset({"EC50", "ACTIVATION", "AC50", "PEC50"})


def assay_effect(standard_types: dict[str, int] | None) -> tuple[MoleculeEffect, int, int]:
    """Direction implied by the assay types measured against a protein, with the two counts."""
    lowering = 0
    raising = 0
    for name, count in (standard_types or {}).items():
        key = str(name).strip().upper()
        if key in LOWERING_ASSAYS:
            lowering += int(count or 0)
        elif key in RAISING_ASSAYS:
            raising += int(count or 0)
    if lowering and not raising:
        return "lowers", lowering, raising
    if raising and not lowering:
        return "raises", lowering, raising
    return "unknown", lowering, raising


@dataclass(frozen=True, slots=True)
class DirectionEvidence:
    """Records of the same molecule against the same protein, other than the action_type itself.

    Every field is read from a different ChEMBL record than the `action_type` under test, which is
    what makes a contradiction meaningful rather than a restatement.
    """

    other_action_types: tuple[str, ...] = ()
    assay_standard_types: dict[str, int] | None = None


def required_action(mechanism_class: MechanismClass, direction: Direction) -> ActionRule:
    """The rule table, as a pure function. Unknown in means no action out."""
    resolved: MechanismClass = mechanism_class
    if direction == "unknown" or mechanism_class == "unknown":
        resolved = "unknown"
    elif CLASS_DIRECTION[mechanism_class] != direction:
        # The class and the direction contradict each other, so neither is trusted
        resolved = "unknown"
    actions = _ACTIONS[resolved]
    needed: NeedDirection = "none"
    if resolved != "unknown":
        needed = "less_activity" if CLASS_DIRECTION[resolved] == "increased_activity" else "more_activity"
    return ActionRule(
        actions=actions,
        action_labels=[ACTION_LABELS[action] for action in actions],
        rule=_RULE_TEXT[resolved],
        why=_WHY[resolved],
        direction_needed=needed,
    )


RULE_TABLE: list[ActionRuleRow] = [
    ActionRuleRow(
        mechanism_class=mechanism_class,
        direction=CLASS_DIRECTION[mechanism_class],
        actions=_ACTIONS[mechanism_class],
        why=_WHY[mechanism_class],
    )
    for mechanism_class in (
        "gain_of_function",
        "neomorph",
        "loss_of_function",
        "haploinsufficiency",
        "dominant_negative",
        "unknown",
    )
]


@dataclass(frozen=True, slots=True)
class Relation:
    """How acting on a bridge target carries over to the subject's own activity."""

    effect: RelationEffect
    phrase: str = ""


SAME_PROTEIN = Relation("same_way", "this is the protein the disease's gene encodes")
UPSTREAM_ACTIVATOR = Relation("same_way", "this protein helps produce the active form of the subject protein")
BRAKE = Relation("opposite_way", "this protein removes the active form of the subject protein")
UNKNOWN_RELATION = Relation(
    "unknown", "no record states which way this protein changes the subject's activity"
)
# A mechanism-matched disease shares the required ACTION, not a pathway. The action class is compared
# in the chain's own step; the subject's activity is never claimed to move, because nothing measures it.
SAME_ACTION_CLASS = Relation(
    "unknown",
    "the molecule acts on the other disease's protein and no record connects that protein to this one",
)


def action_class_matches(rule: ActionRule, action_type: str | None) -> bool:
    """Whether the molecule's action class is the class the subject's mechanism needs."""
    effect = molecule_effect(action_type)
    if effect == "unknown" or rule.direction_needed == "none":
        return False
    return (effect == "lowers") == (rule.direction_needed == "less_activity")


_NEED_PHRASE: dict[NeedDirection, str] = {
    "less_activity": "to do less",
    "more_activity": "to do more",
    "none": "no stated direction",
}


def _sign(need: NeedDirection) -> int:
    return -1 if need == "less_activity" else 1 if need == "more_activity" else 0


def _contradictions(effect: MoleculeEffect, evidence: DirectionEvidence | None) -> list[str]:
    """Signals from other records of this molecule on this protein that point the other way."""
    if evidence is None or effect == "unknown":
        return []
    opposite: MoleculeEffect = "raises" if effect == "lowers" else "lowers"
    rows: list[str] = []
    measured, lowering, raising = assay_effect(evidence.assay_standard_types)
    if measured == opposite:
        count = lowering if measured == "lowers" else raising
        kinds = ", ".join(
            sorted(
                name
                for name in (evidence.assay_standard_types or {})
                if str(name).strip().upper() in (LOWERING_ASSAYS | RAISING_ASSAYS)
            )
        )
        rows.append(
            f"ChEMBL holds {count} measured activit{'y' if count == 1 else 'ies'} of this molecule "
            f"against this protein ({kinds}), which {measured} it"
        )
    for other in evidence.other_action_types:
        if molecule_effect(other) == opposite:
            rows.append(
                f"a second ChEMBL mechanism record for this molecule on the same target reads "
                f"{other.lower()}, which {opposite} it"
            )
    return rows


def direction_check(
    rule: ActionRule,
    *,
    action_type: str | None,
    relation: Relation,
    target_label: str,
    subject_label: str,
    activity_label: str,
    evidence: DirectionEvidence | None = None,
) -> DirectionCheck:
    """Compare the required action with what the molecule's recorded action would do to the subject.

    `subject_label` names the disease or gene the direction is needed for; `activity_label` names the
    protein whose activity moves. The reason is assembled from fixed phrases, so the same facts always
    produce the same sentence.
    """
    effect = molecule_effect(action_type)
    need = rule.direction_needed
    action_text = (action_type or "molecule with no recorded action").lower()
    need_phrase = f"{subject_label} needs {activity_label} {_NEED_PHRASE[need]}."
    molecule_phrase = f"ChEMBL records this molecule as {_article(action_text)} of {target_label}"
    verdict: Verdict = "unknown"
    why: str
    corroboration: list[str] = []

    if need == "none":
        why = (
            f"No record states which way the activity of {activity_label} moves, so the required action is "
            "not known and this molecule is neither matched nor ruled out."
        )
    elif effect == "unknown":
        why = (
            f"{need_phrase} {molecule_phrase}, and that kind of action does not say whether it lowers or "
            "raises the protein, so the direction cannot be checked."
        )
    elif relation.effect == "unknown":
        why = (
            f"{need_phrase} {molecule_phrase}, which {effect} that protein, but {relation.phrase}, so the "
            "direction cannot be checked."
        )
    else:
        carried = effect
        if relation.effect == "opposite_way":
            carried = "raises" if effect == "lowers" else "lowers"
        result_sign = -1 if carried == "lowers" else 1
        verdict = "matches" if result_sign == _sign(need) else "opposes"
        closing = (
            "That is the direction this mechanism needs."
            if verdict == "matches"
            else "That is the opposite of what this mechanism needs, so it is ruled out."
        )
        why = (
            f"{need_phrase} {molecule_phrase}, which {effect} that protein. Because {relation.phrase}, that "
            f"{carried} what {activity_label} does. {closing}"
        )
        if verdict == "opposes":
            # A rejection is not allowed to rest on an action_type another record of the same
            # molecule against the same protein contradicts
            conflicts = _contradictions(effect, evidence)
            if conflicts:
                verdict = "unknown"
                why = (
                    f"{need_phrase} {molecule_phrase}, which would "
                    f"{'lower' if effect == 'lowers' else 'raise'} that protein, and on that "
                    f"field alone this molecule would be ruled out. But {' and '.join(conflicts)}. "
                    "Two records of the same molecule against the same protein disagree, so the "
                    "direction cannot be checked and this molecule is not ruled out."
                )
                corroboration = conflicts

    return DirectionCheck(
        required=rule.actions,
        required_direction=need,
        molecule_action=action_type,
        molecule_effect=effect,
        target_relation_effect=relation.effect,
        verdict=verdict,
        why=why,
        corroboration=corroboration,
        corroborated=None if verdict != "opposes" else True,
    )


def _article(text: str) -> str:
    return f"an {text}" if text[:1] in "aeiou" else f"a {text}"
