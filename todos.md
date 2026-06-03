# Todos — Project-Management Plugin

Built around 4 ideas: **items** (parsed lines), **tag dimensions** (independent axes of metadata), **central view** (filterable tree), **tag manager** (single source of truth for tags).

## 1. Foundation / housekeeping
- [ ] Rename plugin: update `manifest.json` (`id`, `name`, `description`) and `package.json` (`name`, `description`).
- [ ] Define core TypeScript types in `src/types.ts`:
  - `ItemKind = 'task' | 'knowledge' | 'index'`
  - `Tag` (raw string + parsed dimension + value path)
  - `Item` (kind, text, file, line, indent, tags[], status?, time?, children[])
  - `Dimension` (id, name, kind: 'tree' | 'enum' | 'time' | 'free', tags[])
- [ ] Replace sample command boilerplate in `src/main.ts`.

## 2. Parsing (no IO, pure functions)
- [ ] `src/parser.ts`:
  - Parse a file's lines into items by indent level.
  - Recognize `- [ ]`, `- [x]`, `- [/]`, `- [-]` as tasks (status from box).
  - Recognize `- text` as knowledge (or index if no tag at top level).
  - Recognize plain non-list lines as index entries.
  - Extract `#a/b/c` style hierarchical tags and `key:value` style metadata (e.g. `added:2026-05-14`).
  - Group children by indent under their parent.
  - Top-level item carries its tags down to descendants (only top needs tag).
  - Return `Item[]` for the file.

## 3. Tag dimensions (model + classification)
- [ ] `src/tags.ts`:
  - Configurable `Dimension[]`. Default dimensions:
    - `tree` (tree, e.g. `deployment/startup-sequence/...`)
    - `status` (enum: `doing`, `later`, `done`)
    - `time` (time, e.g. `added:2026-05-14`)
  - Function: `classify(tag) -> {dimension, value}` — match by prefix/known set.
  - Function: `dimensionsOf(item) -> Map<dimensionId, value[]>`.
  - Function: `treePathOf(item)` — for the main tree dimension.

## 4. Vault index (incremental, debounced)
- [ ] `src/index-store.ts`:
  - Maintain `Map<filePath, Item[]>`.
  - On plugin load, scan all markdown files once.
  - Subscribe to vault events: `create`, `modify`, `delete`, `rename`.
  - Debounce `modify` per-file (~250 ms) so typing doesn't thrash.
  - Re-parse only the changed file; emit a coarse `'changed'` event.
  - Expose `allItems()`, `byTreePath()`, `untagged()`, `untimed()`.

## 5. Central view (tree + filter)
- [ ] `src/views/central-view.ts`:
  - Register `ItemView` with type `pm-central-view`; ribbon icon to open.
  - Top: filter bar — chips per non-tree dimension (status, time-recency, custom).
  - Body: tree grouped by the tree dimension; under each leaf, items in source order.
  - Each item row:
    - Task: checkbox + text + tag chips + time chip; click checkbox toggles status in file.
    - Knowledge: bullet + text + chips.
    - Index: muted text + tags + chips.
    - Subtree of children rendered indented (collapsible).
  - Click on text → reveal in file (open + jump to line).
  - Listen to index-store `'changed'` and re-render (debounced).

## 6. Tag manager
- [ ] `src/views/tag-manager.ts`:
  - Modal (or side view) listing every distinct tag, grouped by dimension.
  - Rename: edit field per tag → on commit, rewrite that tag everywhere in the vault (text-level replace, scoped to `#tag` boundaries).
  - Delete: remove tag from all items.
  - Add: register a new tag value under a dimension (settings only — not auto-applied to items).

## 7. Sync / validation command
- [ ] `src/commands/sync.ts`:
  - Command "Project items: sync" → opens a modal listing:
    - Untagged top-level items (no tree tag and no other tag).
    - Untimed items (no `added:` or other time key).
  - Each row: "Reveal" button to open the file at that line.

## 8. Settings tab
- [ ] `src/settings.ts`:
  - Edit dimension list (id, kind, known tag values).
  - Choose which dimension is the "tree" dimension.
  - Time-key list (default: `added`, `due`).
  - Debounce ms for refresh.

## 9. Styling
- [ ] `styles.css`: tree, chips, dimmed index lines, status colors, filter bar.

## 10. Wire-up + lifecycle
- [ ] `src/main.ts`:
  - `onload`: load settings → init index-store → register view → register ribbon → register commands → settings tab.
  - `onunload`: index-store handles teardown via `register*`.

## 11. Docs (last)
- [ ] `architecture.md`: summary of modules, data flow, extension points.

---

## 12. Smart tag suggester (follow-up feature)
Plan: `~/.claude/plans/use-whatever-co-extension-reactive-graham.md`. Co-extension audit: native `EditorSuggest` only — Bases/Dataview not needed.

- [ ] `src/index-store.ts`: add `tagsInFile(path: string): Set<string>` (own + inherited tags).
- [ ] `src/suggester/tag-suggest.ts`: `TagSuggest extends EditorSuggest<TagSuggestion>`.
  - `onTrigger`: inside list-item line only, fires on `#` followed by tag-allowed chars.
  - `getSuggestions`: prefix/substring filter + file-context boost (+50) + log frequency.
  - `renderSuggestion`: tag value, dimension chip on the right, ★ if in-file.
  - `selectSuggestion`: replace `#query` with `#value `.
- [ ] `src/main.ts`: `this.registerEditorSuggest(new TagSuggest(this.app, this.store))`.
- [ ] `styles.css`: `.pm-suggest-row`, `.pm-suggest-tag`, `.pm-suggest-dim`, `.pm-suggest-infile`.
- [ ] Build + lint must stay clean.
