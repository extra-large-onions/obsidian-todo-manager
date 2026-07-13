# CLAUDE.md — notes vault guardrails

This repo is an Obsidian plugin; the surrounding vault holds the user's personal notes. When asked to organize, tag, categorize, tidy, file, or dedupe todos/notes, use the **todos-curator** skill.

## Non-negotiable
- **Do not edit the user's prose. Ever.** No Edit/Write/`>>`/`sed` on `.md` notes.
- The **only** way to change notes is `node ai/todos-cli.cjs` (build once with `npm run build:ai`). It mechanically refuses to alter item text or drop lines.
- You may hand-edit exactly one file, `_topics.md`, and only *outside* its `todos:auto:*` block.
- All mutations run **dry-run first**; add `--apply` only after showing the change. `--apply` writes a `.bak` beside each file.
- `duplicates` is suggestion-only. Never delete or merge on your own.
- Items = top-level list lines. Never label or edit indented sub-items (a `move` carries them along untouched).
- If the CLI prints `ABORT`/`ERROR`, surface it and stop — never route around a guard.

## What you may do (the three workflows)
1. `sync-topics` → maintain the hierarchical `_topics.md` from headings + tags.
2. `label` → add one topic tag + a date stamp to an unfiled item.
3. `move` items to the correct existing heading; `duplicates` → report, don't act.

Topics come from **markdown headings** (an item's enclosing heading path) plus tags — see `architecture.md`.
