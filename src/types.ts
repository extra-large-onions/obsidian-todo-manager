export type ItemKind = 'task' | 'knowledge' | 'index';

export type TaskStatus = 'todo' | 'doing' | 'done' | 'cancelled';

export interface SourceLoc {
	path: string;
	line: number;       // 0-based
	indent: number;     // leading whitespace columns
}

/** Parsed metadata key:value (e.g. added:2026-05-14). */
export interface MetaPair {
	key: string;
	value: string;
}

export interface Item {
	kind: ItemKind;
	text: string;             // line text minus list marker / checkbox / tags
	rawText: string;          // original line text
	loc: SourceLoc;
	tags: string[];           // raw tag strings (without leading '#'), e.g. "deployment/startup-sequence"
	meta: MetaPair[];         // parsed key:value pairs
	section: string[];        // heading path above this line, outermost first, e.g. ["Deployment", "Startup"]
	uncategorized: boolean;   // sits after a `---` separator within its section → topic is "Uncategorized"
	status?: TaskStatus;      // tasks only
	children: Item[];
}

// 'auto' dims are populated from item properties (kind/status), never from tags/metadata.
export type DimensionKind = 'tree' | 'radio' | 'checkbox' | 'time' | 'text' | 'auto';

export interface Dimension {
	id: string;               // stable id, e.g. "tree", "status", "time"
	name: string;             // display name
	kind: DimensionKind;
	/** Known tag values (for enum/tree); for time/free this is a list of recognized keys. */
	values: string[];
}

export interface ClassifiedTag {
	dimensionId: string;      // dimension this tag belongs to
	value: string;            // canonical value within the dimension
}
