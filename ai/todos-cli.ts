/*
 * todos-cli — the ONLY sanctioned way for an AI to mutate the notes vault.
 *
 * Guarantees (enforced mechanically, not by prompt):
 *   • label / move never change an item's prose. After every write the file is
 *     re-parsed and the item text is asserted byte-identical; move additionally
 *     asserts the multiset of non-empty lines is preserved (no data loss).
 *   • Only three writes exist: label an item, move an item block, regenerate the
 *     AUTO region of _topics.md. There is no free-form text edit path.
 *   • Dry-run by default. `--apply` writes, after saving a <file>.bak.
 *
 * Usage:
 *   node ai/todos-cli.cjs list [--json]
 *   node ai/todos-cli.cjs topics
 *   node ai/todos-cli.cjs sync-topics [--apply]
 *   node ai/todos-cli.cjs label --id "path:LINE" --expect "TEXT" [--tag T] [--date YYYY-MM-DD] [--apply]
 *   node ai/todos-cli.cjs move  --id "path:LINE" --expect "TEXT" --to "Heading/Path" [--to-file REL] [--apply]
 *   node ai/todos-cli.cjs duplicates
 *   node ai/todos-cli.cjs uncategorized
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseFile } from '../src/parser';
import { Item } from '../src/types';

const TOPICS_FILE = '_topics.md';
const AUTO_BEGIN = '<!-- todos:auto:begin -->';
const AUTO_END = '<!-- todos:auto:end -->';
const TIME_KEYS = ['added', 'due'];

// ---------- scope / io ----------

function pluginDir(): string { return path.resolve(__dirname, '..'); }

function vaultRoot(): string {
	const parts = pluginDir().split(path.sep);
	const i = parts.indexOf('.obsidian');
	return i >= 0 ? parts.slice(0, i).join(path.sep) : pluginDir();
}

function scanRoot(): string {
	try {
		const data = JSON.parse(fs.readFileSync(path.join(pluginDir(), 'data.json'), 'utf8'));
		if (data.rootFolder) return path.join(vaultRoot(), data.rootFolder);
	} catch { /* no data.json */ }
	return vaultRoot();
}

function mdFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			if (e.name.startsWith('.')) continue;
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
		}
	};
	if (fs.existsSync(root)) walk(root);
	return out;
}

function rel(p: string): string { return path.relative(vaultRoot(), p).split(path.sep).join('/'); }
function abs(relPath: string): string { return path.join(vaultRoot(), relPath.split('/').join(path.sep)); }
function readLines(p: string): string[] { return fs.readFileSync(p, 'utf8').split(/\r?\n/); }

// ---------- line helpers ----------

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const indentOf = (s: string): number => (s.match(/^\s*/)?.[0].length ?? 0);
const isSeparator = (s: string): boolean => /^\s*---\s*$/.test(s);
const isTopLevelItem = (s: string): boolean => /^[-*+]\s+/.test(s); // no leading indent

interface Heading { line: number; level: number; title: string; pathParts: string[]; }

function scanHeadings(lines: string[]): Heading[] {
	const out: Heading[] = [];
	const stack: { level: number; title: string }[] = [];
	lines.forEach((raw, line) => {
		const m = raw.match(HEADING);
		if (!m) return;
		const level = m[1]!.length;
		const title = (m[2] ?? '').trim();
		while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
		if (title) stack.push({ level, title });
		out.push({ line, level, title, pathParts: stack.map(s => s.title) });
	});
	return out;
}

// ---------- item collection ----------

interface Row { id: string; file: string; line1: number; kind: string; status?: string; text: string; topic: string; tags: string[]; date?: string; uncategorized: boolean; }

function collect(): Row[] {
	const rows: Row[] = [];
	for (const p of mdFiles(scanRoot())) {
		if (path.basename(p) === TOPICS_FILE) continue;
		const lines = readLines(p);
		const items = parseFile(lines.join('\n'), { dimensionIds: TIME_KEYS, path: rel(p) });
		for (const it of items) {
			if (it.kind === 'index') continue; // headings are gone; index = prose/separators
			rows.push({
				id: `${rel(p)}:${it.loc.line + 1}`,
				file: rel(p), line1: it.loc.line + 1,
				kind: it.kind, status: it.status,
				text: it.text, topic: it.section.join('/'),
				tags: it.tags,
				date: it.meta.find(m => TIME_KEYS.includes(m.key))?.value,
				uncategorized: afterSeparator(lines, it.loc.line),
			});
		}
	}
	return rows;
}

// True if the nearest structural marker above this line (within its section) is a `---`.
function afterSeparator(lines: string[], line: number): boolean {
	for (let i = line - 1; i >= 0; i--) {
		const s = lines[i]!;
		if (HEADING.test(s)) return false;
		if (isSeparator(s)) return true;
	}
	return false;
}

// ---------- read-only commands ----------

function cmdList(json: boolean): void {
	const rows = collect();
	if (json) { console.log(JSON.stringify(rows, null, 2)); return; }
	for (const r of rows) {
		const flags = [r.status ?? r.kind, r.date ? `📅${r.date}` : 'no-date', r.uncategorized ? 'UNCATEGORIZED' : r.topic || 'no-topic'];
		console.log(`${r.id}\t[${flags.join(' ')}]\t${r.text}${r.tags.length ? '  #' + r.tags.join(' #') : ''}`);
	}
	console.error(`\n${rows.length} items`);
}

function cmdTopics(): void { console.log(renderTopics()); }

function renderTopics(): string {
	// Source of truth: headings (sections) + tags across the scope, merged into one tree.
	const root: Record<string, any> = {};
	const add = (parts: string[]) => {
		let node = root;
		for (const seg of parts) { node[seg] = node[seg] ?? {}; node = node[seg]; }
	};
	for (const r of collect()) {
		if (r.topic) add(r.topic.split('/'));
		for (const t of r.tags) add(t.split('/'));
	}
	const lines: string[] = [];
	const walk = (node: Record<string, any>, depth: number) => {
		for (const key of Object.keys(node).sort((a, b) => a.localeCompare(b))) {
			lines.push(`${'  '.repeat(depth)}- ${key}`);
			walk(node[key], depth + 1);
		}
	};
	walk(root, 0);
	return lines.join('\n') || '(no topics found)';
}

function cmdDuplicates(): void {
	const rows = collect();
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
	const toks = (s: string) => new Set(norm(s).split(' ').filter(Boolean));
	const jac = (a: Set<string>, b: Set<string>) => {
		let inter = 0; for (const x of a) if (b.has(x)) inter++;
		return inter / (a.size + b.size - inter || 1);
	};
	const seen: { r: Row; t: Set<string> }[] = [];
	let found = 0;
	for (const r of rows) {
		const t = toks(r.text);
		for (const s of seen) {
			const score = norm(r.text) === norm(s.r.text) ? 1 : jac(t, s.t);
			if (score >= 0.7) { console.log(`~${score.toFixed(2)}  ${s.r.id}  ⟷  ${r.id}\n   "${s.r.text}"\n   "${r.text}"`); found++; }
		}
		seen.push({ r, t });
	}
	console.error(`\n${found} suggested duplicate pair(s) — SUGGESTION ONLY, no changes made.`);
}

function cmdUncategorized(): void {
	const rows = collect().filter(r => r.uncategorized || (!r.topic && r.tags.length === 0));
	for (const r of rows) console.log(`${r.id}\t${r.text}`);
	console.error(`\n${rows.length} uncategorized item(s)`);
}

// ---------- item block ----------

// Item = the top line + its indent-nested descendants (sub-items are carried, never edited).
function itemBlock(lines: string[], top: number): { end: number } {
	const I = indentOf(lines[top]!);
	let end = top;
	for (let j = top + 1; j < lines.length; j++) {
		const s = lines[j]!;
		if (s.trim() === '') continue;
		if (HEADING.test(s) || isSeparator(s) || indentOf(s) <= I) break;
		end = j;
	}
	return { end };
}

function resolveId(id: string): { file: string; line0: number } {
	const i = id.lastIndexOf(':');
	if (i < 0) fail(`bad --id "${id}" (want "path:LINE")`);
	return { file: id.slice(0, i), line0: Number(id.slice(i + 1)) - 1 };
}

function itemTextAt(lines: string[], file: string, line0: number): string {
	const parsed = parseFile(lines.join('\n'), { dimensionIds: TIME_KEYS, path: file });
	const flat: Item[] = [];
	const visit = (it: Item) => { flat.push(it); it.children.forEach(visit); };
	parsed.forEach(visit);
	const hit = flat.find(it => it.loc.line === line0);
	return hit ? hit.text : '\0MISSING';
}

// ---------- label (workflow 2) ----------

function cmdLabel(a: Args): void {
	const { file, line0 } = resolveId(req(a, 'id'));
	const p = abs(file);
	const lines = readLines(p);
	const raw = lines[line0];
	if (raw === undefined) fail(`${file} has no line ${line0 + 1}`);
	if (!isTopLevelItem(raw!)) fail(`line ${line0 + 1} is not a top-level item (sub-items and prose cannot be labelled)`);

	const before = itemTextAt(lines, file, line0);
	verifyExpect(a, before);

	let next = raw!;
	const tag = a['tag'];
	if (tag && !new RegExp(`(^|\\s)#${escapeRe(tag)}(\\s|$)`).test(next)) {
		next = next.replace(/\s*$/, '') + ` #${tag}`;
	}
	if (a['date'] !== 'skip') {
		const date = a['date'] || today();
		if (!TIME_KEYS.some(k => new RegExp(`\\b${k}:`).test(next))) {
			const m = next.match(/%%([^%]*)%%/);
			next = m
				? next.replace(/%%([^%]*)%%/, `%%${m[1]!.trimEnd()} added:${date} %%`)
				: next.replace(/\s*$/, '') + ` %% added:${date} %%`;
		}
	}

	if (next === raw) { console.error('No change (already labelled).'); return; }
	lines[line0] = next;

	// HARD GUARD: prose must be byte-identical after the edit.
	const after = itemTextAt(lines, file, line0);
	if (after !== before) fail(`ABORT: edit would change item text\n  before: "${before}"\n  after:  "${after}"`);
	assertOnlyLineChanged(readLines(p), lines, line0);

	commit(a, p, lines, [`- ${file}:${line0 + 1}`, `  - "${raw}"`, `  + "${next}"`]);
}

// ---------- move (workflow 3) ----------

function cmdMove(a: Args): void {
	const { file, line0 } = resolveId(req(a, 'id'));
	const srcAbs = abs(file);
	const srcLines = readLines(srcAbs);
	if (srcLines[line0] === undefined) fail(`${file} has no line ${line0 + 1}`);
	if (!isTopLevelItem(srcLines[line0]!)) fail(`line ${line0 + 1} is not a top-level item`);

	const before = itemTextAt(srcLines, file, line0);
	verifyExpect(a, before);

	const targetTopic = req(a, 'to');
	const destFile = a['to-file'] || file;
	const destAbs = abs(destFile);
	if (!fs.existsSync(destAbs)) fail(`destination file not found: ${destFile}`);

	const { end } = itemBlock(srcLines, line0);
	const block = srcLines.slice(line0, end + 1);

	// Remove block from source.
	const srcAfter = [...srcLines.slice(0, line0), ...srcLines.slice(end + 1)];

	// Locate destination section end (in dest file, post-removal if same file).
	const destLines = destFile === file ? srcAfter : readLines(destAbs);
	const heads = scanHeadings(destLines);
	const target = heads.find(h => h.pathParts.join('/') === targetTopic);
	if (!target) fail(`topic heading "${targetTopic}" not found in ${destFile}. Run sync-topics or create the heading first — this tool never invents structure.`);
	let insertAt = destLines.length;
	for (const h of heads) { if (h.line > target.line && h.level <= target.level) { insertAt = h.line; break; } }
	while (insertAt > target.line + 1 && destLines[insertAt - 1]!.trim() === '') insertAt--; // trim trailing blanks

	const destFinal = [...destLines.slice(0, insertAt), ...block, ...destLines.slice(insertAt)];

	// HARD GUARDS
	if (destFile === file) {
		assertSameMultiset(srcLines, destFinal);
	} else {
		assertSameMultiset([...srcLines, ...block], [...srcAfter, ...destFinal]); // conservation across the two files
	}

	const summary = [`move ${file}:${line0 + 1} → ${destFile} under "${targetTopic}"`, ...block.map(b => `  | ${b}`)];
	if (destFile === file) {
		commit(a, srcAbs, destFinal, summary);
	} else {
		commit(a, srcAbs, srcAfter, [`from ${file}: remove block`]);
		commit(a, destAbs, destFinal, summary);
	}
}

// ---------- sync-topics (workflow 1) ----------

function cmdSyncTopics(a: Args): void {
	const p = path.join(scanRoot(), TOPICS_FILE);
	const generated = `${AUTO_BEGIN}\n<!-- regenerated from headings + tags; edit only OUTSIDE this block -->\n\n${renderTopics()}\n${AUTO_END}`;
	let content: string;
	if (fs.existsSync(p)) {
		const cur = fs.readFileSync(p, 'utf8');
		const re = new RegExp(`${escapeRe(AUTO_BEGIN)}[\\s\\S]*?${escapeRe(AUTO_END)}`);
		content = re.test(cur) ? cur.replace(re, generated) : `${cur.replace(/\s*$/, '')}\n\n${generated}\n`;
	} else {
		content = `# Topics\n\nHierarchical index of all topics. The block below is regenerated; add proposals above it.\n\n${generated}\n`;
	}
	commitFile(a, p, content, [`sync-topics → ${rel(p)}`]);
}

// ---------- guards / commit ----------

interface Args { [k: string]: string; }

function verifyExpect(a: Args, actual: string): void {
	const exp = a['expect'];
	if (exp === undefined) fail('--expect "<item text>" is required (verifies the right line before writing)');
	if (exp.trim() !== actual.trim()) fail(`ABORT: --expect mismatch (stale line?)\n  expected: "${exp}"\n  actual:   "${actual}"`);
}

function assertOnlyLineChanged(before: string[], after: string[], line0: number): void {
	if (before.length !== after.length) fail('ABORT: line count changed');
	for (let i = 0; i < before.length; i++) if (i !== line0 && before[i] !== after[i]) fail(`ABORT: unexpected change on line ${i + 1}`);
}

function assertSameMultiset(a: string[], b: string[]): void {
	const key = (arr: string[]) => arr.filter(s => s.trim() !== '').sort().join('\n');
	if (key(a) !== key(b)) fail('ABORT: content would be lost or altered during move (line multiset changed)');
}

function commit(a: Args, p: string, lines: string[], summary: string[]): void {
	commitFile(a, p, lines.join('\n'), summary);
}

function commitFile(a: Args, p: string, content: string, summary: string[]): void {
	const apply = 'apply' in a;
	console.log(summary.join('\n'));
	if (!apply) { console.error('(dry-run — re-run with --apply to write)'); return; }
	if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');
	fs.writeFileSync(p, content, 'utf8');
	console.error(`✔ wrote ${rel(p)}${fs.existsSync(p + '.bak') ? ` (backup ${rel(p)}.bak)` : ''}`);
}

// ---------- util ----------

function today(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function fail(msg: string): never { console.error('ERROR: ' + msg); process.exit(1); }
function req(a: Args, k: string): string { const v = a[k]; if (v === undefined) fail(`missing --${k}`); return v; }

function parseArgs(argv: string[]): Args {
	const a: Args = {};
	for (let i = 0; i < argv.length; i++) {
		const t = argv[i]!;
		if (!t.startsWith('--')) continue;
		const k = t.slice(2);
		const nxt = argv[i + 1];
		if (nxt === undefined || nxt.startsWith('--')) a[k] = 'true';
		else { a[k] = nxt; i++; }
	}
	return a;
}

function main(): void {
	const [cmd, ...rest] = process.argv.slice(2);
	const a = parseArgs(rest);
	switch (cmd) {
		case 'list': return cmdList('json' in a);
		case 'topics': return cmdTopics();
		case 'sync-topics': return cmdSyncTopics(a);
		case 'label': return cmdLabel(a);
		case 'move': return cmdMove(a);
		case 'duplicates': return cmdDuplicates();
		case 'uncategorized': return cmdUncategorized();
		default:
			console.log('commands: list | topics | sync-topics | label | move | duplicates | uncategorized');
			console.log('mutations are dry-run unless --apply is passed; label/move require --id and --expect.');
	}
}

main();
