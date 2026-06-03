# Project Items — Conceptual Guide

This guide explains the mental model behind the plugin. Read this before diving into settings or dimensions.

---

## Sample document

The ten lines below exercise every feature. Use it as a reference when writing your own notes.

```markdown
Scene 3 — The Confrontation

- [x] Write draft dialogue #polish/story/scene-3 %% added:2026-05-01 due:2026-05-10 %%
  - [/] revise exposition lines
  - [ ] add player choice branch #urgent
- [ ] Record VO takes #polish/asset/sound %% added:2026-05-12 %%
  - [ ] line 3a — accusation
  - [ ] line 3b — denial
- mix background ambience track #polish/asset/sound #wip
- Character design notes for Mira #polish/character
```

What each line demonstrates:

| Line | Feature |
|------|---------|
| `Scene 3 — The Confrontation` | **Index item** — non-list line at column 0; prose/heading kind |
| `- [x] Write draft…` | **Task done** — tree tag `#polish/story/scene-3` + two time metadata (`added:`, `due:`) |
| `  - [/] revise…` | **Task doing** — child; inherits `#polish/story/scene-3` from parent, needs no tag of its own |
| `  - [ ] add player…` | **Task todo** — child with free tag `#urgent` (not classified → bordered chip) |
| `- [ ] Record VO…` | **Task todo** — different tree branch `#polish/asset/sound` + `added:` metadata |
| `  - [ ] line 3a` | **Task todo** — child; inherits `#polish/asset/sound` |
| `  - [ ] line 3b` | **Task todo** — child; same inheritance |
| `- mix background…` | **Knowledge bullet** — tree tag + free tag `#wip` side by side |
| `- Character design…` | **Knowledge bullet** — another tree branch, no metadata |

Key things to notice:

- The three children on lines 4–5 and 7–8 need **no tags** — they appear under the right tree branch because they inherit from their parent.
- `added:2026-05-01` and `due:2026-05-10` are **metadata**, not tags. No `#`. They show up in Date mode grouping.
- `#urgent` and `#wip` match no dimension → they are **free tags**, visible as chips but not filterable.
- `#polish/story/scene-3` is automatically a **tree tag** because it contains `/`. No dimension setup needed.

---

## Items

The plugin reads every markdown file and turns certain lines into **items**. There are three kinds:

| Kind | What it looks like | When to use |
|------|--------------------|-------------|
| **Task** | `- [ ] do something` | Anything with a completion state |
| **Knowledge** | `- some fact` | A note, bullet, or reference (no checkbox) |
| **Index** | A line that starts at column 0 without `- ` | Prose paragraph, heading-like summary |

Task statuses map like this:
- `- [ ]` → **todo** (muted)
- `- [/]` → **doing** (orange)
- `- [x]` → **done** (green + strikethrough)
- `- [-]` → **cancelled** (yellow + strikethrough)

Clicking a task checkbox in the central view writes the change back to the file immediately.

---

## Tags and how they get classified

Write a tag as `#something` anywhere on a list line. The plugin strips it from the display text and classifies it against your dimensions.

### The `/` rule — auto tree hierarchy

> **Any tag containing `/` is automatically treated as a tree tag.**

You do not need to predefine anything. Just write:

```
- [ ] mix the sound effects #polish/asset/sound
- [ ] write scene 3 dialogue #polish/story/scene-3
- review character designs #polish/character
```

The plugin builds the hierarchy `polish → asset → sound`, `polish → story → scene-3`, `polish → character` automatically. In the central view you can select `polish` in the sidebar to see everything under it, or drill into `polish/asset` to narrow further.

If you ever define explicit `values` on the tree dimension, auto-discovery turns off and only those exact values are matched.

### Tags that don't match any dimension → free tags

Tags that don't match any dimension classification land in a **free bucket** — shown as small monospace bordered chips (`#likethis`). They are visible on items but not filterable. This is intentional: you can tag freely without having to set up a dimension first.

---

## Dimensions

A **dimension** is a lens you use to classify items. Think of it as a column in a spreadsheet.

| Kind | One-liner | Example |
|------|-----------|---------|
| `tree` | Hierarchy from `/` tags | `polish/asset/sound`, `polish/story` |
| `radio` | Pick one from a fixed list | `status: draft / review / done` |
| `checkbox` | Pick many from a fixed list | `platform: pc, console` |
| `time` | A date stored as `key:date` metadata | `added:2026-05-14` |
| `text` | Free string metadata, display only | `author:khanh` |
| `auto` | Derived from syntax, not taggable | `task/todo`, `knowledge`, `index` |

### Default dimensions and what they do

| id | kind | Special behaviour |
|----|------|-------------------|
| `tree` | tree | Drives the sidebar tree filter and main-area tree grouping. Auto-discovers any `#tag/subtag`. |
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

Old-style plain `key:value` anywhere in the line is still supported for backwards compatibility, but `%% ... %%` is the preferred format.

---

## Tag inheritance

Children of an item automatically inherit the parent's tags for the purposes of filtering and classification. You only need to tag the parent:

```
- [ ] polish audio #polish/asset/sound
  - [ ] normalize levels
  - [ ] add reverb to room ambience
```

The two child tasks are invisible from the root but they show under `polish/asset/sound` in the central view because they inherit the parent's tag. You don't need to repeat `#polish/asset/sound` on every child.

---

## Filtering

The sidebar has two filter sections:

### Type filter

- **Tasks** master checkbox — toggles all four subtypes (Todo / Doing / Done / Discarded) at once.  
  - If some but not all subtypes are active, Tasks shows an indeterminate (dash) state.
  - Clicking a subtype only affects that subtype; it does not auto-select the Tasks master.
- **Knowledge** and **Index** — independent toggles.
- Filter is OR within a type group, AND across groups.

### Tree filter

- Shows only **top-level** segments (the first part of the `/` path, e.g. `polish`, `story`).
- Click one to filter the main area to that whole branch — prefix matching means `polish` shows `polish/asset/sound`, `polish/story/scene-3`, everything under it.
- Click the active segment again to clear the tree filter.
- Combined with the Type filter: both must match (AND).

### Prefix matching

Selecting `polish` in the tree filter matches:
- `polish` (exact)
- `polish/asset`
- `polish/asset/sound`
- `polish/story/scene-3`
- … anything starting with `polish/`

Selecting `task` in the Type filter (via the Tasks checkbox) matches `task/todo`, `task/doing`, `task/done`, `task/cancelled`.

---

## Main area modes

Toggle between **Tree** and **Date** at the top of the main area.

**Tree mode**: items are grouped by their tree-dimension path. When a sidebar tree segment is selected, only that branch is shown. Section headers are the path segments (`polish`, then `asset` under it, etc.).

**Date mode**: items are grouped by their first time-dimension date, sorted ascending. Items with no date go to the bottom under "No date".

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

- **Untagged**: top-level items with no tags at all.
- **Untimed**: top-level items with no time-dimension metadata.

Each row has a **Reveal** button that jumps to the item in its file.

---

## Dimension manager

Open via command palette ("Open dimension manager") or Settings → Dimensions → Open dimension manager.

- **Default dimensions**: can rename; can edit `values` (for tree/radio/checkbox kinds); cannot change `kind`, `id`, or delete.
- **Custom dimensions**: full edit and delete. `id` is set at creation (auto-slugified) and cannot be changed after.
- **Values field**: one per line. For `radio`/`checkbox`, these are the exact tag values that get classified into this dimension. For `tree`, leave empty for auto-discovery or list exact paths to restrict it.
- Changes take effect immediately after saving — the vault is re-scanned with the new dimension config.

---

## `data.json` — where settings are stored

Settings live at `.obsidian/plugins/obsidian-sample-plugin/data.json`. It is a plain JSON file editable with any text editor (close Obsidian first, or disable/re-enable the plugin after editing). The dimension manager is the recommended way to change dimensions, but direct edits work as a last resort or for bulk changes.

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
  "rootFolder": "visual novel"
}
```

`rootFolder`: only files under this path are indexed. Leave `""` for the whole vault.  
`debounceMs`: how long (ms) after a file change before re-parsing. Increase if you have very large files.  
`treeDimId`: which dimension drives tree grouping. Must be the `id` of a `tree`-kind dimension.
