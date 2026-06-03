import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from 'obsidian';
import { IndexStore } from '../index-store';

export interface TagSuggestion {
	value: string;
	dimensionId: string;
	dimensionName: string;
	score: number;
	inFile: boolean;
}

const LIST_LINE_RE = /^\s*[-*+]\s+(?:\[.\]\s+)?/;
const TAG_CHAR_RE = /[A-Za-z0-9/_-]/;

export class TagSuggest extends EditorSuggest<TagSuggestion> {
	constructor(app: App, private store: IndexStore) {
		super(app);
		this.limit = 20;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		if (!LIST_LINE_RE.test(line)) return null;
		const before = line.slice(0, cursor.ch);

		// Walk back from cursor: only tag-allowed chars are valid; the run must end at a '#'
		// preceded by start-of-line or whitespace.
		let hashPos = -1;
		for (let i = before.length - 1; i >= 0; i--) {
			const c = before.charAt(i);
			if (c === '#') {
				const prevOk = i === 0 || /\s/.test(before.charAt(i - 1));
				if (prevOk) hashPos = i;
				break;
			}
			if (!TAG_CHAR_RE.test(c)) return null;
		}
		if (hashPos < 0) return null;

		const query = before.slice(hashPos + 1);
		return {
			start: { line: cursor.line, ch: hashPos },
			end: cursor,
			query,
		};
	}

	getSuggestions(context: EditorSuggestContext): TagSuggestion[] {
		const cfg = this.store.getConfig();
		const dimById = new Map(cfg.dimensions.map(d => [d.id, d]));
		const inFile = this.store.tagsInFile(context.file.path);
		const byDim = this.store.tagsByDimension();

		// Global per-tag occurrence count for the frequency boost.
		const counts = new Map<string, number>();
		for (const { item, inheritedTags } of this.store.allItemsWithInheritance()) {
			const all = new Set([...inheritedTags, ...item.tags]);
			for (const t of all) counts.set(t, (counts.get(t) ?? 0) + 1);
		}

		const q = context.query.toLowerCase();
		const out: TagSuggestion[] = [];
		for (const [dimId, vals] of byDim) {
			const dim = dimById.get(dimId);
			// Time and auto dims are not #tags — skip.
			if (dim?.kind === 'time' || dim?.kind === 'auto') continue;
			for (const v of vals) {
				const lv = v.toLowerCase();
				let prefixScore: number;
				if (q === '') prefixScore = 1;
				else if (lv.startsWith(q)) prefixScore = 100;
				else if (lv.includes(q)) prefixScore = 30;
				else continue;
				const inF = inFile.has(v);
				out.push({
					value: v,
					dimensionId: dimId,
					dimensionName: dim?.name ?? dimId,
					score: prefixScore + (inF ? 50 : 0) + Math.log2((counts.get(v) ?? 0) + 1),
					inFile: inF,
				});
			}
		}
		out.sort((a, b) => b.score - a.score);
		return out.slice(0, this.limit);
	}

	renderSuggestion(s: TagSuggestion, el: HTMLElement): void {
		el.addClass('pm-suggest-row');
		const tag = el.createSpan({ cls: 'pm-suggest-tag', text: `#${s.value}` });
		if (s.inFile) tag.addClass('pm-suggest-infile');
		el.createSpan({
			cls: `pm-suggest-dim pm-chip pm-chip-${s.dimensionId}`,
			text: s.dimensionName,
		});
	}

	selectSuggestion(s: TagSuggestion, _evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) return;
		const ctx = this.context;
		const lineText = ctx.editor.getLine(ctx.end.line);
		const trailing = lineText.charAt(ctx.end.ch);
		const insertSpace = trailing !== '' && trailing !== ' ' && trailing !== '\t';
		const replacement = `#${s.value}${insertSpace ? ' ' : ''}`;
		ctx.editor.replaceRange(replacement, ctx.start, ctx.end);
		ctx.editor.setCursor({ line: ctx.end.line, ch: ctx.start.ch + replacement.length });
	}
}
