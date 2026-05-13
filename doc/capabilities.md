# Unique Overleaf Capabilities

A bash+compiler harness gives the agent: `.tex` files, raw LaTeX log output, a PDF. The Overleaf platform gives the agent everything below — none of which requires new infrastructure.

## Tier 1 — No Equivalent Exists Outside Overleaf

### Auxiliary Files After Compile

After every compile, CLSI produces files that contain resolved structure:
- `.aux` — every `\label` → page and section number, fully resolved
- `.toc` — complete table of contents with actual page numbers
- `.bbl` — the formatted bibliography exactly as it appears in print
- `.lof` / `.lot` — every figure and table with caption and page number

A compiler tells you about errors after the fact. These files tell you the resolved document graph — label resolution, citation rendering, structure with pagination — without any additional parsing work.

### 1.6MB Package Mapping

`services/web/app/src/Features/Metadata/packageMapping.mjs` — A server-side mapping of essentially every LaTeX package to structured metadata. The agent answers "what package provides `\qty{}`?" or "which packages conflict with `fontenc`?" without any external lookup. Thousands of hours of curated knowledge already in the repo.

### Semantic Live Index

The editor continuously parses `.tex` source and maintains live indexes of every `\label`, `\ref`, `\cite`, `\input`, `\include`, and `\usepackage`. The agent can report undefined references, unused labels, and missing citations **without triggering a compile**.

Server-side extraction is handled by `MetaHandler.mjs` with regex patterns:
- `LABEL_RE` — all `\label{...}` definitions
- `PACKAGE_RE` / `REQ_PACKAGE_RE` — packages with option extraction
- `DOCUMENT_CLASS_RE` — document class and options

### Existing AI Quota Infrastructure

`AiFeatureUsageRateLimiter` already exists with free/premium/unlimited tiers, tied to Writefull and subscription status. The billing and gating infrastructure is already built. The agent hooks into it rather than building a new quota system.

## Tier 2 — Strong Differentiators

### Full Attributed Change History

`services/project-history/` — Every character-level operation ever applied is stored with `user_id`, `timestamp`, `pathname`, and the op itself. The agent can query: "what changed in this section in the last 3 days?" or "show me everything user X has edited." A git repo gives you commits. This gives character-level attribution across every collaborator with millisecond timestamps, with no commit discipline required.

### Tracked Changes as Context

Before editing, the agent reads existing pending tracked changes — who proposed what and when. It can avoid making a redundant edit that conflicts with a pending human change, or explicitly reason about whether to reinforce or contradict a pending proposal.

### Live Presence

`ConnectedUsersManager` in `services/real-time/` — Redis stores each collaborator's current cursor position and which file they are viewing, updated in real-time. The agent knows who is currently editing section 3 and can avoid writing into an actively-edited span, or prioritize the section with the most active focus.

### Structured Compile Errors

`services/web/frontend/js/ide/log-parser/` already converts raw TeX log output into structured objects with `level`, `file`, `line`, `message`, and `content`. On top of that, `HumanReadableLogsRules.tsx` contains 36KB of hand-written rules mapping error patterns to actionable hints. The agent inherits all of this without writing a single log parser.

### Linked Files — Inter-Project Graph

`services/web/app/src/Features/LinkedFiles/` — Files can be linked between Overleaf projects, to external URLs, or to compiled output from other projects. The agent can traverse this graph. A thesis with chapters as linked sub-projects, a paper that imports figures from a shared figures project — the agent sees and reasons about the full dependency tree, not just a single project.

### Mendeley / Zotero / Papers Integration

Users already have their reference libraries connected. The agent can suggest citations by querying their actual library, not a generic lookup.

### Comment Threads with Resolution Tracking

`services/chat/` — Comment threads are stored with full history and `resolved_by_user_id`. The agent reads the discussion around a section before editing — understanding not just what the text says but what conversation happened around it. It can post its own responses into threads, making the agent a participant in review discussions.

### Git Bridge Snapshot API

`services/git-bridge/` — Exposes project snapshots tied to git commits — version history at commit granularity, with human-authored commit messages. Gives the agent historical context beyond Overleaf's OT op history.

## Tier 3 — Useful Context Signals

- **Project tags** — user-defined categorization (`conference-paper`, `thesis`, `draft`). The agent knows the intent and formality level before reading a word.
- **Project compile settings** — compiler choice (pdflatex/xelatex/lualatex), TeX Live version, root doc. The agent won't suggest `fontspec` to a pdfLaTeX user.
- **User editor settings** — spell check language, autocomplete preferences, keybindings. The agent knows if the user writes in British English.
- **Word count by semantic category** — not total words but `textWords`, `headWords`, `abstractWords`, `captionWords`, `footnoteWords` separately. The agent can say "your abstract is 380 words; most target journals cap at 250."
- **SyncTeX** — bidirectional source↔PDF mapping. After compile, the agent can anchor its suggestions to specific PDF pages and coordinates.
- **Split test / feature flag infrastructure** — rollout of new agent features without code deploys, already wired to analytics and Slack notifications.
