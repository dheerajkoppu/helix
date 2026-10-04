# Helix — project summary

_150–300 word pitch for the jury. 268 words._

---

**Helix: an AI lab that works out what a drug could aim at in a rare disease.**

Five thousand rare diseases come down to a single broken gene, and fewer than one in twenty has a treatment. The biology is often already known. What stops people is the work: to find what might help one protein, a researcher has to check every molecule known to act on it, one database at a time, and decide for each whether it pushes the protein the right way or the wrong way.

Helix does that reasoning and shows its working. Search a disease, see the mutation on the 3D protein, and eight specialist agents — orchestrated by Omnigent — gather cited evidence from eleven public databases, propose competing explanations, weigh four possible tests against what each would teach, stop to ask a human before anything expensive, run the chosen test, and update the answer.

Then it asks what a drug could aim at. It works out whether the protein ended up too active or too weak, derives what a drug would therefore have to do, and searches five mechanism bridges for molecules that do it — refusing every molecule that would push the wrong way and showing you what it refused and why.

It works today on 511 immune-disease genes with real data. With the known link hidden, it recovered leniolisib, the approved drug for APDS. For X-linked agammaglobulinemia it refuses 34 molecules, including a cancer drug in use today, because that protein is already too weak.

We measured it across 604 diseases, and the measurement caught a genuine bug in our own safety filter. We fixed it and turned it into a permanent test.

Every claim carries its source. Nothing is a treatment. It is a place to start.
