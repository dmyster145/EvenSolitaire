# Cursor Auto Agent Setup Orchestrator (Token-Efficient + High-Autonomy)

## Purpose

Use this prompt in **Cursor Agent (Auto model selection enabled)** to configure a repository for:
- modular Cursor Rules (`.mdc`)
- lightweight agent operating patterns
- subagent usage conventions
- tool-call hygiene (token-efficient)
- validation-first workflows
- task templates that reduce rework and troubleshooting loops

This prompt is optimized to help the agent gather **maximum useful context with fewer tokens**, while staying focused on verifiable outcomes.

---

## Prompt for Cursor Agent 

```text
You are configuring this repository for high-efficiency Cursor Agent workflows using modular rules, token-efficient context discovery, and validation-first execution.

# Primary Goal
Set up a Cursor workflow that:
1) maximizes useful context while minimizing token waste,
2) reduces troubleshooting thrash and repeated rework,
3) enables reliable autonomous execution in Agent mode with Auto model selection,
4) remains easy to maintain and extend.

# Operating Constraints
- Prefer small, modular configuration files over one large rule file.
- Keep always-on context minimal.
- Use dynamic context discovery patterns: inspect only what is needed for the task.
- Avoid broad scans / giant outputs unless required.
- Preserve existing project behavior; do not refactor unrelated code.
- If repository details are unclear, investigate first and document assumptions.
- Produce durable artifacts (docs/templates/scripts) that future agent runs can reuse.

# Deliverables (Create/Update)
Create a minimal-but-complete Cursor workflow setup with the following artifacts (adapt paths if repo conventions differ):

1. `.cursor/rules/00-agent-operating-mode.mdc`
2. `.cursor/rules/10-repo-map.mdc`
3. `.cursor/rules/20-code-style.mdc` (or stack-specific split files if needed)
4. `.cursor/rules/30-test-and-validation.mdc`
5. `.cursor/rules/40-safety-and-scope.mdc`
6. `.cursor/rules/50-debug-playbook.mdc`
7. `.cursor/rules/90-task-templates.mdc`
8. `docs/agent-workflow/README.md`
9. `docs/agent-workflow/task-templates.md`
10. `docs/agent-workflow/subagents.md`
11. `docs/agent-workflow/tool-hygiene.md`
12. `scripts/` verification helpers (only if appropriate for this repo; otherwise document exact commands)

If some files already exist, improve them minimally and preserve project-specific intent.

# Phase Plan (Required)
Before editing files:
1) Inspect repo structure and identify language(s), package manager(s), test/lint/typecheck commands, and main entrypoints.
2) Identify existing Cursor config/rules/docs to avoid duplicates or conflicts.
3) Propose a short implementation plan (5–10 bullets) and then execute.

# Required Content Standards for Each File

## 1) 00-agent-operating-mode.mdc
Purpose: small always-on behavior contract for agent execution.
Include rules such as:
- plan briefly before coding
- make minimal, scoped edits
- investigate before patching when root cause is unclear
- validate before claiming success
- summarize root cause / approach / changed files / validation
- stop after repeated failed attempts and switch to evidence gathering

Keep this file concise (high signal, low token cost).

## 2) 10-repo-map.mdc
Purpose: token-efficient navigation guide.
Include:
- key directories and what they contain
- app entrypoints
- test directories
- generated files / directories not to edit
- config files
- known hotspots (if discoverable)
- where env vars are defined
- where scripts/commands live

Do NOT dump whole docs. Summarize where to look first.

## 3) 20-code-style.mdc
Purpose: coding conventions by stack.
Infer project stack and write practical rules for:
- formatting/linting source of truth
- naming conventions
- architecture patterns already present in repo
- import style/module boundaries
- testing style
- framework-specific pitfalls
If multi-language, split into multiple files (e.g., `20-code-style-python.mdc`, `21-code-style-ts.mdc`).

## 4) 30-test-and-validation.mdc
Purpose: verifiable finish lines.
Include:
- primary validation commands (install, lint, test, typecheck, build)
- targeted validation preference (run smallest useful checks first)
- escalation order (targeted -> package -> workspace)
- how to report failures concisely
- requirement to include command results summary in final response

If commands are missing, add placeholders with TODO notes and document what was inferred.

## 5) 40-safety-and-scope.mdc
Purpose: prevent wheel-spinning and unrelated changes.
Include:
- no unrelated refactors during bug fixes
- preserve public interfaces unless task requires change
- ask/flag when migration/data-destructive actions are needed
- avoid editing generated files unless regeneration is part of task
- max retry rule before switching to diagnosis mode
- requirement to state assumptions and risks

## 6) 50-debug-playbook.mdc
Purpose: structured troubleshooting.
Include:
- reproduce -> isolate -> patch -> validate loop
- log/tool output narrowing guidance
- preferred evidence-gathering sequence (stack traces, targeted logs, call sites, config)
- “same error after 2 attempts” stop-and-diagnose policy
- bug report summary format

## 7) 90-task-templates.mdc
Purpose: reusable task framing.
Include templates for:
- Investigate + Fix
- Feature Implementation
- Refactor (behavior-preserving)
- Upgrade/Migration
- Test Failure Triage
Each template should include:
- goal
- success criteria
- constraints
- workflow (plan -> inspect -> implement -> validate -> summarize)

## 8) docs/agent-workflow/README.md
Human-readable overview describing:
- why modular rules exist
- what each rule file does
- how to use Agent mode effectively
- when to use Ask/read-only planning vs Agent execution
- how to keep prompts small and outcome-focused

## 9) docs/agent-workflow/task-templates.md
Store copy/paste templates for common tasks with placeholders.

## 10) docs/agent-workflow/subagents.md
Define recommended subagent roles and usage patterns, e.g.:
- Recon (repo/file discovery)
- Debug triage (failure summarization)
- Refactor safety (blast radius/call sites)
- Docs lookup (API/vendor docs)
For each:
- objective
- when to use
- what inputs to provide
- what outputs to return (summary only, not raw dumps)

## 11) docs/agent-workflow/tool-hygiene.md
Document token-efficient tool usage:
- narrow searches over broad scans
- summarize command output
- avoid pasting full logs/tests by default
- use targeted tests first
- load only necessary tools/MCPs
- keep heavy tools in separate workflows/profiles if applicable

## 12) scripts/* (Optional)
If the repo supports it, create thin helper scripts or npm/pnpm/make targets for:
- targeted lint/test/typecheck/build
- project verification bundle (e.g., `verify:changed` or `verify:feature`)
If not appropriate, document exact commands in `30-test-and-validation.mdc` and README instead.

# Rules File Format Expectations
- Use `.mdc` files.
- Use clear titles and descriptions.
- If this repo uses globs/scoped application of rules, include appropriate frontmatter and globs.
- Keep files modular and concise.

# Token Efficiency Requirements (Important)
While doing this setup:
- Do not read entire files if a header / top section is enough.
- Prefer file search and targeted inspection.
- Summarize findings before broad edits.
- Reuse existing commands/config rather than inventing new ones.
- Avoid large terminal outputs in the chat response.

# Final Response Format (Required)
Return:
1) Short summary of what you configured
2) File tree of created/updated workflow artifacts
3) Key inferred commands (lint/test/typecheck/build)
4) Any assumptions or TODOs requiring human confirmation
5) Recommended next prompt to test the new setup (copy/paste ready)

# Quality Bar
The result should be immediately useful for future Agent runs in Auto mode, minimize token waste, and reduce debugging/rework loops.
```

---

## Optional Follow-Up Prompts (After Setup)

### 1) Validate the setup against a real bug-fix task
```text
Use our new Cursor workflow rules and templates to handle this task in execution mode.

Goal:
Fix [specific bug].

Success criteria:
- [criterion 1]
- [criterion 2]

Constraints:
- Minimal patch only
- Follow `.cursor/rules/*`
- Run targeted validation first

Return root cause, changed files, and validation results.
```

### 2) Tighten the repo map after a few runs
```text
Review the last 3 completed tasks and update `10-repo-map.mdc` and `50-debug-playbook.mdc` to improve context discovery and reduce repeated investigation work. Keep changes concise.
```

### 3) Add stack-specific optimizations
```text
Enhance `20-code-style*.mdc` and `30-test-and-validation.mdc` for this project's stack (identify exact framework/tooling versions from the repo). Add only high-signal rules and commands.
```

---

## Notes for the Human Operator

- Keep **global/user rules short** and stable.
- Keep **project rules modular** and repo-specific.
- Prefer **one bounded task per chat**.
- Use **Ask/read-only mode** for architecture/planning and **Agent mode** for implementation.
- Ask the agent to **summarize evidence** instead of dumping raw logs.

