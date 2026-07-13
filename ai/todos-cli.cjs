var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ai/todos-cli.ts
var fs = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);

// src/parser.ts
var TASK_RE = /^(\s*)[-*+]\s+\[(.)\]\s?(.*)$/;
var LIST_RE = /^(\s*)[-*+]\s+(.*)$/;
var TAG_RE = /(?:^|\s)#([A-Za-z][A-Za-z0-9/_-]*)/g;
var HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
function parseStatus(box) {
  switch (box.toLowerCase()) {
    case "x":
      return "done";
    case "/":
      return "doing";
    case "-":
      return "cancelled";
    default:
      return "todo";
  }
}
function extractTags(text) {
  const tags = [];
  const stripped = text.replace(TAG_RE, (_m, t) => {
    tags.push(t);
    return "";
  }).replace(/\s+/g, " ").trim();
  return { tags, stripped };
}
function extractMeta(text, ids) {
  if (ids.length === 0) return { meta: [], stripped: text };
  const meta = [];
  const idPat = ids.map(escapeRe).join("|");
  let stripped = text.replace(/%%([^%]*)%%/g, (_m, inner) => {
    const re = new RegExp(`(${idPat}):(\\S+)`, "g");
    let m;
    while ((m = re.exec(inner)) !== null) meta.push({ key: m[1], value: m[2] });
    return "";
  });
  stripped = stripped.replace(new RegExp(`(?:^|\\s)(${idPat}):(\\S+)`, "g"), (_m, k, v) => {
    meta.push({ key: k, value: v });
    return "";
  });
  return { meta, stripped: stripped.replace(/\s+/g, " ").trim() };
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function parseFile(text, opts) {
  const lines = text.split(/\r?\n/);
  const top = [];
  const stack = [];
  const sections = [];
  let uncategorized = false;
  let start = 0;
  if (lines[0] !== void 0 && /^---\s*$/.test(lines[0])) {
    const end = lines.findIndex((l, idx) => idx > 0 && /^---\s*$/.test(l));
    if (end !== -1) start = end + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === void 0) continue;
    if (raw.trim() === "") continue;
    const heading = raw.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const title = (heading[2] ?? "").trim();
      while (sections.length > 0 && sections[sections.length - 1].level >= level) sections.pop();
      if (title !== "") sections.push({ level, title });
      stack.length = 0;
      uncategorized = false;
      continue;
    }
    if (/^-{3,}$/.test(raw.replace(/%%[^%]*%%/g, "").trim())) {
      uncategorized = true;
      stack.length = 0;
      continue;
    }
    const item = lineToItem(raw, i, opts);
    if (!item) continue;
    item.section = sections.map((s) => s.title);
    item.uncategorized = uncategorized;
    while (stack.length > 0) {
      const top_ = stack[stack.length - 1];
      if (top_.loc.indent < item.loc.indent) break;
      stack.pop();
    }
    if (item.kind === "index") {
      stack.length = 0;
      top.push(item);
      continue;
    }
    if (stack.length === 0) {
      top.push(item);
    } else {
      stack[stack.length - 1].children.push(item);
    }
    stack.push(item);
  }
  return top;
}
function lineToItem(raw, lineNo, opts) {
  const taskMatch = raw.match(TASK_RE);
  if (taskMatch) {
    const indent = taskMatch[1].length;
    const status = parseStatus(taskMatch[2]);
    const body = taskMatch[3] ?? "";
    return makeItem("task", body, raw, lineNo, indent, opts, status);
  }
  const listMatch = raw.match(LIST_RE);
  if (listMatch) {
    const indent = listMatch[1].length;
    const body = listMatch[2] ?? "";
    return makeItem("knowledge", body, raw, lineNo, indent, opts);
  }
  if (/^\S/.test(raw)) {
    return makeItem("index", raw, raw, lineNo, 0, opts);
  }
  return null;
}
function makeItem(kind, body, raw, lineNo, indent, opts, status) {
  const { meta, stripped: noMeta } = extractMeta(body, opts.dimensionIds);
  const { tags, stripped: text } = extractTags(noMeta);
  return {
    kind,
    text,
    rawText: raw,
    loc: { path: opts.path, line: lineNo, indent },
    tags,
    meta,
    section: [],
    uncategorized: false,
    status,
    children: []
  };
}

// ai/todos-cli.ts
var TOPICS_FILE = "_topics.md";
var AUTO_BEGIN = "<!-- todos:auto:begin -->";
var AUTO_END = "<!-- todos:auto:end -->";
var TIME_KEYS = ["added", "due"];
function pluginDir() {
  return path.resolve(__dirname, "..");
}
function vaultRoot() {
  const parts = pluginDir().split(path.sep);
  const i = parts.indexOf(".obsidian");
  return i >= 0 ? parts.slice(0, i).join(path.sep) : pluginDir();
}
function scanRoot() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(pluginDir(), "data.json"), "utf8"));
    if (data.rootFolder) return path.join(vaultRoot(), data.rootFolder);
  } catch {
  }
  return vaultRoot();
}
function mdFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}
function rel(p) {
  return path.relative(vaultRoot(), p).split(path.sep).join("/");
}
function abs(relPath) {
  return path.join(vaultRoot(), relPath.split("/").join(path.sep));
}
function readLines(p) {
  return fs.readFileSync(p, "utf8").split(/\r?\n/);
}
var HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
var indentOf = (s) => s.match(/^\s*/)?.[0].length ?? 0;
var isSeparator = (s) => /^\s*---\s*$/.test(s);
var isTopLevelItem = (s) => /^[-*+]\s+/.test(s);
function scanHeadings(lines) {
  const out = [];
  const stack = [];
  lines.forEach((raw, line) => {
    const m = raw.match(HEADING);
    if (!m) return;
    const level = m[1].length;
    const title = (m[2] ?? "").trim();
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (title) stack.push({ level, title });
    out.push({ line, level, title, pathParts: stack.map((s) => s.title) });
  });
  return out;
}
function collect() {
  const rows = [];
  for (const p of mdFiles(scanRoot())) {
    if (path.basename(p) === TOPICS_FILE) continue;
    const lines = readLines(p);
    const items = parseFile(lines.join("\n"), { dimensionIds: TIME_KEYS, path: rel(p) });
    for (const it of items) {
      if (it.kind === "index") continue;
      rows.push({
        id: `${rel(p)}:${it.loc.line + 1}`,
        file: rel(p),
        line1: it.loc.line + 1,
        kind: it.kind,
        status: it.status,
        text: it.text,
        topic: it.section.join("/"),
        tags: it.tags,
        date: it.meta.find((m) => TIME_KEYS.includes(m.key))?.value,
        uncategorized: afterSeparator(lines, it.loc.line)
      });
    }
  }
  return rows;
}
function afterSeparator(lines, line) {
  for (let i = line - 1; i >= 0; i--) {
    const s = lines[i];
    if (HEADING.test(s)) return false;
    if (isSeparator(s)) return true;
  }
  return false;
}
function cmdList(json) {
  const rows = collect();
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) {
    const flags = [r.status ?? r.kind, r.date ? `\u{1F4C5}${r.date}` : "no-date", r.uncategorized ? "UNCATEGORIZED" : r.topic || "no-topic"];
    console.log(`${r.id}	[${flags.join(" ")}]	${r.text}${r.tags.length ? "  #" + r.tags.join(" #") : ""}`);
  }
  console.error(`
${rows.length} items`);
}
function cmdTopics() {
  console.log(renderTopics());
}
function renderTopics() {
  const root = {};
  const add = (parts) => {
    let node = root;
    for (const seg of parts) {
      node[seg] = node[seg] ?? {};
      node = node[seg];
    }
  };
  for (const r of collect()) {
    if (r.topic) add(r.topic.split("/"));
    for (const t of r.tags) add(t.split("/"));
  }
  const lines = [];
  const walk = (node, depth) => {
    for (const key of Object.keys(node).sort((a, b) => a.localeCompare(b))) {
      lines.push(`${"  ".repeat(depth)}- ${key}`);
      walk(node[key], depth + 1);
    }
  };
  walk(root, 0);
  return lines.join("\n") || "(no topics found)";
}
function cmdDuplicates() {
  const rows = collect();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
  const toks = (s) => new Set(norm(s).split(" ").filter(Boolean));
  const jac = (a, b) => {
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter || 1);
  };
  const seen = [];
  let found = 0;
  for (const r of rows) {
    const t = toks(r.text);
    for (const s of seen) {
      const score = norm(r.text) === norm(s.r.text) ? 1 : jac(t, s.t);
      if (score >= 0.7) {
        console.log(`~${score.toFixed(2)}  ${s.r.id}  \u27F7  ${r.id}
   "${s.r.text}"
   "${r.text}"`);
        found++;
      }
    }
    seen.push({ r, t });
  }
  console.error(`
${found} suggested duplicate pair(s) \u2014 SUGGESTION ONLY, no changes made.`);
}
function cmdUncategorized() {
  const rows = collect().filter((r) => r.uncategorized || !r.topic && r.tags.length === 0);
  for (const r of rows) console.log(`${r.id}	${r.text}`);
  console.error(`
${rows.length} uncategorized item(s)`);
}
function itemBlock(lines, top) {
  const I = indentOf(lines[top]);
  let end = top;
  for (let j = top + 1; j < lines.length; j++) {
    const s = lines[j];
    if (s.trim() === "") continue;
    if (HEADING.test(s) || isSeparator(s) || indentOf(s) <= I) break;
    end = j;
  }
  return { end };
}
function resolveId(id) {
  const i = id.lastIndexOf(":");
  if (i < 0) fail(`bad --id "${id}" (want "path:LINE")`);
  return { file: id.slice(0, i), line0: Number(id.slice(i + 1)) - 1 };
}
function itemTextAt(lines, file, line0) {
  const parsed = parseFile(lines.join("\n"), { dimensionIds: TIME_KEYS, path: file });
  const flat = [];
  const visit = (it) => {
    flat.push(it);
    it.children.forEach(visit);
  };
  parsed.forEach(visit);
  const hit = flat.find((it) => it.loc.line === line0);
  return hit ? hit.text : "\0MISSING";
}
function cmdLabel(a) {
  const { file, line0 } = resolveId(req(a, "id"));
  const p = abs(file);
  const lines = readLines(p);
  const raw = lines[line0];
  if (raw === void 0) fail(`${file} has no line ${line0 + 1}`);
  if (!isTopLevelItem(raw)) fail(`line ${line0 + 1} is not a top-level item (sub-items and prose cannot be labelled)`);
  const before = itemTextAt(lines, file, line0);
  verifyExpect(a, before);
  let next = raw;
  const tag = a["tag"];
  if (tag && !new RegExp(`(^|\\s)#${escapeRe2(tag)}(\\s|$)`).test(next)) {
    next = next.replace(/\s*$/, "") + ` #${tag}`;
  }
  if (a["date"] !== "skip") {
    const date = a["date"] || today();
    if (!TIME_KEYS.some((k) => new RegExp(`\\b${k}:`).test(next))) {
      const m = next.match(/%%([^%]*)%%/);
      next = m ? next.replace(/%%([^%]*)%%/, `%%${m[1].trimEnd()} added:${date} %%`) : next.replace(/\s*$/, "") + ` %% added:${date} %%`;
    }
  }
  if (next === raw) {
    console.error("No change (already labelled).");
    return;
  }
  lines[line0] = next;
  const after = itemTextAt(lines, file, line0);
  if (after !== before) fail(`ABORT: edit would change item text
  before: "${before}"
  after:  "${after}"`);
  assertOnlyLineChanged(readLines(p), lines, line0);
  commit(a, p, lines, [`- ${file}:${line0 + 1}`, `  - "${raw}"`, `  + "${next}"`]);
}
function cmdMove(a) {
  const { file, line0 } = resolveId(req(a, "id"));
  const srcAbs = abs(file);
  const srcLines = readLines(srcAbs);
  if (srcLines[line0] === void 0) fail(`${file} has no line ${line0 + 1}`);
  if (!isTopLevelItem(srcLines[line0])) fail(`line ${line0 + 1} is not a top-level item`);
  const before = itemTextAt(srcLines, file, line0);
  verifyExpect(a, before);
  const targetTopic = req(a, "to");
  const destFile = a["to-file"] || file;
  const destAbs = abs(destFile);
  if (!fs.existsSync(destAbs)) fail(`destination file not found: ${destFile}`);
  const { end } = itemBlock(srcLines, line0);
  const block = srcLines.slice(line0, end + 1);
  const srcAfter = [...srcLines.slice(0, line0), ...srcLines.slice(end + 1)];
  const destLines = destFile === file ? srcAfter : readLines(destAbs);
  const heads = scanHeadings(destLines);
  const target = heads.find((h) => h.pathParts.join("/") === targetTopic);
  if (!target) fail(`topic heading "${targetTopic}" not found in ${destFile}. Run sync-topics or create the heading first \u2014 this tool never invents structure.`);
  let insertAt = destLines.length;
  for (const h of heads) {
    if (h.line > target.line && h.level <= target.level) {
      insertAt = h.line;
      break;
    }
  }
  while (insertAt > target.line + 1 && destLines[insertAt - 1].trim() === "") insertAt--;
  const destFinal = [...destLines.slice(0, insertAt), ...block, ...destLines.slice(insertAt)];
  if (destFile === file) {
    assertSameMultiset(srcLines, destFinal);
  } else {
    assertSameMultiset([...srcLines, ...block], [...srcAfter, ...destFinal]);
  }
  const summary = [`move ${file}:${line0 + 1} \u2192 ${destFile} under "${targetTopic}"`, ...block.map((b) => `  | ${b}`)];
  if (destFile === file) {
    commit(a, srcAbs, destFinal, summary);
  } else {
    commit(a, srcAbs, srcAfter, [`from ${file}: remove block`]);
    commit(a, destAbs, destFinal, summary);
  }
}
function cmdSyncTopics(a) {
  const p = path.join(scanRoot(), TOPICS_FILE);
  const generated = `${AUTO_BEGIN}
<!-- regenerated from headings + tags; edit only OUTSIDE this block -->

${renderTopics()}
${AUTO_END}`;
  let content;
  if (fs.existsSync(p)) {
    const cur = fs.readFileSync(p, "utf8");
    const re = new RegExp(`${escapeRe2(AUTO_BEGIN)}[\\s\\S]*?${escapeRe2(AUTO_END)}`);
    content = re.test(cur) ? cur.replace(re, generated) : `${cur.replace(/\s*$/, "")}

${generated}
`;
  } else {
    content = `# Topics

Hierarchical index of all topics. The block below is regenerated; add proposals above it.

${generated}
`;
  }
  commitFile(a, p, content, [`sync-topics \u2192 ${rel(p)}`]);
}
function verifyExpect(a, actual) {
  const exp = a["expect"];
  if (exp === void 0) fail('--expect "<item text>" is required (verifies the right line before writing)');
  if (exp.trim() !== actual.trim()) fail(`ABORT: --expect mismatch (stale line?)
  expected: "${exp}"
  actual:   "${actual}"`);
}
function assertOnlyLineChanged(before, after, line0) {
  if (before.length !== after.length) fail("ABORT: line count changed");
  for (let i = 0; i < before.length; i++) if (i !== line0 && before[i] !== after[i]) fail(`ABORT: unexpected change on line ${i + 1}`);
}
function assertSameMultiset(a, b) {
  const key = (arr) => arr.filter((s) => s.trim() !== "").sort().join("\n");
  if (key(a) !== key(b)) fail("ABORT: content would be lost or altered during move (line multiset changed)");
}
function commit(a, p, lines, summary) {
  commitFile(a, p, lines.join("\n"), summary);
}
function commitFile(a, p, content, summary) {
  const apply = "apply" in a;
  console.log(summary.join("\n"));
  if (!apply) {
    console.error("(dry-run \u2014 re-run with --apply to write)");
    return;
  }
  if (fs.existsSync(p)) fs.copyFileSync(p, p + ".bak");
  fs.writeFileSync(p, content, "utf8");
  console.error(`\u2714 wrote ${rel(p)}${fs.existsSync(p + ".bak") ? ` (backup ${rel(p)}.bak)` : ""}`);
}
function today() {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function escapeRe2(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function fail(msg) {
  console.error("ERROR: " + msg);
  process.exit(1);
}
function req(a, k) {
  const v = a[k];
  if (v === void 0) fail(`missing --${k}`);
  return v;
}
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const k = t.slice(2);
    const nxt = argv[i + 1];
    if (nxt === void 0 || nxt.startsWith("--")) a[k] = "true";
    else {
      a[k] = nxt;
      i++;
    }
  }
  return a;
}
function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  switch (cmd) {
    case "list":
      return cmdList("json" in a);
    case "topics":
      return cmdTopics();
    case "sync-topics":
      return cmdSyncTopics(a);
    case "label":
      return cmdLabel(a);
    case "move":
      return cmdMove(a);
    case "duplicates":
      return cmdDuplicates();
    case "uncategorized":
      return cmdUncategorized();
    default:
      console.log("commands: list | topics | sync-topics | label | move | duplicates | uncategorized");
      console.log("mutations are dry-run unless --apply is passed; label/move require --id and --expect.");
  }
}
main();
