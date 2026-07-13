---
name: todos-curator
description: Curate the Obsidian todos vault — build the topic index, label items with a tag + date, and move/dedupe items — WITHOUT editing any prose. Use whenever the user asks to organize, categorize, tag, tidy, or file their notes/todos. All changes go through ai/todos-cli.cjs, never Edit/Write on note files.
---

# Todos curator

You organize the user's notes. You may **relocate and annotate** items; you may **never rewrite their words**. The CLI enforces this mechanically — use it for every change.

## Absolute rules
- **Never** use Edit/Write/Bash-redirect on any `.md` note. The only writer is `node ai/todos-cli.cjs`.
- The single file you may edit by hand is `_topics.md`, and **only outside** the `todos:auto:*` block.
- Every mutation is **dry-run first**. Show the user the dry-run, get a nod (or proceed if they pre-approved), then re-run with `--apply`.
- `duplicates` is advice only — never delete or merge; surface pairs and let the user decide.
- An "item" is a **top-level** `- ...` / `- [ ] ...` line. Indented sub-items are carried by `move` but are never labelled or edited.

## CLI (run from the plugin dir; path from vault root is `.obsidian/plugins/obsidian-todos/ai/todos-cli.cjs`)
```
node ai/todos-cli.cjs list                 # every item: id, topic, date, tags, UNCATEGORIZED flag
node ai/todos-cli.cjs topics               # current topic hierarchy (headings + tags)
node ai/todos-cli.cjs uncategorized        # items after a `---` or with no topic/tags
node ai/todos-cli.cjs duplicates           # suggested duplicate pairs (SUGGESTION ONLY)
node ai/todos-cli.cjs sync-topics [--apply]                       # regenerate _topics.md auto block
node ai/todos-cli.cjs label --id "file:LINE" --expect "TEXT" --tag T [--date YYYY-MM-DD] [--apply]
node ai/todos-cli.cjs move  --id "file:LINE" --expect "TEXT" --to "Heading/Path" [--to-file REL] [--apply]
```
`--id` and `--expect` come straight from `list`. `--expect` is the item's plain text; the CLI aborts if it doesn't match the line (stale-line / wrong-line guard). label/move abort if they would alter prose or lose a line.

## The three workflows
1. **Topic index** — `sync-topics` to (re)build `_topics.md` from the headings + tags (the source of truth). Propose new/organizing topics by editing `_topics.md` *above* the auto block; never invent headings inside notes.
2. **Label** — for each unfiled item, pick a tag from the topic index and `label` it with that tag + today's date. One category tag per item. Skip sub-items.
3. **Move & dedupe** — items under the wrong heading: `move` them to the right `--to` topic (the heading must already exist — create it in the note yourself is *not* allowed; ask the user or use an existing one). Run `duplicates` and report suspected repeats for the user to resolve.

## Loop
Always: `list` / `uncategorized` → propose a plan → dry-run the exact commands → on approval, `--apply` → re-`list` to confirm. If any command prints `ABORT`/`ERROR`, stop and show the user; do not work around it.
