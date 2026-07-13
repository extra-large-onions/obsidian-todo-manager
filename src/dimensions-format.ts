import { Dimension, DimensionKind } from './types';

/**
 * Text format for editing dimensions inline in settings. One dimension per
 * markdown heading; values as nested bullets. Tree nesting (indentation) maps
 * to slash-joined paths, matching how headings nest into topic/subtopic.
 *
 *   ## Priority  {radio}
 *   - high
 *   - medium
 *   - low
 *
 *   ## Topic  {tree}
 *   - Deployment
 *     - Startup      -> Deployment/Startup
 *     - Shutdown     -> Deployment/Shutdown
 *
 * Id auto-slugs from the name; an explicit `(id: foo)` overrides it and is
 * emitted for stable/protected dims so renames never break metadata keys.
 */

const VALID_KINDS: ReadonlySet<DimensionKind> = new Set<DimensionKind>([
	'tree', 'radio', 'checkbox', 'time', 'text', 'auto',
]);

/** Kinds whose values are a user-authored list (others ignore bullet lines). */
export function kindHasValues(kind: DimensionKind): boolean {
	return kind === 'tree' || kind === 'radio' || kind === 'checkbox';
}

export function slug(name: string): string {
	return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const HEADING_RE = /^#{1,6}\s+(.*?)\s*\{\s*([a-z]+)\s*\}\s*(?:\(\s*id\s*:\s*([\w-]+)\s*\))?\s*$/;
const BULLET_RE  = /^(\s*)[-*+]\s+(.+?)\s*$/;

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

export function serializeDimensions(dims: Dimension[]): string {
	const blocks: string[] = [];
	for (const d of dims) {
		const idPart = d.id !== slug(d.name) ? `  (id: ${d.id})` : '';
		const lines = [`## ${d.name}  {${d.kind}}${idPart}`];
		if (kindHasValues(d.kind)) {
			if (d.kind === 'tree') {
				if (d.values.length === 0) lines.push('  <!-- auto-discovered from headings -->');
				else emitTree(buildTree(d.values), 0, lines);
			} else {
				for (const v of d.values) lines.push(`- ${v}`);
			}
		}
		blocks.push(lines.join('\n'));
	}
	return blocks.join('\n\n') + '\n';
}

// ---------- parse ----------

export interface ParseResult {
	dims: Dimension[];
	errors: string[];
}

/** Parse the text format back into dimensions. Never throws; collects errors. */
export function parseDimensionsText(text: string): ParseResult {
	const errors: string[] = [];
	const dims: Dimension[] = [];
	const seenIds = new Set<string>();
	let cur: Dimension | null = null;
	let stack: { indent: number; name: string }[] = [];

	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (raw === undefined) continue;
		const lineNo = i + 1;
		const trimmed = raw.trim();
		if (trimmed === '' || trimmed.startsWith('<!--') || trimmed.startsWith('//')) continue;

		if (raw.startsWith('#')) {
			const m = HEADING_RE.exec(raw);
			if (!m) { errors.push(`Line ${lineNo}: expected "## Name {kind}".`); continue; }
			const name = m[1]!.trim();
			const kind = m[2] as DimensionKind;
			const id = (m[3] ?? slug(name)).trim();
			if (!name)              { errors.push(`Line ${lineNo}: dimension name is empty.`); continue; }
			if (!VALID_KINDS.has(kind)) { errors.push(`Line ${lineNo}: unknown kind "${kind}".`); continue; }
			if (!id)                { errors.push(`Line ${lineNo}: could not derive an id from "${name}"; add "(id: ...)".`); continue; }
			if (seenIds.has(id))    { errors.push(`Line ${lineNo}: duplicate id "${id}".`); continue; }
			seenIds.add(id);
			cur = { id, name, kind, values: [] };
			dims.push(cur);
			stack = [];
			continue;
		}

		const bm = BULLET_RE.exec(raw);
		if (!bm) { errors.push(`Line ${lineNo}: not a heading or bullet.`); continue; }
		if (!cur) { errors.push(`Line ${lineNo}: value "${bm[2]}" before any dimension heading.`); continue; }
		if (!kindHasValues(cur.kind)) {
			errors.push(`Line ${lineNo}: "${cur.name}" is a ${cur.kind} dimension and takes no values.`);
			continue;
		}
		const indent = bm[1]!.replace(/\t/g, '  ').length;
		const label = bm[2]!.trim();
		if (cur.kind === 'tree') {
			while (stack.length > 0 && indent <= stack[stack.length - 1]!.indent) stack.pop();
			stack.push({ indent, name: label });
			cur.values.push(stack.map(s => s.name).join('/'));
		} else {
			if (!cur.values.includes(label)) cur.values.push(label);
		}
	}

	if (!dims.some(d => d.kind === 'tree')) {
		errors.push('At least one dimension must be a tree (topic hierarchy).');
	}
	return { dims, errors };
}
