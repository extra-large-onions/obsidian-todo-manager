# Sample prompts

Paste one of these to Claude (the `todos-curator` skill + `CLAUDE.md` do the rest).

## Full tidy pass
> Curate my todos. First `sync-topics` and show me the topic tree. Then list everything uncategorized, propose a tag + today's date for each from the existing topics, and show me the dry-run before applying. Flag any duplicates for me to decide — don't merge them. Don't touch my wording.

## Just file the loose items
> Some items ended up under the wrong headings or after a `---`. Show me `list` and `uncategorized`, suggest where each should move, and dry-run the `move`s. Apply only the ones I approve. Carry sub-items along; never edit text.

## Refresh the topic index
> Regenerate `_topics.md` from my headings and tags, then suggest 3–5 higher-level groupings I could add above the auto block. Don't add headings inside my notes.

## Dedupe review
> Run `duplicates` and give me a short list of likely repeats with their ids and text. Recommend which to keep — but make no changes.

---
Expected shape of every reply: a plan → the exact `todos-cli.cjs` commands as **dry-run** → after approval, `--apply` → a re-`list` to confirm. If a command ABORTs, Claude stops and shows you.
