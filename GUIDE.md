# Project Items — Conceptual Guide

This guide explains the mental model behind the plugin. Read this before diving into settings or dimensions.

---

## The one idea to hold onto

**Your markdown headings *are* your topics.** An item's topic is simply the heading it lives under — you don't tag it. Nesting headings (`##` → `###`) nests topics. Everything else (dates, status, the odd label) is secondary and stays out of your way.

---

## Sample document

The lines below exercise every feature. Use it as a reference when writing your own notes.

```markdown
## Deployment
- [x] provision server %% added:2026-05-01 due:2026-05-10 %%
- [ ] set up CI pipeline #urgent
  - [/] configure build caching

### Startup sequence
- [ ] write boot script
- health-check endpoint reference

## VFX
- [ ] particle pass #wip
- character design notes for Mira
```

What each line demonstrates:

| Line | Feature |
|------|---------|
| `## Deployment` | **Topic heading** — defines the topic; it is *not* an item itself |
| `- [x] provision server…` | **Task done** under topic `Deployment` + two time metadata (`added:`, `due:`) — no topic tag needed |
| `- [ ] set up CI pipeline #urgent` | **Task todo** under `Deployment` with a secondary label `#urgent` |
| `  - [/] configure build caching` | **Task doing** — child; inherits the `Deployment` topic, no tag of its own |
| `### Startup sequence` | **Nested topic** → items below sit under `Deployment/Startup sequence` |
| `- [ ] write boot script` | **Task todo** under the nested topic |
| `- health-check endpoint reference` | **Knowledge bullet** under the nested topic |
| `## VFX` | A new top-level topic |
| `- [ ] particle pass #wip` | **Task todo** under `VFX` with a free tag `#wip` |
| `- character design notes for Mira` | **Knowledge bullet** under `VFX` |

Key things to notice:

- **No item carries a topic tag.** The heading above it does the filing. Sub-items inherit their parent item's topic automatically.
- `added:2026-05-01` and `due:2026-05-10` are **metadata**, not tags. No `#`. They power Date/Sprint grouping and are hidden while you edit (see **Conceal**).
- `#urgent` and `#wip` match no dimension → they are **free tags** / labels: visible as chips, optionally hidden while editing.
- A `---` separator inside a section marks the items after it (until the next heading) as **uncategorized** — a parking spot for things you haven't filed yet.

---

## Items

The plugin reads every markdown file and turns certain lines into **items**. There are three kinds:

| Kind | What it looks like | When to use |
|------|--------------------|-------------|
| **Task** | `- [ ] do something` | Anything with a completion state |
| **Knowledge** | `- some fact` | A note, bullet, or reference (no checkbox) |
| **Index** | A non-list line at column 0 that is *not* a heading | Prose paragraph, a `---` separator |

> **Headings are not items.** A `#`…`######` line is consumed as topic structure (see below), never shown as an item. Everything beneath it inherits that topic.

Task statuses map like this:
- `- [ ]` → **todo** (muted)
- `- [/]` → **doing** (orange)
- `- [x]` → **done** (green + strikethrough)
- `- [-]` → **cancelled** (yellow + strikethrough)

Clicking a task checkbox in the central view writes the change back to the file immediately.

---

## Topics come from headings

The topic of an item is the **path of headings above it**. Write your notes the way you already do:

```
## Deployment
- [ ] set up CI pipeline
### Startup sequence
- [ ] write boot script
```

`set up CI pipeline` gets topic `Deployment`; `write boot script` gets `Deployment/Startup sequence`. In the central view, select `Deployment` in the sidebar to see everything under it (nested topics included). **You never type a topic tag** — that was the old way, and it cluttered every line.

The sidebar **Topic** list mirrors this hierarchy: every heading and subheading is its own indented, drill-down row (click a parent to include all its subtopics). Items after a `---` show up under a reserved **Uncategorized** topic — so "needs filing" is itself a topic you can select, and it sorts to the bottom of the list.

**Legacy fallback:** an item that sits *above any heading* still falls back to the old rule — a `#tag` containing `/` (e.g. `#polish/asset/sound`) is read as a topic path. This keeps older notes working; new notes should use headings.

---

## Tags and labels

Tags are now **secondary** — a `#label` for cross-cutting things (status, `#urgent`, `#wip`) rather than the topic itself. Write `#something` anywhere on a list line; the plugin strips it from the display text and classifies it against your dimensions (radio/checkbox), or shows it as a free chip.

### Tags that don't match any dimension → free tags

Tags that don't match any dimension classification land in a **free bucket** — shown as small monospace bordered chips (`#likethis`). They are visible on items but not filterable. This is intentional: you can tag freely without having to set up a dimension first.

---

## Dimensions

A **dimension** is a lens you use to classify items. Think of it as a column in a spreadsheet.

| Kind | One-liner | Example |
|------|-----------|---------|
| `tree` | Topic hierarchy from headings (fallback: `/` tags) | `Deployment/Startup`, `VFX` |
| `radio` | Pick one from a fixed list | `status: draft / review / done` |
| `checkbox` | Pick many from a fixed list | `platform: pc, console` |
| `time` | A date stored as `key:date` metadata | `added:2026-05-14` |
| `text` | Free string metadata, display only | `author:khanh` |
| `auto` | Derived from syntax, not taggable | `task/todo`, `knowledge`, `index` |

### Default dimensions and what they do

| id | kind | Special behaviour |
|----|------|-------------------|
| `tree` | tree | Drives the sidebar topic filter and Outline/Topics grouping. Fed by heading sections (fallback: `#tag/subtag` for items above any heading). |
| `type` | auto | Powers the Type filter (Tasks/Knowledge/Index). You cannot tag items with it — it comes from the line syntax. |
| `added` | time | Reads `added:YYYY-MM-DD` metadata from any item. Powers Date grouping. |
| `due` | time | Reads `due:YYYY-MM-DD` metadata. Also shows in Date grouping. |

These four cannot be deleted, though you can rename them and (for tree) change their `values`.

---

## Metadata

Metadata is written inside an Obsidian comment block `%% ... %%` at the end of a list line:

```
- [ ] ship the demo %% added:2026-05-10 due:2026-05-20 %%
- [ ] record VO takes #polish/asset/sound %% added:2026-05-12 %%
```

**The comment block is invisible in Reading Mode and Live Preview** — only the item text and tags are shown. In Source Mode the full line is visible for editing.

Multiple `key:value` pairs can share one block separated by spaces. The plugin strips the block entirely from the display text and indexes each pair under the matching dimension by `id`. `added:2026-05-10` is picked up by the dimension whose `id` is `added`.

The **Stamp dates** button in the sidebar footer writes this format automatically for any top-level item (tasks and knowledge bullets) that has no time metadata yet. Index lines (headings / prose) are never stamped.

### Auto-dating (the reconciler)

If you'd rather not press the button, turn on **Settings → Auto-add dates**. While it's on, the plugin quietly appends `%% added:<today> %%` to any un-dated item — using *today's date at the moment it first notices the item* ("close enough", not the true creation time). It runs at three calm moments, never on keystroke:

- once shortly after Obsidian starts,
- on a timer (default every 60 min — set the interval in settings),
- whenever you navigate away from a note (it stamps the note you just left).

It **never writes the note you're currently in**, only ever *adds* the hidden comment (never edits your words or removes a line), and won't double-stamp a line that already has a date. It's off by default.

Old-style plain `key:value` anywhere in the line is still supported for backwards compatibility, but `%% ... %%` is the preferred format.

---

## Conceal — keep the source clean while editing

Metadata and labels are useful but noisy to look at. The **conceal** feature hides them *in the editor*, revealing the raw text only on the line your cursor is on — so the line stays fully editable, and nothing is ever removed from the file.

- **Conceal metadata in editor** (on by default): hides `%% … %%` blocks in Source Mode and Live Preview.
- **Conceal tags in editor** (off by default): also hides inline `#tags`. Turn this on once topics live in headings and tags are just occasional labels.

Both are toggles in the plugin settings. It is purely a display transform — your bytes are untouched, and moving the cursor onto a line shows everything raw again.

---

## Inheritance

Children inherit two things from above them:

- **Topic** — from the nearest heading, exactly like their parent item.
- **Tags** — any label on the parent item applies to its children too, for filtering and classification.

```
## Audio
- [ ] polish audio #wip
  - [ ] normalize levels
  - [ ] add reverb to room ambience
```

Both child tasks live under topic `Audio` and count as `#wip` in filters, even though neither repeats the heading or the tag. You only label the parent.

---

## Filtering

The sidebar has two filter sections:

### Type filter

- **Tasks** master checkbox — toggles all four subtypes (Todo / Doing / Done / Discarded) at once.  
  - If some but not all subtypes are active, Tasks shows an indeterminate (dash) state.
  - Clicking a subtype only affects that subtype; it does not auto-select the Tasks master.
- **Knowledge** and **Index** — independent toggles.
- Filter is OR within a type group, AND across groups.

### Topic filter

- Shows only **top-level** topics (the outermost heading, e.g. `Deployment`, `VFX`).
- Click one to filter the main area to that whole branch — prefix matching means `Deployment` shows `Deployment/Startup sequence` and everything under it.
- Click the active topic again to clear the filter.
- Combined with the Type filter: both must match (AND).

### Prefix matching

Selecting `Deployment` in the topic filter matches:
- `Deployment` (exact)
- `Deployment/Startup sequence`
- … anything starting with `Deployment/`

Selecting `task` in the Type filter (via the Tasks checkbox) matches `task/todo`, `task/doing`, `task/done`, `task/cancelled`.

---

## Main area modes

Four buttons at the top of the main area: **Outline**, **Topics**, **Date**, **Sprint**.

**Outline mode**: the full topic hierarchy from your headings. Same-named sections at the same path — even across different files — merge into one node. Selecting a sidebar topic narrows to that branch (prefix match).

**Topics mode**: the *merged* view. Items are grouped by their **innermost heading name regardless of depth**, so a `## Deployment` in one note and a `### Deployment` in another collapse into a single "Deployment" group. Items with no heading fall under `(no topic)`. This is the "see every occurrence of a topic together" view.

**Date mode**: items grouped by their first time-dimension date, ascending; undated items at the bottom under "No date".

**Sprint mode**: items bucketed into automatically detected sprints — a run of active days broken wherever there's a 2+ day gap with no dated items. Undated items go under "No date".

---

## Tag autocomplete

Type `#` inside any list line (`- `, `- [ ] `, etc.) to get tag suggestions. The popup:

- Shows only taggable dimensions (not `time` or `auto`).
- Ranks by: **prefix match** (top) → **in-file boost** (★ means the tag already appears elsewhere in this file) → **global frequency**.
- Press Enter or Tab to insert. A trailing space is added automatically if needed.
- Does **not** fire on paragraph lines (only list lines), so normal prose writing is unaffected.

---

## Sync — finding items that need attention

The Sync modal (no command — removed from the command palette; use the central view or add it back via settings if needed) shows:

- **Unfiled**: top-level items with **no topic and no tags** (not under any heading and untagged) — the genuinely loose items. The sidebar shows the same count as an "Unfiled: N" warning.
- **Untimed**: top-level items with no time-dimension metadata.

Each row has a **Reveal** button that jumps to the item in its file.

---

## Editing dimensions

Open the Project Items view and click the **Dimensions** button in the top bar (top-right). It swaps the item list for a single text box you edit directly — one markdown heading per dimension, values as bullets below:

```
## Priority  {radio}
- high
- medium
- low

## Sprint  {radio}
- sprint-1
- sprint-2

## Topic  {tree}
- Deployment
  - Startup
  - Shutdown
- Audio
  - Mixing
```

- **Heading line** is `## Name  {kind}`. Kinds: `tree`, `radio`, `checkbox`, `time`, `text`, `auto`. The `id` auto-slugs from the name; add `(id: foo)` to pin it (used for the default `tree`/`type`/`added`/`due` dims so renames don't break their metadata keys).
- **Bullets** are the values. For `radio`/`checkbox` they're the exact tag values classified into this dimension. `time`/`text`/`auto` take no bullets.
- **Tree = topics.** Indent a bullet to make it a subtopic — `Deployment → Startup` becomes the path `Deployment/Startup`. Leave a tree's bullets empty (or a comment) to **auto-discover** topics from your headings, which is the normal case.
- Click **Save**: the text is parsed, and if anything's wrong (unknown kind, duplicate id, a value under a `time` dim, no tree dimension) it lists the errors and saves nothing. On success it persists, the vault re-scans, and the box re-renders in canonical form. **Revert** discards unsaved edits. Click **Dimensions** again (or any grouping button) to return to the item list.

---

## AI curation — organizing without risking your prose

You can have an AI (Claude) tidy your notes, but it is deliberately **not allowed to rewrite your words**. All changes go through a small command-line tool (`ai/todos-cli.cjs`) that only knows how to do three safe things, and mechanically refuses to alter an item's text or lose a line.

The three things it can do:

1. **Topic index** — regenerate `_topics.md`, a hierarchical list of every topic (from your headings + tags). You can add higher-level groupings by hand above the auto-generated block.
2. **Label** — add one tag + a date stamp to a top-level item. It never touches sub-items or prose.
3. **Move & de-dupe** — relocate a whole item (with its sub-items) to the correct existing heading, and *suggest* likely duplicates for you to resolve — it never merges or deletes on its own.

Every change is previewed as a dry-run first; applying it writes a `.bak` backup beside the file. See `ai/SAMPLE_PROMPT.md` for ready-made prompts and `CLAUDE.md` for the full rule set. Build the tool once with `npm run build:ai`.

---

## `data.json` — where settings are stored

Settings live at `.obsidian/plugins/obsidian-todos/data.json`. It is a plain JSON file editable with any text editor (close Obsidian first, or disable/re-enable the plugin after editing). The in-settings Dimensions editor is the recommended way to change dimensions; direct JSON edits work as a last resort.

Format reference:

```json
{
  "dimensions": [
    { "id": "tree",  "name": "Tree",  "kind": "tree",  "values": [] },
    { "id": "type",  "name": "Type",  "kind": "auto",  "values": [] },
    { "id": "added", "name": "Added", "kind": "time",  "values": [] },
    { "id": "due",   "name": "Due",   "kind": "time",  "values": [] },
    { "id": "status","name": "Status","kind": "radio", "values": ["draft","review","done"] }
  ],
  "treeDimId": "tree",
  "debounceMs": 250,
  "rootFolder": "visual novel",
  "scopeMode": "all",
  "optInProperty": "todos",
  "concealMetadata": true,
  "concealTags": false,
  "autoStamp": false,
  "autoStampIntervalMinutes": 60
}
```

`rootFolder`: only files under this path are indexed. Leave `""` for the whole vault.  
`scopeMode`: `"all"` scans every markdown file (in the root folder); `"opt-in"` scans **only** files named `*.todo.md` or whose frontmatter has a truthy `optInProperty`.  
`optInProperty`: the frontmatter key that opts a file in under `"opt-in"` (default `todos` → add `todos: true` to a note's frontmatter).  
`debounceMs`: how long (ms) after a file change before re-parsing. Increase if you have very large files.  
`treeDimId`: which dimension drives tree grouping. Must be the `id` of a `tree`-kind dimension.  
`autoStamp` / `autoStampIntervalMinutes`: the auto-dater (see "Auto-dating" above) and its sweep interval.
