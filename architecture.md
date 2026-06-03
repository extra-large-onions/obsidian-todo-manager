# Architecture — Project Items plugin

A small Obsidian plugin that scans the vault for **items** (tasks, knowledge bullets, plain index lines), classifies them along configurable **dimensions**, and surfaces them in a central view with sidebar filtering and tree / date / sprint grouping. A **dimension manager** provides full CRUD for dimensions; a **sync modal** surfaces items missing tags or timestamps; a **tag suggester** autocompletes `#tags` while writing; a **stamp** button back-fills date metadata across the vault.

---

## Data model

A markdown line becomes an `Item` of one of three kinds:

| Kind | Source syntax | Notes |
|------|---------------|-------|
| `task` | `- [ ]` `- [x]` `- [/]` `- [-]` | `status`: todo / doing / done / cancelled |
| `knowledge` | `- text` (no checkbox) | Nestable bullet |
| `index` | Non-list line starting at column 0 | Prose / heading-like; always top-level, never stamped |

Each `Item` carries:
- `text` — display text stripped of tags, metadata blocks, and comment wrappers
- `rawText` — original line
- `loc` — `{ path, line (0-based), indent }`
- `tags[]` — raw tag strings without `#`, e.g. `polish/asset/sound`
- `meta[]` — `{ key, value }` pairs extracted from the line
- `status?` — tasks only
- `children[]` — items nested by indent (any indent > parent's indent)

**Tag inheritance**: children inherit ancestor tags for filtering and classification. They do not need their own tags.

---

## Metadata format

Metadata is stored in an Obsidian comment block at the end of a list line:

```
- [ ] write scene 3 dialogue #polish/story/scene-3 %% added:2026-05-15 due:2026-05-30 %%
```

The `%% ... %%` block is **invisible in Reading Mode and Live Preview**; only the text and tags are shown. In Source Mode the full line is visible. Multiple `key:value` pairs share one block separated by spaces.

The parser also accepts bare `key:value` anywhere in the line (backwards compatibility). New metadata written by the plugin always uses the comment block format.

---

## Dimensions

Everything is classified along **dimensions**. Each dimension has a `kind`:

| Kind | Source | Behaviour |
|------|--------|-----------|
| `tree` | `#tag` | Hierarchical, slash-delimited. With `values: []` auto-captures any tag containing `/`. Filtering uses prefix match. |
| `radio` | `#tag` | Flat enum, single-value. Classified by exact match against `values[]`. |
| `checkbox` | `#tag` | Flat enum, multi-value. Accumulates all matches against `values[]`. |
| `time` | `key:value` in `%% ... %%` | Dimension `id` is the metadata key (`added:2026-05-15` → matched by dim with `id: "added"`). Powers Date and Sprint grouping. |
| `text` | `key:value` in `%% ... %%` | Free string metadata. Display only; not filterable. |
| `auto` | Derived from syntax | Values: `task/todo`, `task/doing`, `task/done`, `task/cancelled`, `knowledge`, `index`. Powers the Type filter. Never from tags/metadata. |

**Default dimensions** (protected — cannot be deleted):

| id | name | kind | notes |
|----|------|------|-------|
| tree | Tree | tree | Auto-discovers any `#tag/subtag` when `values` is empty |
| type | Type | auto | Derived from item syntax; not taggable |
| added | Added | time | `added:YYYY-MM-DD` in `%% ... %%` |
| due | Due | time | `due:YYYY-MM-DD` in `%% ... %%` |

**`classifyTag`**: walks dims in order; exact match against `values[]`; tree dim with empty values matches any tag containing `/`; first match wins; no match → free bucket.

**`dimensionsOf(item, dims, inheritedTags)`**: returns `Map<dimId, value[]>` combining tag classification, metadata key matching, and auto-dim derivation.

**`matchesFilter`**: AND across dimensions, OR within a dimension's value set. Tree and auto dims use prefix matching (`polish` matches `polish/asset/sound`).

---

## Modules

```
src/
  types.ts              # Item, Dimension, DimensionKind, MetaPair, TaskStatus
  parser.ts             # parseFile(text, opts) -> Item[]  (pure, no IO)
  tags.ts               # classifyTag, dimensionsOf, freeTags, treePathOf, matchesFilter
  index-store.ts        # IndexStore: in-memory vault index, vault-event hookup
  settings.ts           # PMSettings + PMSettingTab
  main.ts               # Plugin lifecycle, commands, view/suggester registration
  views/
    central-view.ts     # Main ItemView: sidebar + tree/date/sprint main area
    tag-manager.ts      # DimManagerModal: full CRUD for dimensions
  commands/
    sync.ts             # SyncModal: untagged + untimed items with reveal
  suggester/
    tag-suggest.ts      # EditorSuggest: #tag autocomplete inside list lines
```

---

## Data flow

```
Vault events (modify / create / delete / rename)
        │
        ▼
  IndexStore  ──── 'changed' event ────►  CentralView  (re-renders)
  Map<path, Item[]>
        │
        │  updateConfig()
        ◄───────────────────────────────  DimManagerModal → plugin.persist()
                                          PMSettingTab    → plugin.persist()
```

---

## Refresh strategy

1. **Per-file debounce** (`onModify`): resets a per-path `setTimeout(debounceMs, 250)` on every vault modify. The file is only re-parsed once after typing stops.
2. **Coarse notify** (`notifyChangedSoon`): 50 ms timer after any re-parse emits one `'changed'` event. Views apply their own `debounce(80)` on top.

Initial full scan deferred to `workspace.onLayoutReady`. Subsequent updates are single-file only. If `rootFolder` is set, out-of-scope files are ignored entirely.

---

## Parsing (`parser.ts`)

Pure function: `parseFile(text, opts) → Item[]`. No IO.

- Lines classified by regex: `TASK_RE` → task, `LIST_RE` → knowledge, `/^\S/` → index.
- A stack of open ancestors tracks nesting; an item is a child if `indent > parent.indent`.
- Index lines always reset the stack (never children).

**`extractMeta(text, ids)`** — two-pass:
1. Scans for `%% ... %%` blocks, extracts `key:value` pairs inside, strips the block from display text.
2. Scans remaining text for bare `key:value` tokens (backwards compatibility).

**`extractTags(text)`** — strips `#tag` tokens, returns tag list and display text.

Both run inside `makeItem` in that order: meta first (so comment blocks are gone), then tags, leaving only the human-readable `text`.

---

## Central view (`central-view.ts`)

Split into a 200 px left sidebar and a scrollable main area. Re-renders on every `'changed'` event (debounced 80 ms) or user interaction. Scroll positions of both panels are saved and restored on every re-render.

### Sidebar

**Type filter** (auto dim, rendered first):
- **Tasks** master checkbox — clicking selects/deselects all four subtypes at once. Shows indeterminate when some but not all subtypes are active. Clicking a subtype only affects that subtype; it never auto-selects the master.
- Indented subtypes: Todo / Doing / Done / Discarded — independent toggles with item counts.
- Knowledge and Index rows — always shown with counts.
- Untagged warning (count of top-level items with no tags) when non-zero.

**Tree filter** (top-level segments only):
- Groups `store.byTreePath()` keys on their first `/`-segment and sums item counts.
- Radio-style: one segment active at a time; click the active one to deselect.
- Active segment is set in `this.filter` under the tree dim id; `matchesFilter` prefix-matches it against full tree paths in the main area.

**Footer** (always visible):
- **Clear** — appears only when any filter is active; clears all filters.
- **Rescan** — triggers `store.fullScan()`.
- **Stamp dates** — back-fills `%% added:YYYY-MM-DD %%` on every top-level task and knowledge item that has no time-dimension metadata. Index items are skipped. If the line already has a `%% ... %%` block, the new pair is inserted inside the existing block rather than creating a second one.

Filter state: `Map<dimId, Set<value>>`.

### Main area

Three grouping modes toggled by Tree / Date / Sprint buttons:

**Tree mode**: `buildTree()` walks every top-level item via `store.allFiles()`, finds its tree path via `treePathOf`, inserts it into a `TreeNode` tree. When a sidebar tree segment is active, only items whose path starts with that segment are included (handled by `matchesFilter`). Section headers are plain display text; no collapse.

**Date mode**: groups items by their first time-dimension value, sorted ascending; undated items at the bottom.

**Sprint mode**: activity-based automatic sprint detection.
1. Bucket items with a time-dimension value by exact date → `Map<date, Item[]>`.
2. Sort active dates ascending.
3. Walk: if `daysBetween(prev, current) > SPRINT_GAP_DAYS` (default **2**) emit current sprint and start a new one.
4. Label each sprint `Sprint N — Mon DD–DD` using the first and last active date.
5. Items with no time metadata go to "No date" at the bottom.

`SPRINT_GAP_DAYS = 2`: any stretch of 2+ consecutive days with no items added triggers a boundary. A single-day gap (e.g. Sunday) does not split; a weekend does. The algorithm is O(n log n). It is blind to item volume — density changes within a continuous active streak are not detected.

### Item rendering

- Tasks: native checkbox (clicking writes the toggled `[ ]`/`[x]` back to the file via `vault.modify`).
- Knowledge: bullet `•`. Index: italic muted text.
- Status colours: todo = muted, doing = orange, done = green + strikethrough, cancelled = yellow + strikethrough.
- Chips for non-tree, non-auto dimensions. Free tags (unclassified) shown as monospace bordered chips.
- Children indented recursively, inheriting parent tags.

---

## Tag suggester (`tag-suggest.ts`)

`TagSuggest extends EditorSuggest` fires when `#` is typed inside a list-item line.

- `onTrigger`: walks back from cursor; returns null if not a list line or no preceding `#`.
- `getSuggestions`: ranks candidates from `store.tagsByDimension()` — skips time and auto dims. Score = prefix match (+100) or substring (+30) + in-file boost (+50 via `store.tagsInFile`) + log-frequency.
- `renderSuggestion`: `#tag/value` + dimension name chip; ★ if in-file.
- `selectSuggestion`: replaces the `#…` span with `#value` + trailing space if needed.

---

## Dimension manager (`tag-manager.ts` → `DimManagerModal`)

Full CRUD for the dimension list. Opened via command palette or Settings → Dimensions button.

- **Protected** (`tree`, `type`, `added`, `due`): name and (for tree/radio/checkbox) values are editable. `id` and `kind` are locked. No delete.
- **Custom**: full edit (name, kind, values) and delete with `window.confirm`. `id` is set at creation (auto-slugified) and cannot be changed.
- **Add form**: id, name, kind dropdown (tree/radio/checkbox/time/text with descriptions), values textarea (hidden for time/text kinds; visibility updates live as kind changes).
- On save: `plugin.persist()` writes `data.json` and calls `store.updateConfig()` → full re-scan.

---

## Sync (`sync.ts`)

`SyncModal` shows:
- **Untagged**: top-level items with no tags (`store.untagged()`).
- **Untimed**: top-level items with no time-dimension metadata (`store.untimed()`).

Each row has a Reveal button that opens the file and scrolls to the item's line.

---

## Settings (`settings.ts`)

Persisted in `data.json` via `loadData` / `saveData`:

| Field | Description |
|-------|-------------|
| `dimensions` | `{ id, name, kind, values[] }[]`. Managed via Dimension Manager. |
| `treeDimId` | Which dimension id drives tree grouping. Must be `tree` kind. |
| `debounceMs` | Per-file modify debounce (default 250 ms). |
| `rootFolder` | Only files under this path are indexed. Leave blank for whole vault. |

The Settings tab exposes `treeDimId`, `debounceMs`, `rootFolder`, and a button to open the Dimension Manager. The raw dimensions textarea was removed.

---

## Lifecycle

`onload()` registers the view, editor suggester, commands, and settings tab. `onunload()` is empty — teardown handled by `register*` helpers.

Commands:
- **Open central view** — opens/reveals the right-panel view
- **Open dimension manager** — opens the dimension manager modal
