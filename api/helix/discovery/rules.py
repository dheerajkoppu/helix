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


def direction_check(
    rule: ActionRule,
    *,
    action_type: str | None,
    relation: Relation,
    target_label: str,
    subject_label: str,
    activity_label: str,
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

    return DirectionCheck(
        required=rule.actions,
        required_direction=need,
        molecule_action=action_type,
        molecule_effect=effect,
        target_relation_effect=relation.effect,
        verdict=verdict,
        why=why,
    )


def _article(text: str) -> str:
    return f"an {text}" if text[:1] in "aeiou" else f"a {text}"
