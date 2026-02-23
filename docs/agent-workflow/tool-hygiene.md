# Tool Hygiene (Token-Efficient)

Use tools in a way that keeps context small and outcomes clear.

- **Narrow searches over broad scans** — Prefer targeted codebase search (e.g. by directory or symbol) over “search entire repo” when possible.
- **Summarize command output** — When running lint/test/build, report pass/fail and the last few lines of failure; avoid pasting full logs into the chat.
- **Avoid pasting full logs/tests by default** — Extract the relevant error and file:line; paste more only if asked or for diagnosis.
- **Targeted tests first** — Run a single test or subset (e.g. `npx vitest run path/to/file`) before the full suite when debugging one area.
- **Load only what’s needed** — Don’t open every file in a directory; read headers or key sections first, then expand if necessary.
- **Heavy tools / MCPs** — Use browser or external services in separate workflows or profiles when possible so normal coding chats stay fast.

Apply these in Agent runs so that each turn adds signal without blowing token budget.
