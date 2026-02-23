# Cursor Agent Workflow (EvenSolitaire)

This folder documents the **modular Cursor rules and workflow** used for high-efficiency Agent runs: less token waste, fewer rework loops, and reliable autonomous execution.

## Why modular rules?

- **Always-on context stays small** — only essential behavior is in global rules.
- **Discovery is targeted** — the repo map and playbooks tell the agent where to look first.
- **Validation is required** — every task ends with a concrete check (lint/test/build).
- **Troubleshooting is structured** — debug playbook and safety rules reduce blind patching.

## What each rule file does

| File | Purpose |
|------|--------|
| `00-agent-operating-mode.mdc` | Plan briefly, minimal edits, validate before done, summarize, stop after 2 failed attempts. |
| `10-repo-map.mdc` | Where entrypoints, game logic, state, render, and tests live; what not to edit. |
| `20-code-style.mdc` | TS/Vite conventions; pure game layer; stateless renderers; single dispatch. |
| `30-test-and-validation.mdc` | Commands for lint/test/typecheck/build; escalation order; summary requirement. |
| `40-safety-and-scope.mdc` | No unrelated refactors; preserve interfaces; flag migrations; max 2 retries. |
| `50-debug-playbook.mdc` | Reproduce → isolate → patch → validate; evidence-first; bug report format. |
| `90-task-templates.mdc` | Points to copy-paste templates for Investigate+Fix, Feature, Refactor, etc. |

Project-specific rules (e.g. `Review-resources.mdc`, `agents/*`) remain in `.cursor/rules/`.

## Using Agent mode effectively

- **One bounded task per chat** when possible.
- **Use Ask / read-only** for architecture or “where is X?”; use **Agent** for implementation and edits.
- **Keep prompts small and outcome-focused** — e.g. “Fix focus not moving on scroll” plus success criteria, not long essays.
- **Ask for a summary of evidence** instead of pasting full logs — e.g. “Summarize the last 5 lines of the build error and the file:line.”

## Task templates and subagents

- **Copy-paste templates:** `task-templates.md` — Investigate+Fix, Feature, Refactor, Upgrade, Test Triage.
- **Subagent usage:** `subagents.md` — when to use recon, debug triage, refactor-safety, docs lookup.
- **Tool hygiene:** `tool-hygiene.md` — narrow searches, summarize output, targeted tests first.

## Recommended next step

After setup, validate with a small real task, for example:

> Use the Cursor workflow rules and templates. Goal: [one small bug or feature]. Success criteria: [1–2 concrete checks]. Constraints: minimal patch, follow `.cursor/rules/*`, run targeted validation first. Return root cause or approach, changed files, and validation results.
