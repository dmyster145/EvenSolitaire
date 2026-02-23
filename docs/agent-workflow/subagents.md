# Subagent Roles and Usage

Use these roles when a task benefits from focused, single-purpose work. Provide clear inputs and ask for **summaries** (not raw dumps).

---

## Recon (repo / file discovery)

- **Objective:** Find where a capability lives or which files touch a given area.
- **When:** Starting a new task, or when “where is X?” is unclear.
- **Inputs:** Question (e.g. “Where is focus movement handled?”), optional path hints.
- **Outputs:** Short list of files and 1–2 sentence summary of roles; no full file contents unless needed.

---

## Debug triage (failure summarization)

- **Objective:** Turn a failing run (test/build/lint) into a concise cause and next step.
- **When:** Tests or build fail and the agent has already tried once or twice.
- **Inputs:** Command run, last 10–20 lines of output, and which file(s) were recently changed.
- **Outputs:** Likely root cause (1–3 sentences), suggested next action, and any extra evidence to gather.

---

## Refactor safety (blast radius / call sites)

- **Objective:** Identify call sites and impact of changing a function/module/interface.
- **When:** Before a refactor or API change.
- **Inputs:** Symbol or file to change; scope (e.g. “this repo only”).
- **Outputs:** List of call sites and dependents; risk level (low/medium/high); suggestion for order of change.

---

## Docs lookup (API / vendor docs)

- **Objective:** Answer “how does X work?” from SDK or vendor docs.
- **When:** Implementing against Even Hub SDK or external API.
- **Inputs:** Specific question and, if possible, link or doc name (e.g. `SDKandDevResources.md`, EvenChess).
- **Outputs:** Short answer with code or config snippet if relevant; source link. No full-page paste.

---

For project-specific specialist agents (UX/UI, engineering, security, QA), see `.cursor/rules/agents/` and `docs/project-manager.md`.
