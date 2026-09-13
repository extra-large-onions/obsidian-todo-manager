# Architecture — Project Items plugin

A small Obsidian plugin that scans the vault for **items** (tasks, knowledge bullets, plain index lines), classifies them along configurable **dimensions**, and surfaces them in a central view with sidebar filtering and outline / topics / date / sprint grouping. The primary **topic** axis comes from **markdown headings** — an item's enclosing heading path is its topic, so no per-line topic tags need to be authored. A **conceal** editor extension hides `%%…%%` metadata (and optionally `#tags`) while writing, revealing the raw line only under the cursor. A **management tab** edits dimensions as text and inventories every value, tag and metadata key the vault actually holds; a **sync modal** surfaces items missing tags or timestamps; a **tag suggester** autocompletes `#tags` while writing; a **stamp** button back-fills date metadata across the vault.

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
- `section[]` — enclosing heading titles, outermost first, e.g. `["Deployment", "Startup"]`. This is the item's **topic path**.
- `status?` — tasks only
- `children[]` — items nested by indent (any indent > parent's indent)

**Headings are structure, not items.** ATX headings (`#`…`######`) are consumed by the parser to build the section stack; they are never emitted into the item forest. Every item beneath a heading records the current heading path in `section`. A heading at level N pops any open headings at level ≥ N.

**`---` marks uncategorized.** A thematic break (`---`, ignoring any `%%…%%`) sets a flag for the rest of the current section; items parsed while it's set get `uncategorized: true` and a reserved topic of `Uncategorized` (via `treePathOf`/`dimensionsOf`), overriding their heading. The flag resets at the next heading. The `---` line itself is not an item. A leading YAML frontmatter block is skipped so its keys aren't parsed as items.

**Tag inheritance**: children inherit ancestor tags for filtering and classification. They do not need their own tags. `section` is set identically on an item and its indent-nested children (same enclosing heading).

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
| `tree` | **heading section** (fallback: `#tag`) | Hierarchical topic path. An item's `section` (heading path) is authoritative and joined with `/`; an item after a `---` is forced to `Uncategorized`. Only items sitting above any heading fall back to the legacy `#tag` behaviour (with `values: []` auto-captures any tag containing `/`). Filtering uses prefix match. |
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
  settings.ts           # PMSettings + PMSettingTab (plugin behaviour only)
  dimensions-format.ts  # text <-> Dimension[]: the dimension DSL
  inventory.ts          # buildInventory(store): what the vault holds vs. what is declared
  reconcile.ts          # stampMissingDates(): additive auto-dating (button + background)
  main.ts               # Plugin lifecycle, commands, view/suggester registration
  views/
    central-view.ts     # Main ItemView: sidebar + tree/date/sprint main area
    canvas-view.ts      # Canvas ItemView: hierarchy sidebar + toolbar injected over the canvas
    manage-view.ts      # Management tab: dimension source, index scope, vault inventory
  canvas/
    canvas-api.ts       # Obsidian's unofficial canvas internals: data, hierarchy, sizing, zoom
    canvas-items.ts     # Canvas nodes -> Item[]: text nodes parsed, file nodes pulled from the index
  commands/
    sync.ts             # SyncModal: untagged + untimed items with reveal
  suggester/
    tag-suggest.ts      # EditorSuggest: #tag autocomplete inside list lines
  editor/
    conceal.ts          # CM6 ViewPlugin: hide %%…%% metadata (and optionally #tags) except on the active line
```

---

## Data flow

```
Vault events (modify / create / delete / rename)
        │
        ▼
  IndexStore  ──── 'changed' event ──┬──►  CentralView  (re-renders)
  Map<path, Item[]>                  ├──►  CanvasView   (rebuilds CanvasItems)
        │                            └──►  ManageView   (rebuilds the inventory)
        │  updateConfig()                        ▲
        ◄─────────────────  PMSettingTab / ManageView → plugin.persist()
                                                 │
                          .canvas modify ────────┘
```

---

## Refresh strategy

1. **Per-file debounce** (`onModify`): resets a per-path `setTimeout(debounceMs, 250)` on every vault modify. The file is only re-parsed once after typing stops.
2. **Coarse notify** (`notifyChangedSoon`): 50 ms timer after any re-parse emits one `'changed'` event. Views apply their own `debounce(80)` on top.

Initial full scan deferred to `workspace.onLayoutReady`. Subsequent updates are single-file only.

**Scope gates** (`IndexStore.isScannable`): a file is indexed only if it passes the folder gate (`inRootScope` — under `rootFolder`, or anywhere if blank) and, when `scopeMode: 'opt-in'`, is either named `*.todo.md` or has a truthy `optInProperty` in its frontmatter (read via `metadataCache`). `onModify` re-checks scannability *after* the debounce (the metadata cache lags the modify event), so toggling `todos: true`/`false` in frontmatter adds/removes a file live; `onRename` re-evaluates so renaming to/from `*.todo.md` moves a file in or out of scope.

---

## Parsing (`parser.ts`)

Pure function: `parseFile(text, opts) → Item[]`. No IO.

- Lines classified by regex: `HEADING_RE` → section (not an item), `TASK_RE` → task, `LIST_RE` → knowledge, `/^\S/` → index.
- A `sections` stack (shallowest first) tracks enclosing headings; each emitted item gets `section = sections.map(title)`.
- A stack of open ancestors tracks nesting; an item is a child if `indent > parent.indent`.
- Index lines and headings both reset the open-ancestor stack (index lines are never children; a heading breaks list nesting).

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
- Unfiled warning (count of top-level items with no topic/heading **and** no tags) when non-zero.

**Topic filter** (full nested hierarchy):
- `renderTreeSection` builds a nested tree from `store.byTreePath()` keys — every heading *and subheading* is its own indented, drill-down row, with per-subtree counts accumulated into each ancestor. `Uncategorized` sorts to the bottom.
- Radio-style: one topic path active at a time; click the active one to deselect.
- The clicked node's **full path** is set in `this.filter` under the tree dim id; `matchesFilter` prefix-matches it, so selecting a parent includes all its subtopics.

**Footer** (always visible):
- **Clear** — appears only when any filter is active; clears all filters.
- **Rescan** — triggers `store.fullScan()`.
- **Stamp dates** — back-fills `%% added:YYYY-MM-DD %%` on every top-level task and knowledge item that has no time-dimension metadata. Index items are skipped. If the line already has a `%% ... %%` block, the new pair is inserted inside the existing block rather than creating a second one.

Filter state: `Map<dimId, Set<value>>`.

### Main area

Four grouping modes toggled by Outline / Topics / Date / Sprint buttons:

**Outline mode** (`groupMode: 'tree'`): `buildTree()` walks every top-level item via `store.allFiles()`, finds its topic path via `treePathOf` (= its heading `section`), inserts it into a `TreeNode` tree. Same-named sections at the same path — including across files — merge into one node. When a sidebar topic segment is active, only items whose path starts with that segment are included (handled by `matchesFilter`). Section headers are plain display text; no collapse.

**Topics mode** (`groupMode: 'topic'`): `renderTopicView()` groups items by their **innermost heading name** regardless of nesting depth, so `## Deployment` here and `### Deployment` elsewhere collapse into one "Deployment" topic. Uncategorized (post-`---`) items group under `Uncategorized`; items with no heading fall into `(no topic)`.

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

## Canvas surface (`canvas/` + `views/canvas-view.ts`)

A `.canvas` is a second surface over the same items — not a second data model.

**Deriving items** (`CanvasItems.rebuild`):

| Node type | Items come from |
|---|---|
| `text` | `parseFile(node.text)` — the same parser a note goes through, so statuses, `%% meta %%`, tags and headings-as-topics all behave identically |
| `file` | `IndexStore.itemsForFile(node.file)` — already indexed; narrowed to the linked heading when the node has a `subpath` |
| `group` | its label, plus (for filtering and counts) everything geometrically inside it |
| `link` | nothing |

Text-node items get the synthetic path `<canvas path>#<node id>`; they have no line address in a file, so nothing writes back to them.

**Filtering.** `CanvasFilter` is the central view's `Map<dimId, Set<value>>` plus a free-tag set and a text query. A node matches when **any** of its items passes `matchesFilter`; a group matches when anything inside it matches. The toolbar's Any/Open/Done buttons are just the `auto` (Type) dimension: `task/todo`+`task/doing` and `task/done`. Non-matching nodes get `pmc-node-dimmed`, matching ones `pmc-node-active` — nothing is ever hidden, so the layout you built stays put.

**Hierarchy** is containment, not edges: a node's parent is its *smallest enclosing group* (`buildHierarchy`). Rows carry a task pip fed by parsed items (open count, or ✓), and collapsed groups persist across refreshes in the view's `collapsedGroups` set.

**Refresh.** `vault.on('modify')` for the active canvas path (a canvas rewrites its file on every edit) plus `store.on('changed')` for file nodes, both through a 150 ms debounce — no polling. A `MutationObserver` on the canvas wrapper re-applies dimming when canvas virtualisation re-adds node elements (60 ms debounce). A 4 s interval refreshes only the selection count, which has no event to hook.

**Fragile points** — all of `canvas-api.ts` rides on unofficial internals, typed as optional members so a missing one degrades quietly:

| Surface | Risk |
|---|---|
| `canvas.importData` / `setData` | name differs across versions; both attempted |
| `canvas.wrapperEl` | falls back to `canvasEl.parentElement` |
| `canvas.zoomToBbox`, `canvas.selection` | no public equivalent |
| `.canvas-node` class | internal; could be renamed |
| virtualisation | observer covers the common cases; brief flicker possible |

---

## Tag suggester (`tag-suggest.ts`)

`TagSuggest extends EditorSuggest` fires when `#` is typed inside a list-item line.

- `onTrigger`: walks back from cursor; returns null if not a list line or no preceding `#`.
- `getSuggestions`: ranks candidates from `store.tagsByDimension()` — skips time and auto dims. Score = prefix match (+100) or substring (+30) + in-file boost (+50 via `store.tagsInFile`) + log-frequency.
- `renderSuggestion`: `#tag/value` + dimension name chip; ★ if in-file.
- `selectSuggestion`: replaces the `#…` span with `#value` + trailing space if needed.

---

## Conceal (`editor/conceal.ts`)

A CodeMirror 6 `ViewPlugin` registered via `registerEditorExtension`. It hides visual noise while writing so the source stays clean:

- Always (when enabled) collapses `%%…%%` metadata blocks, including the whitespace before them.
- Optionally (`concealTags`) collapses inline `#tags`, keeping the leading space.
- Any line touched by a cursor or selection is shown **raw** — conceal is a display transform, never a data change, so everything stays editable.
- Rebuilds decorations on `docChanged | viewportChanged | selectionSet`; only visible ranges are scanned.

Config is a single stable `ConcealConfig` object held on the plugin and mutated in `persist()`; `app.workspace.updateOptions()` pushes changes to open editors. Toggled by two settings (`concealMetadata`, `concealTags`).

---

## Management tab (`views/manage-view.ts`)

A main-area `ItemView` (`pm-manage-view`, icon `sliders-horizontal`), opened by the **Open management tab** command, the **Manage** button in the central view header, or the button at the top of Settings. Two columns: the dimension source on the left, a live inventory of the vault on the right.

**Left — source + scope.** A monospace `<textarea>` seeded with `serializeDimensions(store.getConfig().dimensions)`, a collapsible format cheatsheet generated from `KIND_ALIASES`, and the four index-scope settings (`treeDimId`, `rootFolder`, `scopeMode`, `optInProperty`) as ordinary `Setting` rows — they shape *what gets indexed*, so they sit next to the inventory rather than in the settings tab. **Save** (button or `Ctrl/Cmd+S` in the textarea) runs `parseDimensionsText`; on zero errors it calls `plugin.setDimensions(dims)` → `persist()` → `store.updateConfig()` → full re-scan → `'changed'`. Any error blocks the save and lists line numbers. The draft is compared against the serialized config to drive an "unsaved changes" badge; a `'changed'` event re-syncs the textarea **only when the draft is clean**, so a background re-scan never eats what you are typing.

**Right — inventory** (`inventory.ts`, rebuilt on every `'changed'`, debounced 120 ms). `buildInventory(store)` walks `allItemsWithInheritance()` once and produces:
- counts — files, items, tasks, open, done, undated;
- per dimension, every value actually present with item/file counts, flagged `undeclared` when the dimension declares a value list that does not include it, plus the declared values nothing uses;
- **free tags** — `freeTags()` per item: tags no dimension claims. Clicking one inserts `- tag` at the cursor in the editor; a button appends all of them as an `## Untriaged {checkbox}` block. Neither saves by itself;
- **unknown metadata** — `%% key:value %%` pairs scanned straight out of `item.rawText` whose key is not a dimension id. `parser.ts` only extracts declared ids, so these are otherwise invisible; each row carries up to 5 sample values.

Scroll position survives an inventory rebuild; the scope rows are rebuilt only after a save, since the tree-dimension dropdown depends on the dimension list.

---

## Dimension DSL (`dimensions-format.ts`)

Two interchangeable spellings, both plain markdown:

```
Priority: enum[high, medium, low]      <- compact: one line
Due: date

Topic: tree                            <- compact head, bullets below
- Deployment
  - Startup                            -> Deployment/Startup

## Area  {checkbox}  (id: area)        <- block form
- backend
- ui
```

- **Kinds** accept aliases (`resolveKind`): `tree|hierarchy|nested|path`, `radio|enum|choice|select|one`, `checkbox|multi|many|set|flags`, `time|date|when`, `text|free|string`, `auto|derived|computed`. Serialization always writes the canonical name.
- **Ids** auto-slug from the name and are the metadata key used in notes (`%% due:… %%`). `(id: foo)` before the colon (or after `{kind}` in block form) pins one, and is emitted only when it differs from the slug — so a rename never breaks existing metadata.
- **Values**: `radio`/`checkbox` flat and deduped; `tree` indentation → a `/`-joined path via the same indent-stack the item parser uses; `time`/`text`/`auto` reject values.
- **Parse precedence** per line: a `#` heading (one without `{kind}` is just a title, and closes the current dimension) → a bullet inside a values-taking dimension is a *value* → otherwise a compact definition, bulleted or bare. A compact line with `[…]` is complete; one without stays open so bullets can follow. A compact line therefore also ends a preceding block, which is what lets mixed documents round-trip.
- **Serialization** picks compact for one-liners (no values, or a flat list ≤ 72 chars with no `,`/`]` inside a value) and block form otherwise, including any non-empty tree. `parse(serialize(dims))` is stable.
- `parseDimensionsText` never throws — `{ dims, errors[] }`. Errors: unknown kind, duplicate or underivable id, values on a valueless kind, a line that is neither form, and **no tree dimension** (structural invariant).

---

## Sync (`sync.ts`)

`SyncModal` shows:
- **Unfiled**: top-level items with no heading section and no tags (`store.untagged()`).
- **Untimed**: top-level items with no time-dimension metadata (`store.untimed()`).

Each row has a Reveal button that opens the file and scrolls to the item's line.

---

## Settings (`settings.ts`)

Persisted in `data.json` via `loadData` / `saveData`:

| Field | Description |
|-------|-------------|
| `dimensions` | `{ id, name, kind, values[] }[]`. Edited as text in the management tab (`dimensions-format.ts`). |
| `treeDimId` | Which dimension id drives tree grouping. Must be `tree` kind. |
| `debounceMs` | Per-file modify debounce (default 250 ms). |
| `rootFolder` | Only files under this path are indexed. Leave blank for whole vault. |
| `scopeMode` | `'all'` (default) or `'opt-in'` — in opt-in mode only `*.todo.md` files or files with a truthy `optInProperty` are scanned. |
| `optInProperty` | Frontmatter key that opts a file in under `scopeMode: 'opt-in'` (default `"todos"`). |
| `concealMetadata` | Hide `%%…%%` metadata in the editor (default true). |
| `concealTags` | Also hide inline `#tags` in the editor (default false). |
| `autoStamp` | Background reconciler: auto-append a date to un-dated items (default false). |
| `autoStampIntervalMinutes` | Periodic sweep interval while `autoStamp` is on (default 60). |

Split by what they govern. The **management tab** owns the data model: `dimensions` (as text) plus `treeDimId`, `rootFolder`, `scopeMode` and `optInProperty` — the four that decide what gets indexed and how it is grouped. The **settings tab** keeps plugin behaviour: `debounceMs`, the two conceal toggles, the auto-stamp toggle + interval, and `canvasAutoOpen`, with a button that opens the management tab. Both write through `plugin.persist()`, so either path re-arms the reconciler and re-scans.

---

## Date reconciler (`reconcile.ts` + `main.ts`)

`stampMissingDates(app, store, { exclude?, only? })` is the single write path for auto-dating, shared by the manual **Stamp dates** button (`central-view.ts`) and the background reconciler. It appends `%% <timeDim>:<today> %%` to every non-`index` item that lacks any time-dimension value. Strictly additive and guarded:
- Never edits item prose, never removes a line, never re-orders.
- **Line-level idempotency guard**: skips a line whose comment already contains the target `dimId:` key, so even a stale in-memory index (a file just written but not yet re-parsed) can't produce a double stamp.
- `exclude` / `only` gate which files are written.

`main.ts` fires it (only when `settings.autoStamp`) from three triggers, always **excluding the active file** so it never writes the note you're editing:
- **Startup**: one sweep ~3 s after `onLayoutReady`.
- **Periodic**: `window.setInterval` every `autoStampIntervalMinutes` (re-armed by `scheduleReconcile()` on every `persist()`).
- **On leaving a file**: `active-leaf-change` stamps just the file you navigated away from (`only: {leftPath}`), tracked via `lastActivePath`.

Background sweeps are silent (no `Notice`); the manual button reports a count.

---

## Lifecycle

`onload()` registers all three views, the editor suggester, the `active-leaf-change` reconciler hook, the `file-open` canvas hook (gated by `canvasAutoOpen`), and the settings tab. `onunload()` is empty — teardown handled by `register*` helpers (the interval via `registerInterval`); `CanvasView.onClose` removes its toolbar and clears canvas decoration.

Commands:
- **Open central view** — opens/reveals the right-panel view
- **Open canvas view** — opens/reveals the canvas panel (also opens itself when you open a `.canvas`, unless "Follow canvases" is off)
- **Open management tab** — opens/reveals the dimension + inventory tab in the main area (`workspace.getLeaf('tab')`, not the sidebar)

---

## AI curation (`ai/todos-cli.ts`)

A capability-limited CLI — the **only** sanctioned way for an AI (or script) to mutate note files. Bundled to `ai/todos-cli.cjs` via `npm run build:ai` (esbuild, node/cjs). It reuses `src/parser.ts`, so its item/topic view matches the plugin exactly, and reads scope (`rootFolder`) from `data.json`. It derives the plugin dir from `__dirname/..`, so the compiled `.cjs` must stay in `ai/`.

**Commands** (mutations are dry-run unless `--apply`, which first writes a `.bak`):

| Command | Kind | Purpose |
|---------|------|---------|
| `list [--json]` | read | Every top-level item: `id` (`file:LINE`), topic, date, tags, uncategorized flag |
| `topics` | read | Topic hierarchy from headings + tags |
| `uncategorized` | read | Items after a `---` in their section, or with no topic/tags |
| `duplicates` | read | Suggested duplicate pairs (advice only, never acts) |
| `sync-topics` | write | Regenerate the `todos:auto:*` block of `_topics.md`; content outside the block is preserved |
| `label --id --expect --tag [--date]` | write | Add one tag + date stamp to a top-level item |
| `move --id --expect --to [--to-file]` | write | Relocate an item block to an existing heading |

**Enforced invariants (mechanical, not prompt-based):**
- `--expect "<text>"` must match the item's parsed text or the command aborts (stale/wrong-line guard).
- After writing, the file is re-parsed and the item's prose asserted **byte-identical**; `label` also asserts no other line changed; `move` asserts the non-empty-line multiset is preserved (no data loss).
- Only three writes exist — there is no free-form text-edit path. `label` refuses sub-items and prose lines; `move` refuses to invent headings.

**Soft layer** (routes the AI to the CLI): `.claude/skills/todos-curator/SKILL.md`, `CLAUDE.md`, `ai/SAMPLE_PROMPT.md`. Topic-file convention: **`_topics.md`** at the scan root.
