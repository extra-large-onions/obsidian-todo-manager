import { App, TFile } from 'obsidian';

/** Node shape as stored in a `.canvas` file (JSON Canvas). */
export interface CanvasNodeData {
	id: string;
	type: 'text' | 'file' | 'link' | 'group';
	x: number;
	y: number;
	width: number;
	height: number;
	text?: string;
	file?: string;
	subpath?: string;   // file node pointing at a heading, e.g. "#Deployment"
	url?: string;
	color?: string;
	label?: string;
}

export interface CanvasData {
	nodes: CanvasNodeData[];
	edges: unknown[];
}

export interface CanvasBBox { minX: number; minY: number; maxX: number; maxY: number }

/** A live node inside an open canvas; `nodeEl` is the rendered element. */
interface CanvasNodeInternal {
	id: string;
	nodeEl?: HTMLElement;
}

/**
 * Obsidian ships no public canvas API. This is the shape of the internal
 * `canvas` object on a canvas view — every member is optional because any of
 * it can vanish in a future release, so callers must degrade quietly.
 */
export interface CanvasInternal {
	nodes: Map<string, CanvasNodeInternal>;
	selection?: Set<unknown>;
	wrapperEl?: HTMLElement;
	canvasEl?: HTMLElement;
	getData?: () => CanvasData;
	importData?: (data: CanvasData) => void;
	setData?: (data: CanvasData) => void;
	requestSave?: () => void;
	zoomToBbox?: (bbox: CanvasBBox) => void;
}

export interface ActiveCanvas {
	canvas: CanvasInternal;
	file: TFile | null;
}

interface CanvasViewLike {
	file?: TFile;
	canvas?: CanvasInternal;
}

function canvasOf(view: unknown): CanvasViewLike {
	return (view ?? {}) as CanvasViewLike;
}

/** The canvas of the active file, else the first open canvas. */
export function getActiveCanvas(app: App): ActiveCanvas | null {
	const leaves = app.workspace.getLeavesOfType('canvas');
	if (leaves.length === 0) return null;
	const activePath = app.workspace.getActiveFile()?.path;
	const leaf = (activePath
		? leaves.find(l => canvasOf(l.view).file?.path === activePath)
		: undefined) ?? leaves[0]!;
	const view = canvasOf(leaf.view);
	return view.canvas ? { canvas: view.canvas, file: view.file ?? null } : null;
}

/** Every open canvas, for clearing decoration when the active one changes. */
export function openCanvases(app: App): CanvasInternal[] {
	const out: CanvasInternal[] = [];
	for (const leaf of app.workspace.getLeavesOfType('canvas')) {
		const canvas = canvasOf(leaf.view).canvas;
		if (canvas) out.push(canvas);
	}
	return out;
}

export function getCanvasData(canvas: CanvasInternal): CanvasData {
	return canvas.getData?.() ?? { nodes: [], edges: [] };
}

function saveCanvasData(canvas: CanvasInternal, data: CanvasData): void {
	// Method name differs across Obsidian versions; try both.
	if (canvas.importData) canvas.importData(data);
	else if (canvas.setData) canvas.setData(data);
	canvas.requestSave?.();
}

function applyNodeChanges(canvas: CanvasInternal, changes: Map<string, Partial<CanvasNodeData>>): void {
	const data = getCanvasData(canvas);
	data.nodes = data.nodes.map(node => {
		const change = changes.get(node.id);
		return change ? { ...node, ...change } : node;
	});
	saveCanvasData(canvas, data);
}

// ─── Text ─────────────────────────────────────────────────────────────────────

/** The markdown a node carries itself (file nodes carry none — see canvas-items). */
export function getNodeText(node: CanvasNodeData): string {
	if (node.type === 'text') return node.text ?? '';
	if (node.type === 'group') return node.label ?? '';
	return '';
}

/** Everything about a node a text search should look at. */
export function searchHaystack(node: CanvasNodeData): string {
	return [getNodeText(node), node.file ?? '', node.url ?? '', node.label ?? ''].join(' ');
}

/** Display name: heading, filename, hostname, or first line. */
export function getNodeDisplayName(node: CanvasNodeData): string {
	if (node.type === 'group') return node.label || '(unnamed group)';
	if (node.type === 'file') {
		const base = (node.file ?? '').split('/').pop()?.replace(/\.md$/, '') ?? '(file)';
		return node.subpath ? `${base} ${node.subpath}` : base;
	}
	if (node.type === 'link') {
		try { return new URL(node.url ?? '').hostname; } catch { return node.url ?? '(link)'; }
	}
	const text = (node.text ?? '').trimStart();
	const heading = text.match(/^#{1,2} (.+)/);
	if (heading) return heading[1]!.trim().slice(0, 60);
	const firstLine = text.split('\n').find(l => l.trim()) ?? '';
	return firstLine.slice(0, 60) || '(empty)';
}

export function countWords(nodes: CanvasNodeData[]): number {
	return nodes.reduce((total, node) => {
		const text = getNodeText(node).trim();
		return text ? total + text.split(/\s+/).length : total;
	}, 0);
}

// ─── Hierarchy (containment, not edges) ──────────────────────────────────────

export interface CanvasTreeNode {
	node: CanvasNodeData;
	children: CanvasTreeNode[];
	depth: number;
}

/** True if `inner` sits fully inside `outer` (1px tolerance). */
function containedIn(outer: CanvasNodeData, inner: CanvasNodeData): boolean {
	if (outer.id === inner.id) return false;
	return inner.x >= outer.x - 1 &&
		inner.y >= outer.y - 1 &&
		inner.x + inner.width <= outer.x + outer.width + 1 &&
		inner.y + inner.height <= outer.y + outer.height + 1;
}

/**
 * Build a containment tree: each node's parent is its smallest enclosing group.
 * Levels are sorted top-to-bottom, then left-to-right.
 */
export function buildHierarchy(nodes: CanvasNodeData[]): CanvasTreeNode[] {
	const groups = nodes.filter(n => n.type === 'group');

	const directParentId = (node: CanvasNodeData): string | null => {
		const containers = groups.filter(g => containedIn(g, node));
		if (containers.length === 0) return null;
		// Smallest area = most specific enclosing group.
		return containers.sort((a, b) => (a.width * a.height) - (b.width * b.height))[0]!.id;
	};

	const childrenMap = new Map<string | null, CanvasNodeData[]>();
	childrenMap.set(null, []);
	for (const node of nodes) {
		const pid = directParentId(node);
		const arr = childrenMap.get(pid) ?? [];
		arr.push(node);
		childrenMap.set(pid, arr);
	}
	for (const children of childrenMap.values()) {
		children.sort((a, b) => a.y - b.y || a.x - b.x);
	}

	const buildSubtree = (parentId: string | null, depth: number): CanvasTreeNode[] =>
		(childrenMap.get(parentId) ?? []).map(node => ({
			node,
			children: buildSubtree(node.id, depth + 1),
			depth,
		}));

	return buildSubtree(null, 0);
}

/** group id → ids of every node inside it, at any depth. */
export function groupDescendants(tree: CanvasTreeNode[]): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const collect = (branch: CanvasTreeNode[]): string[] => {
		const ids: string[] = [];
		for (const t of branch) {
			const inner = collect(t.children);
			if (t.node.type === 'group') out.set(t.node.id, inner);
			ids.push(t.node.id, ...inner);
		}
		return ids;
	};
	collect(tree);
	return out;
}

export function countDescendants(t: CanvasTreeNode): number {
	return t.children.reduce((n, c) => n + 1 + countDescendants(c), 0);
}

// ─── Sizing ───────────────────────────────────────────────────────────────────

function stdDev(values: number[], mean: number): number {
	return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/**
 * Sigma-clipping (1.5σ): drop values further than 1.5 standard deviations from
 * the mean, then average what is left. Width and height are clipped separately.
 *
 * If cards are already similar, σ is small, nothing is dropped and the result
 * is the plain mean. If a few cards are dramatically larger (a summary card
 * among task cards), they fall out and the result tracks the majority.
 */
function sigmaClip(values: number[]): number {
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const sd = stdDev(values, mean);
	const inliers = sd > 0 ? values.filter(v => Math.abs(v - mean) <= 1.5 * sd) : values;
	const used = inliers.length > 0 ? inliers : values;
	return Math.round(used.reduce((a, b) => a + b, 0) / used.length);
}

/** Resize the given nodes to one sigma-clipped size. Returns how many changed. */
export function autoResizeNodes(canvas: CanvasInternal, nodes: CanvasNodeData[]): number {
	// Sample non-group nodes so groups do not skew the target.
	const sample = nodes.filter(n => n.type !== 'group');
	if (sample.length === 0) return 0;
	const width = sigmaClip(sample.map(n => n.width));
	const height = sigmaClip(sample.map(n => n.height));
	const changes = new Map<string, Partial<CanvasNodeData>>();
	for (const n of nodes) changes.set(n.id, { width, height });
	applyNodeChanges(canvas, changes);
	return changes.size;
}

// ─── Viewport ─────────────────────────────────────────────────────────────────

/**
 * Zoom so the node fills 50–80% of the viewport — bigger nodes fill more.
 * Padding is derived from the fill target so `zoomToBbox` lands exactly right.
 */
export function zoomToNode(canvas: CanvasInternal, node: CanvasNodeData): void {
	const maxDim = Math.max(node.width, node.height);
	const t = Math.max(0, Math.min(1, (maxDim - 200) / 400));
	const fill = 0.5 + t * 0.3;
	const pad = maxDim * (1 / fill - 1) / 2;
	canvas.zoomToBbox?.({
		minX: node.x - pad,
		minY: node.y - pad,
		maxX: node.x + node.width + pad,
		maxY: node.y + node.height + pad,
	});
}
