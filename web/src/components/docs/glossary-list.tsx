import {
  GLOSSARY,
  GLOSSARY_VERSION,
  type GlossaryCategory,
  type GlossaryEntry,
} from "@/lib/glossary";

const CATEGORY_ORDER: { id: GlossaryCategory; title: string }[] = [
  { id: "genetics", title: "Genetics" },
  { id: "protein", title: "Protein" },
  { id: "structure", title: "Structure" },
  { id: "confidence", title: "Confidence" },
  { id: "interaction", title: "Interaction" },
  { id: "evidence", title: "Evidence" },
];

export const GLOSSARY_HEADINGS = CATEGORY_ORDER.map((category) => ({
  id: category.id,
  text: category.title,
}));

/** Every Learn Mode term, grouped by category, straight from the hand-written glossary. */
export function GlossaryList() {
  const entries = Object.entries(GLOSSARY) as [string, GlossaryEntry][];
  return (
    <div className="min-w-0">
      <p className="mb-5 max-w-[76ch] text-base leading-6 text-foreground">
        These are the definitions Learn Mode shows beside a term in the
        workspace. They are written by hand and are never generated at run time.
        Version <span className="font-mono text-sm">{GLOSSARY_VERSION}</span>,{" "}
        <span className="font-mono text-sm">{entries.length}</span> terms.
      </p>
      {CATEGORY_ORDER.map((category) => {
        const terms = entries.filter(
          ([, entry]) => entry.category === category.id,
        );
        if (terms.length === 0) return null;
        return (
          <section key={category.id} className="mb-7">
            <h2
              id={category.id}
              className="mb-1 flex scroll-mt-20 items-baseline gap-2 border-t border-border-subtle pt-5 text-lg font-semibold text-foreground"
            >
              {category.title}
              <span className="tabular font-mono text-xs font-normal text-subtle-foreground">
                {terms.length}
              </span>
            </h2>
            <dl>
              {terms.map(([id, entry]) => (
                <div
                  key={id}
                  id={id}
                  className="grid scroll-mt-20 gap-x-6 gap-y-1 border-b border-border-subtle py-2.5 last:border-b-0 sm:grid-cols-[13rem_minmax(0,1fr)]"
                >
                  <dt className="text-base font-medium text-foreground">
                    {entry.term}
                  </dt>
                  <dd className="max-w-[68ch] text-base leading-6 text-foreground">
                    {entry.definition}
                    {entry.detail ? (
                      <span className="mt-1 block text-muted-foreground">
                        {entry.detail}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
