# GroupMindHub in Plain Language

GroupMindHub is a collaborative workspace where an entire community, not just project admins, keeps a living project document accurate and current. Think of it as the shared project brain: every section of the trunk document can receive proposals from contributors, and the community decides what sticks through open voting.

## How collaboration works
- **One active document per project.** Each project has a "Trunk" entry that stays readable like a normal report, with numbered sections and subsections.
- **Community-owned updates.** Anyone with access can propose edits, whether it is a new subsection, a rewrite, or a reordering. Proposals are written in the same structured outline the document uses, so it is clear where the changes will land.
- **Transparent voting.** Every proposal becomes a change card that the community can upvote or downvote. Each project sets its own simulated voter pool + threshold (defaults to 40 % of five voters), and once the "yes" tally hits that mark within the voting window the system merges automatically.

## Guardrails that keep things orderly
- **Candidate pool and waiting queue.** Each section can only host a handful of active proposals at once. The best candidates surface in the pool, while overflow sits in a FIFO queue until there is room. Downvotes in the queue help clear out proposals that are not resonating.
- **Keep-as-is option.** Alongside community proposals, each section can carry a "Keep current text" card so people can explicitly support the status quo when that is the best choice.
- **One-at-a-time rule.** Authors are limited to a single active proposal per section, encouraging focused discussions instead of floods of drafts.
- **Auto-merge history.** Once a change passes the vote, it lands in the merged history with before/after snapshots so everyone can see exactly what shifted.

## Why it matters
GroupMindHub gives teams a democratic, low-friction way to run living project specs or any collaborative document. Instead of emailing edits or relying on a single maintainer, everyone can suggest improvements, see where they stand in the queue, and trust the merge rules. The result is a shared plan that evolves transparently with the community steering the wheel.
