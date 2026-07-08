# DENIZEN — Branded Dossier System

**Canon spec.** How NPCs produce branded PDF dossiers (DENIZEN technical, 1921 partnership,
client capability briefs) and tailor each one correctly to its reader, recipient, and project.

Written to live in `apps/office/docs/` as canon and to be read by the agents that run the generation
chain. Same pattern as a SOUL.md: change this file, change the output — no code change.

Derived directly from two reference artifacts: the **DENIZEN Technical Dossier v1.6.0** and the
**1921 Strategic Partnership Dossier (RM Cyber)**. Where they differ, the difference is a *skin or
tailoring* knob, not a different document.

---

## 0. The one thing to internalize

These two dossiers are **the same document in two skins.** The skeleton is fixed; what changes is
(a) which sections are included, (b) how the body is organized, (c) the recipient-specific framing,
and (d) the visual skin. An NPC that learns the skeleton + the tailoring procedure can produce any
of them. An NPC that "just writes a nice PDF" will drift and, worse, fabricate.

Two moves separate a good dossier from a generic one — they are the whole point:

1. **Recipient framing.** The 1921 doc does not describe 1921. It describes 1921 *through the lens
   of what RM Cyber cares about.* The DENIZEN doc routes each reader to their own lane. Tailoring =
   bending the document toward one named reader.
2. **The honesty rail.** Every claim is marked true / in-progress / planned, and every doc states
   what it is *not* claiming ("Built, not applied", "NOT seeking passive capital", "confirm
   registrations before submission"). This is the brand signature and the anti-hallucination gate.
   It is non-negotiable and it is the thing an autonomous agent will most easily destroy.

---

## 1. The fixed skeleton (8 blocks)

Every dossier is assembled from these blocks, in this order. Not all blocks appear in every doc —
the tailoring playbook (§4) decides which.

| # | Block | Job | DENIZEN example | 1921 example |
|---|-------|-----|-----------------|--------------|
| 1 | **Cover** | Identity + recipient + hard IDs + one motif | title, tagline, version badges, repo/stack | name, tagline, "Prepared for Ben", UEI/CAGE |
| 2 | **Orientation** | Cut reader effort; route them | "How to read this" audience table | Personal letter + "If Ben reads only five things" |
| 3 | **Body** | The substance, organized by reader *or* theme | 4 parts by audience | founder → ecosystem → proof → team → fit |
| 4 | **Evidence** | Proof, with provenance | 646 tests, commit `ae3ddf9`, "known open items" | City of Edmond, track record, "what not to chase" |
| 5 | **Fit / Tailoring** | The recipient-specific argument | per-audience lanes + ready positioning lines | "Strategic Fit with RM Cyber" + joint pursuits |
| 6 | **The Ask** | One clear next step | "immediate path to public launch" | "What partnership looks like" |
| 7 | **Appendices** | Reference data, verifiable | commands, glossary, file map, positioning | certifications, NAICS codes, registrations |
| 8 | **Footer system** | Running doc name + page/part on every page | "DENIZEN · v1.6.0 · PART I" | "1921 · CONFIDENTIAL — PREPARED FOR RM CYBER" |

---

## 2. Document types

A "type" is a preset selection of blocks + a default reader + a default skin. Start with these five;
add more as canon, never as code.

| Type | Default reader | Body organized by | Skin | Notable blocks |
|------|----------------|-------------------|------|----------------|
| `technical-dossier` | engineer + investor | audience lanes | DENIZEN | full body, runbook appendix, provenance |
| `partnership-dossier` | named partner | theme | 1921 | personal letter, **Fit** section, the ask |
| `investor-deck` | investor | theme (problem→traction→ask) | per-brand | exec summary, evidence, market, team, ask |
| `client-capability` | prospective client | theme (problem→capability→proof→next) | RSMG / client | proof, pricing/next step, light appendix |
| `capability-statement` | gov buyer / prime | fixed gov format | 1921 | UEI/CAGE/NAICS/set-asides, past performance, differentiators |

---

## 3. Brand skins (design tokens)

Same grammar, different paint. A skin is a token set + motif + voice. Store as `data/dossier-skins/<name>.json`.

**Shared invariants (all skins):**
- Dark base, **one** accent color, generous whitespace, no clutter.
- Monospace for section markers / labels; serif italic reserved for human/quote moments (the letter,
  the pull-quote ask). Sans for body.
- **Tables are the primary density tool** — not paragraphs of prose. If you're listing, use a table.
- Callout/rule boxes for principles ("WHY THIS MATTERS", "A NOTE TO BEN", "HARD SAFETY RULE").
- One recurring motif, used sparingly (jellyfish / constellation), never decorative noise.

| Skin | Base | Accent | Motif | Voice |
|------|------|--------|-------|-------|
| `denizen` | deep navy `#0a0e1a`-ish | electric blue | bioluminescent jellyfish | precise, technical, "no aspirational fiction" |
| `1921` | navy `#0f1b2d`-ish | gold / cream | constellation lines | founder-warm, disciplined, "readiness first" |
| `rsmg` | charcoal `#141414` | coral accent | broadcast mark | media/brand, client-facing |
| `client-*` | match client brand | match client | client mark | adapt to the client, not to you |

> Token discipline: every color, size, and spacing value is a named token. No hardcoded hex in the
> template. This is what lets Rob reskin a doc without touching layout — same reason you forbid
> agents editing their own soul files.

---

## 4. The tailoring playbook (the heart)

This is the decision procedure an NPC follows. It is what "know exactly how to tailor it" means.
Run it top to bottom; do not skip the honesty pass.

### Step 1 — Identify the TYPE
From §2. If unclear, the chain stops and asks the operator. Never guess the type — it sets everything
downstream.

### Step 2 — Identify the READER and what they optimize for
| Reader | Optimizes for | Lead with | Cut |
|--------|---------------|-----------|-----|
| Investor | risk-down, upside | traction/evidence, team, market, ask | deep internals |
| Engineer | "can I run/extend it" | architecture, module map, runbook | market framing |
| Partner | "where do we win together" | who-we-are, proof, **fit-with-them**, ask | unrelated capability |
| Client | "will this solve my problem" | problem, capability, proof, price, next step | company lore |
| Gov buyer | compliance + past performance | IDs, set-asides, NAICS, past performance | narrative fluff |

### Step 3 — Identify the RECIPIENT (if named) → derive the FIT angle
This is the highest-value step. If the doc names a recipient (RM Cyber, a specific fund, a client):
1. **Research them** (Bob / `research` skill): what they do, what they're strong at, what they need.
2. **Find the overlap** between their strengths and the subject's reach.
3. **Write the Fit block (§1 block 5)** entirely in *their* terms — "RM Cyber brings X; 1921 brings Y;
   together we win Z." List concrete joint pursuits, not adjectives.
4. **Frame the Ask (block 6)** as the next step *they* would want, stated plainly.

If no recipient is named, the Fit block becomes generic positioning (DENIZEN's "ready-to-use
positioning language" appendix is the no-named-recipient version of this).

### Step 4 — Bind to the SUBJECT FACTS (source of record — never invent)
Every number, date, credential, and claim comes from a source, named in §6 bindings. The NPC pulls
facts; it does not generate them. Any value it cannot source gets flagged `[UNSOURCED]` and is
**stripped or queried before render** — it never silently ships.

### Step 5 — Select SECTIONS
From the type preset (§2), adjusted for the reader (§2 reader column). Add/drop blocks per Step 2's
"cut" column. Output a section manifest before drafting.

### Step 6 — Apply BRAND SKIN
From §3, per the type or operator override.

### Step 7 — HONESTY PASS (mandatory gate, see §5)
Before render. No exceptions.

### Step 8 — Render → artifact → approval
HTML→PDF via the skill (§7), write to `reports/dossiers/`, broadcast a proposal, **wait for human
approval before any send.**

---

## 5. The honesty pass (brand signature + anti-hallucination gate)

This is your existing `hallucination-guard` applied to a document instead of a think-cycle, plus a
brand convention. It runs after drafting, before render. Owned by Jenny (review) with the guard.

The pass enforces five rules:

1. **Status tagging.** Every capability/claim is marked `[DONE]`, `[IN-PROGRESS]`, or `[PLANNED]`.
   (DENIZEN: "Built, not applied". Mirror this everywhere.)
2. **Provenance.** Evidence states where it came from ("read from commit `ae3ddf9`", "per SAM.gov",
   "City of Edmond, delivered on schedule"). A claim with no provenance is unsupported → flagged.
3. **No unsourced numbers.** Any metric/date/credential not traceable to a §6 source is stripped or
   queried. An agent may never fabricate a revenue figure, test count, certification, or recipient
   strength.
4. **State what you are NOT claiming.** Every doc includes a restraint surface ("NOT seeking passive
   capital", "knowing what not to chase", "confirm registrations before submission"). This is what
   makes the document trustworthy.
5. **Recipient claims are research-backed (traceability, not presence).** Anything asserted about the recipient in the Fit block must cite `[n]` → a Bob research item → a real `https` URL in the research package. Summary-only research (no URLs) blocks render. Freeform Fit prose about the recipient without `[n]` is blocked. This closes the laundering path where Bob hallucinates upstream and the writer cites "research ran ✓". Operator still verifies each cited URL against what they know about the recipient (e.g. Ben Ballard / RM Cyber).

> Why this is non-negotiable: a dossier ships under a real person's name to a real party. This is the
> same failure mode as an NPC claiming "I fixed it" with no backing artifact — except the blast
> radius is a document you cannot un-send. The gate exists precisely because the generator is
> autonomous.

---

## 6. Source-of-record bindings

Where facts come from, by subject. The generator reads these; it does not improvise them.

| Subject | Source of truth | Pull via |
|---------|-----------------|----------|
| DENIZEN technical facts | the repo at a named commit (tests, LOC, modules, migrations) | `github` / repo read, pin the commit |
| 1921 / DDT registrations | SAM.gov record (UEI, CAGE, NAICS, set-asides) | operator-confirmed canon file; verify before submit |
| Past performance | a maintained `past-performance.md` canon file | canon read |
| CRM / pipeline facts | Meridian workspace / intelligence spine | `supabase-bridge` (gated) |
| Recipient facts | live research at generation time | `research` skill (Bob) |
| Revenue / financials | operator-confirmed only — **never** agent-derived | explicit operator input, flagged if absent |

Rule: if the binding is missing or stale, the value is `[UNSOURCED]` and the honesty pass blocks it.

Canon files (v1):
- `data/canonical/1921-facts.json` — registrations, certifications, leadership (from `business-model.json`)
- `data/canonical/denizen-facts.json` — version, stack, status tags (pin commit via `facts_ref`)
- `data/canonical/past-performance.md` — past performance narratives

---

## 7. Wiring it into DENIZEN

### The skill
`pdf-dossier` (Jelly skill). Params:
```
{
  "type": "partnership-dossier",
  "reader": "partner",
  "recipient": "RM Cyber",
  "subject": "1921",
  "skin": "1921",
  "facts_ref": "canon://1921/1921-facts.json",
  "sections": [ ... ]
}
```
The skill reads this spec + the skin token file, runs the playbook, renders HTML→PDF, writes the
artifact, and emits an approval-gated proposal. It does **not** send anything.

### The renderer
HTML/CSS → PDF via headless Chromium print-to-PDF (`jelly/vendor/skills/pdf-generator/pdf-generator.mjs`).
Keep the template token-driven so Rob reskins via tokens, never markup. One template, many skins.

### The chain (uses existing task-chain machinery)
```
Sarah   → reader + section manifest        (artifactCategory: dossier-brief)
Bob     → recipient research + fit angle   (dossier-research)   [if recipient named]
Writer  → draft from facts only            (dossier-draft)
Rob     → apply skin / layout              (dossier-skin)
Jenny   → HONESTY PASS (+ hallucination-guard)  (dossier-review)
[pdf-dossier skill] → render               (dossier-pdf)
Abby    → route to operator for approval
```
Template: `data/dossier-chain-template.json`

### Guardrails (mirror coding-agent gates)
- **Approval-gated like a merge.** A dossier that will be sent is a real-world action → human gate.
- **Forbidden to invent.** The writer agent cannot emit numbers/credentials absent from `facts_ref`.
- **One pending dossier per agent**, same as code proposals.
- **Protected subjects.** Anything under Angela Van Zandt's name flags for operator review.

### Operator API
- `GET /api/dossier-proposals` — list pending dossier proposals
- `POST /api/dossier-proposals/:id/approve` — mark approved (does not email/send)
- `POST /api/dossier-proposals/:id/reject` — reject draft

---

## 8. Open decisions (for Zion)

1. **Renderer stack.** Playwright print (implemented v1) vs React-PDF vs Lovable flow.
2. **How many doc types in v1.** Shipping `partnership-dossier` + `technical-dossier` first.
3. **Facts-source bindings.** Maintained canon files vs live pull — minimum canon files in `data/canonical/`.
4. **Who renders.** Chain assumes Sarah→Bob→Jenny→skill; v1 skill orchestrates internally.

---

## 9. The single rule, if you remember nothing else

> An NPC may assemble, organize, skin, and tailor a dossier autonomously. It may **never** originate a
> fact. Every claim traces to a source or it does not ship — and nothing reaches a recipient without a
> human gate. That constraint is what makes "let the agents make the PDFs" safe instead of dangerous.
