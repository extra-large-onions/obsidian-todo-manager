import { Dimension, DimensionKind } from './types';

/**
 * Text format for editing dimensions. Reads as plain markdown; two equivalent
 * spellings so short dimensions stay on one line and hierarchies keep their
 * shape.
 *
 *   Priority: enum[high, medium, low]     <- compact, one line per dimension
 *   Due: date
 *
 *   ## Topic  {tree}                      <- block, values as nested bullets
 *   - Deployment
 *     - Startup      -> Deployment/Startup
 *     - Shutdown     -> Deployment/Shutdown
 *
 * A compact line with no `[...]` may also take its values as bullets below it,
 * which is the usual way to write a tree:
 *
 *   Topic: tree
 *   - Deployment
 *     - Startup
 *
 * Kinds have aliases (enum = radio, multi = checkbox, date = time …) so the
 * format reads naturally; serialization always writes the canonical name.
 * Ids auto-slug from the name; `(id: foo)` before the colon pins an id so a
 * rename never breaks the `key:value` metadata already in your notes.
 * Blank lines, `// …` and `<!-- … -->` lines are ignored, as is any markdown
 * heading without a `{kind}` — use those to title or comment the document.
 */

const CANONICAL_KINDS: readonly DimensionKind[] = ['tree', 'radio', 'checkbox', 'time', 'text', 'auto'];

/** Spellings accepted for each kind. The canonical name is always first. */
export const KIND_ALIASES: Readonly<Record<DimensionKind, readonly string[]>> = {
	tree:     ['tree', 'hierarchy', 'nested', 'path'],
	radio:    ['radio', 'enum', 'choice', 'select', 'one'],
	checkbox: ['checkbox', 'multi', 'many', 'set', 'flags'],
	time:     ['time', 'date', 'when'],
	text:     ['text', 'free', 'string'],
	auto:     ['auto', 'derived', 'computed'],
};

const ALIAS_LOOKUP: ReadonlyMap<string, DimensionKind> = new Map(
	CANONICAL_KINDS.flatMap(k => KIND_ALIASES[k].map(a => [a, k] as [string, DimensionKind])),
);

/** Resolve a written kind token (canonical or alias) to a kind, or null. */
export function resolveKind(token: string): DimensionKind | null {
	return ALIAS_LOOKUP.get(token.toLowerCase().trim()) ?? null;
}

/** Kinds whose values are a user-authored list (others ignore bullet lines). */
export function kindHasValues(kind: DimensionKind): boolean {
	return kind === 'tree' || kind === 'radio' || kind === 'checkbox';
}

export function slug(name: string): string {
	return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const HEADING_RE = /^#{1,6}\s+(.*?)\s*\{\s*([A-Za-z]+)\s*\}\s*(?:\(\s*id\s*:\s*([\w-]+)\s*\))?\s*$/;
const BULLET_RE  = /^(\s*)[-*+]\s+(.+?)\s*$/;
const COMPACT_RE = /^(.+?)\s*(?:\(\s*id\s*:\s*([\w-]+)\s*\))?\s*:\s*([A-Za-z]+)\s*(?:\[([^\]]*)\])?\s*$/;

// ---------- serialize ----------

interface TreeNode { name: string; children: TreeNode[]; }

function buildTree(paths: string[]): TreeNode[] {
	const roots: TreeNode[] = [];
	for (const path of paths) {
		let level = roots;
		for (const part of path.split('/')) {
			let node = level.find(n => n.name === part);
			if (!node) { node = { name: part, children: [] }; level.push(node); }
			level = node.children;
		}
	}
	return roots;
}

function emitTree(nodes: TreeNode[], depth: number, out: string[]): void {
	for (const n of nodes) {
		out.push(`${'  '.repeat(depth)}- ${n.name}`);
		emitTree(n.children, depth + 1, out);
	}
}

/** Compact form is only safe when nothing in the line needs escaping. */
function canWriteCompact(d: Dimension): boolean {
	if (d.name.includes(':') || d.name.includes('{') || d.name.includes('[')) return false;
	if (d.kind === 'tree') return d.values.length === 0;      // trees earn their bullets
	if (!kindHasValues(d.kind)) return true;
	if (d.values.some(v => v.includes(',') || v.includes(']'))) return false;
	return d.values.join(', ').length <= 72;
}

function compactLine(d: Dimension): string {
	const idPart = d.id !== slug(d.name) ? ` (id: ${d.id})` : '';
	const vals = kindHasValues(d.kind) && d.values.length > 0 ? `[${d.values.join(', ')}]` : '';
	return `${d.name}${idPart}: ${d.kind}${vals}`;
}

function blockLines(d: Dimension): string[] {
	const idPart = d.id !== slug(d.name) ? `  (id: ${d.id})` : '';
	const lines = [`## ${d.name}  {${d.kind}}${idPart}`];
	if (!kindHasValues(d.kind)) return lines;
	if (d.kind === 'tree') {
		if (d.values.length === 0) lines.push('<!-- no fixed values: topics come from your headings -->');
		else emitTree(buildTree(d.values), 0, lines);
	} else {
		for (const v of d.values) lines.push(`- ${v}`);
	}
	return lines;
}

/**
 * Write dimensions back out, in order. Short ones become one-liners and long
 * or nested ones become heading blocks; a compact line after a block ends that
 * block, so a mixed document round-trips unchanged.
 */
export function serializeDimensions(dims: Dimension[]): string {
	const blocks: string[] = [];
	let run: string[] = [];
	const flush = () => { if (run.length > 0) { blocks.push(run.join('\n')); run = []; } };

	for (const d of dims) {
		if (canWriteCompact(d)) run.push(compactLine(d));
		else { flush(); blocks.push(blockLines(d).join('\n')); }
	}
	flush();
	return blocks.join('\n\n') + '\n';
}

// ---------- parse ----------

export interface ParseResult {
	dims: Dimension[];
	errors: string[];
}

interface CompactDef { name: string; id: string; kind: DimensionKind; values: string[] | null; }

/** Parse one `Name: kind[a, b]` line. Returns null if it isn't one at all. */
function parseCompact(body: string): CompactDef | string | null {
	const m = COMPACT_RE.exec(body);
	if (!m) return null;
	const name = m[1]!.trim();
	const kind = resolveKind(m[3]!);
	if (!kind) return `unknown kind "${m[3]}". Try ${CANONICAL_KINDS.join(', ')}.`;
	if (!name) return 'dimension name is empty.';
	const id = (m[2] ?? slug(name)).trim();
	if (!id) return `could not derive an id from "${name}"; add "(id: ...)".`;
	const raw = m[4];
	const values = raw === undefined
		? null
		: raw.split(',').map(v => v.trim()).filter(v => v !== '');
	if (values !== null && values.length > 0 && !kindHasValues(kind)) {
		return `"${name}" is a ${kind} dimension and takes no values.`;
	}
	return { name, id, kind, values };
}

/** Parse the text format back into dimensions. Never throws; collects errors. */
export function parseDimensionsText(text: string): ParseResult {
	const errors: string[] = [];
	const dims: Dimension[] = [];
	const seenIds = new Set<string>();
	let cur: Dimension | null = null;
	let stack: { indent: number; name: string }[] = [];

	/** Add a dimension unless its id collides; returns it when accepted. */
	const accept = (d: Dimension, lineNo: number): Dimension | null => {
		if (seenIds.has(d.id)) { errors.push(`Line ${lineNo}: duplicate id "${d.id}".`); return null; }
		seenIds.add(d.id);
		dims.push(d);
		return d;
	};

	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (raw === undefined) continue;
		const lineNo = i + 1;
		const trimmed = raw.trim();
		if (trimmed === '' || trimmed.startsWith('<!--') || trimmed.startsWith('//')) continue;

		// ----- heading: "## Name {kind}", or a plain heading used as a divider
		if (raw.startsWith('#')) {
			cur = null;
			stack = [];
			const m = HEADING_RE.exec(raw);
			if (!m) continue;                  // "# Dimensions" and friends: just a title
			const name = m[1]!.trim();
			const kind = resolveKind(m[2]!);
			const id = (m[3] ?? slug(name)).trim();
			if (!name)   { errors.push(`Line ${lineNo}: dimension name is empty.`); continue; }
			if (!kind)   { errors.push(`Line ${lineNo}: unknown kind "${m[2]}". Try ${CANONICAL_KINDS.join(', ')}.`); continue; }
			if (!id)     { errors.push(`Line ${lineNo}: could not derive an id from "${name}"; add "(id: ...)".`); continue; }
			cur = accept({ id, name, kind, values: [] }, lineNo);
			continue;
		}

		// ----- bullet inside a dimension that takes values: it's a value
		const bm = BULLET_RE.exec(raw);
		if (bm && cur && kindHasValues(cur.kind)) {
			const indent = bm[1]!.replace(/\t/g, '  ').length;
			const label = bm[2]!.trim();
			if (cur.kind === 'tree') {
				while (stack.length > 0 && indent <= stack[stack.length - 1]!.indent) stack.pop();
				stack.push({ indent, name: label });
				cur.values.push(stack.map(s => s.name).join('/'));
			} else if (!cur.values.includes(label)) {
				cur.values.push(label);
			}
			continue;
		}

		// ----- otherwise: a compact definition, bulleted or bare
		const body = bm ? bm[2]!.trim() : trimmed;
		const def = parseCompact(body);
		if (typeof def === 'string') { errors.push(`Line ${lineNo}: ${def}`); continue; }
		if (def === null) {
			errors.push(bm && cur
				? `Line ${lineNo}: "${body}" — ${cur.name} is a ${cur.kind} dimension and takes no values.`
				: `Line ${lineNo}: expected "Name: kind[a, b]" or "## Name {kind}", got "${body}".`);
			continue;
		}
		const added = accept({ id: def.id, name: def.name, kind: def.kind, values: def.values ?? [] }, lineNo);
		// Values inline → the dimension is finished. No brackets → bullets may follow.
		cur = added !== null && def.values === null && kindHasValues(def.kind) ? added : null;
		stack = [];
	}

	if (!dims.some(d => d.kind === 'tree')) {
		errors.push('At least one dimension must be a tree (the topic hierarchy).');
	}
	return { dims, errors };
}
