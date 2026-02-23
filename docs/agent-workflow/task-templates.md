# Task Templates (Copy-Paste)

Use these to frame tasks in Agent mode. Replace placeholders in `[brackets]`.

---

## Investigate + Fix

**Goal:** Find and fix [specific bug or symptom].

**Success criteria:**
- [Criterion 1, e.g. "Focus moves with scroll on device"]
- [Criterion 2, e.g. "No console errors"]

**Constraints:** Minimal patch only; no unrelated refactors. Follow `.cursor/rules/*`.

**Workflow:** Plan (2–4 bullets) → Reproduce/isolate → Patch → Validate (run [command]) → Summarize (root cause, changed files, validation result).

---

## Feature Implementation

**Goal:** Implement [feature name] per [doc or spec, e.g. docs/even_solitaire_cursor_build_plan.md].

**Success criteria:**
- [Observable outcome 1]
- [Observable outcome 2]
- Tests added/updated where appropriate

**Constraints:** Preserve existing behavior; follow repo architecture (pure game layer, stateless render, single dispatch).

**Workflow:** Plan → Inspect relevant files → Implement → Validate (typecheck, test, build) → Summarize (approach, changed files, validation).

---

## Refactor (Behavior-Preserving)

**Goal:** Refactor [area] to [objective, e.g. reduce duplication] without changing behavior.

**Success criteria:**
- All existing tests pass
- No change to public APIs or observable behavior unless explicitly allowed

**Constraints:** Small steps; run tests after each logical step. No new features in this change.

**Workflow:** Plan → Identify call sites and tests → Refactor in small commits/chunks → Validate after each step → Summarize.

---

## Upgrade / Migration

**Goal:** [Upgrade dependency X to Y] or [migrate Z to new format].

**Success criteria:**
- Build and tests pass
- [Any compatibility requirement]

**Constraints:** Document assumptions and rollback approach. Flag data-destructive or breaking changes.

**Workflow:** Plan (compat, risks) → Implement → Validate (install, test, build) → Summarize (assumptions, risks, validation).

---

## Test Failure Triage

**Goal:** Fix or document failing test(s) in [path or suite].

**Success criteria:**
- Tests pass, or failure is documented with cause and next step

**Constraints:** Prefer fixing root cause over changing assertions unless the test was wrong.

**Workflow:** Reproduce → Identify cause (code vs test vs env) → Fix or document → Re-run suite → Summarize.
