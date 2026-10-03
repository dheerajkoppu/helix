/** Every keyboard binding in one place. The shortcut sheet and the palette print from this list. */
export interface ShortcutEntry {
  /** KeyHint syntax: "mod+k", "g p", "?" */
  keys: string;
  label: string;
}

export interface ShortcutGroup {
  title: string;
  /** where the keys are live */
  scope: string;
  entries: ShortcutEntry[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Global",
    scope: "Anywhere",
    entries: [
      { keys: "mod+k", label: "Search and commands" },
      { keys: "?", label: "This shortcut sheet" },
      { keys: "mod+j", label: "Ask Orpha" },
      { keys: "esc", label: "Close the top layer, then clear the selection" },
      { keys: "g j", label: "Jobs" },
      { keys: "g e", label: "Explore" },
    ],
  },
  {
    title: "Stages",
    scope: "Workspace",
    entries: [
      { keys: "g d", label: "Disease" },
      { keys: "g g", label: "Gene and variants" },
      { keys: "g p", label: "Protein" },
      { keys: "g c", label: "Compare" },
      { keys: "g m", label: "Mechanism" },
      { keys: "g i", label: "Intervention" },
      { keys: "[", label: "Previous stage" },
      { keys: "]", label: "Next stage" },
    ],
  },
  {
    title: "Zones",
    scope: "Workspace",
    entries: [
      { keys: "l", label: "Show or hide the Ledger" },
      { keys: "i", label: "Show or hide the Inspector" },
      { keys: "a", label: "Cycle the sequence axis height" },
    ],
  },
  {
    title: "Tables",
    scope: "Focused table",
    entries: [
      { keys: "j", label: "Next row (also Down)" },
      { keys: "k", label: "Previous row (also Up)" },
      { keys: "enter", label: "Select the row; again to open it" },
    ],
  },
  {
    title: "Sequence axis",
    scope: "Focused axis",
    entries: [
      { keys: "left", label: "Previous residue" },
      { keys: "right", label: "Next residue" },
    ],
  },
];
