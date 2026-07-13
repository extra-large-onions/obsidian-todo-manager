import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';

/**
 * Live config, held as a single stable object so settings changes are picked up
 * on the next rebuild (call `app.workspace.updateOptions()` after mutating it).
 */
export interface ConcealConfig {
	enabled: boolean;      // master switch
	concealTags: boolean;  // also hide inline #tags (metadata %%...%% is always hidden when enabled)
}

// `%%...%%` metadata block, including any whitespace immediately before it.
const META_RE = /\s*%%[^%]*%%/g;
// An inline #tag, capturing a leading whitespace char so we can keep it.
const TAG_RE = /(^|\s)#[A-Za-z][A-Za-z0-9/_-]*/g;

const HIDE = Decoration.replace({});

/**
 * Conceal plugin metadata (and optionally #tags) in the editor. The raw text of
 * a line is revealed whenever the cursor or a selection touches that line, so
 * everything stays fully editable — it's a display transform, not a data change.
 */
export function concealExtension(config: ConcealConfig) {
	return ViewPlugin.fromClass(
		class implements PluginValue {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}

			update(u: ViewUpdate): void {
				if (u.docChanged || u.viewportChanged || u.selectionSet) {
					this.decorations = this.build(u.view);
				}
			}

			private build(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				if (!config.enabled) return builder.finish();

				// Lines touched by any cursor/selection are shown raw.
				const active = new Set<number>();
				for (const r of view.state.selection.ranges) {
					const from = view.state.doc.lineAt(r.from).number;
					const to = view.state.doc.lineAt(r.to).number;
					for (let n = from; n <= to; n++) active.add(n);
				}

				for (const { from, to } of view.visibleRanges) {
					let pos = from;
					while (pos <= to) {
						const line = view.state.doc.lineAt(pos);
						if (!active.has(line.number)) this.concealLine(line.from, line.text, builder);
						pos = line.to + 1;
					}
				}
				return builder.finish();
			}

			private concealLine(offset: number, text: string, builder: RangeSetBuilder<Decoration>): void {
				const ranges: Array<[number, number]> = [];

				META_RE.lastIndex = 0;
				let m: RegExpExecArray | null;
				while ((m = META_RE.exec(text)) !== null) {
					ranges.push([offset + m.index, offset + m.index + m[0].length]);
				}

				if (config.concealTags) {
					TAG_RE.lastIndex = 0;
					while ((m = TAG_RE.exec(text)) !== null) {
						const lead = m[1] ? m[1].length : 0; // keep the leading space, hide the #tag
						ranges.push([offset + m.index + lead, offset + m.index + m[0].length]);
					}
				}

				// RangeSetBuilder needs ranges added in order and non-overlapping.
				ranges.sort((a, b) => a[0] - b[0]);
				let last = -1;
				for (const [s, e] of ranges) {
					if (e <= s || s < last) continue;
					builder.add(s, e, HIDE);
					last = e;
				}
			}
		},
		{ decorations: v => v.decorations },
	);
}
