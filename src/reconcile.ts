import { App, TFile } from 'obsidian';
import { IndexStore } from './index-store';

export interface StampResult {
	hadTimeDim: boolean;   // false if no time dimension is configured (nothing done)
	files: number;         // files written
	items: number;         // items stamped
	dimId: string;         // time dimension used
	date: string;          // date written (today)
}

export function todayStr(d = new Date()): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Append `%% <timeDim>:<today> %%` to every item missing a value for any time
 * dimension. Strictly additive: it never edits item prose, never removes a
 * line, and never re-stamps an item that already has a time value. `exclude`
 * skips whole files (e.g. the note you're actively editing); `only` restricts
 * to a set of files. This is the single write path shared by the manual "stamp"
 * button and the background reconciler.
 */
export async function stampMissingDates(
	app: App,
	store: IndexStore,
	opts: { exclude?: ReadonlySet<string>; only?: ReadonlySet<string> } = {},
): Promise<StampResult> {
	const cfg = store.getConfig();
	const timeDimIds = new Set(cfg.dimensions.filter(d => d.kind === 'time').map(d => d.id));
	const dimId = cfg.dimensions.find(d => d.kind === 'time')?.id;
	const date = todayStr();
	if (!dimId) return { hadTimeDim: false, files: 0, items: 0, dimId: '', date };

	// Collect lines needing a stamp, grouped by file.
	const toStamp = new Map<string, number[]>();
	for (const [path, items] of store.allFiles()) {
		if (opts.exclude?.has(path)) continue;
		if (opts.only && !opts.only.has(path)) continue;
		for (const item of items) {
			if (item.kind === 'index') continue;
			if (!item.meta.some(m => timeDimIds.has(m.key))) {
				const arr = toStamp.get(path) ?? [];
				arr.push(item.loc.line);
				toStamp.set(path, arr);
			}
		}
	}

	let items = 0;
	let files = 0;
	const commentRe = /%%([^%]*)%%/;
	// Line-level guard: skip a line that already carries this dim's key, so a
	// stale index (e.g. a file just written, not yet re-parsed) can never cause
	// a double `dimId:` stamp.
	const hasKeyRe = new RegExp(`(^|\\s)${dimId.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}:`);
	for (const [path, lineNums] of toStamp) {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) continue;
		const text = await app.vault.read(file);
		const lines = text.split(/\r?\n/);
		let changed = false;
		for (const n of lineNums) {
			const cur = lines[n];
			if (cur === undefined) continue;
			const existing = cur.match(commentRe);
			if (existing) {
				if (hasKeyRe.test(existing[1]!)) continue; // already stamped for this dim
				lines[n] = cur.replace(commentRe, `%%${existing[1]!.trimEnd()} ${dimId}:${date} %%`);
			} else {
				lines[n] = cur.trimEnd() + ` %% ${dimId}:${date} %%`;
			}
			items++;
			changed = true;
		}
		if (changed) { await app.vault.modify(file, lines.join('\n')); files++; }
	}
	return { hadTimeDim: true, files, items, dimId, date };
}
