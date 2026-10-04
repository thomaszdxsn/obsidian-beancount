/**
 * Beancount directive snippets, ported from vscode-beancount's
 * `snippets/beancount.json` plus a `txn` template.
 *
 * Obsidian has no snippet engine, so the plugin expands these itself:
 * `$CURRENT_*` becomes today's local date at expand time, and `$1` /
 * `${1:default}` / `${1|a,b|}` become tab stops. Typing a prefix at
 * column 0 offers matching snippets; picking one inserts the body.
 */
import { todayDate } from './insert-date';

export interface Snippet {
	prefix: string;
	description: string;
	body: string;
}

/** A `$n` range inside the expanded text, offsets into `Expansion.text`. */
export interface TabStop {
	index: number;
	from: number;
	to: number;
}

export interface Expansion {
	text: string;
	/** Visit order: `$1`, `$2`, … then `$0` if present. */
	stops: TabStop[];
}

const DATE = '$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE';

/**
 * The vscode-beancount set, with `txn` as `YYYY-MM-DD * "" ""` so the
 * caret lands in the payee field and payee completion still triggers.
 */
export const SNIPPETS: readonly Snippet[] = [
	{ prefix: 'option', description: 'Add option.', body: `option "\${1:name}" "\${2:value}"\n$0` },
	{ prefix: 'open', description: 'Open an account.', body: `${DATE} open \${1:Assets:} $2\n$0` },
	{ prefix: 'close', description: 'Close an account.', body: `${DATE} close \${1:Assets:}\n$0` },
	{
		prefix: 'commodity',
		description: 'Add a commodity metadata (optional).',
		body: `${DATE} commodity \${1:ISO/Ticker}\n  name: "\${2:FullName}"\n  asset-class: "\${3:cash}"\n$0`,
	},
	{ prefix: 'txn', description: 'Add a transaction.', body: `${DATE} * "$1" "$2"` },
	{
		prefix: 'txn*',
		description: 'Add a completed transaction.',
		body: `${DATE} * "$1" "$2"\n  $0`,
	},
	{
		prefix: 'txn!',
		description: 'Add an incomplete transaction.',
		body: `${DATE} ! "$1" "$2"\n  $0`,
	},
	{
		prefix: 'balance',
		description: 'Assert balance on given day.',
		body: `${DATE} balance \${1:Assets:} \${2:Amount}\n$0`,
	},
	{ prefix: 'pad', description: 'Pad balance between two accounts.', body: `${DATE} pad \${1:AccountTo} \${2:AccountFrom}\n$0` },
	{ prefix: 'note', description: 'Insert a dated comment.', body: `${DATE} note \${1:Assets:} \${2:Description}\n$0` },
	{
		prefix: 'document',
		description: 'Insert a dated document relating to a account.',
		body: `${DATE} document \${1:Assets:} "\${2:PathToDocument}"\n$0`,
	},
	{
		prefix: 'price',
		description: 'Add a dated price between commodities (for unrealized gains).',
		body: `${DATE} price \${1:Commodity} \${2:Price}\n$0`,
	},
	{ prefix: 'event', description: 'Add a dated event/variable to track.', body: `${DATE} event "\${1:Key}" "\${2:Value}"\n$0` },
	{ prefix: 'plugin', description: 'Load a plugin.', body: `plugin "\${1:PluginName}" "\${2:ConfigString}"\n$0` },
	{ prefix: 'include', description: 'Include a beancount file.', body: `include "\${1:Filename}"\n$0` },
	{
		prefix: 'query',
		description: 'Insert query into the stream of transactions.',
		body: `${DATE} query "\${1:Name}" "\${2:SQLContents}"\n$0`,
	},
	{ prefix: 'custom', description: 'Add a custom directive.', body: `${DATE} custom "\${1:TypeName}" \${2:Value...}\n$0` },
	{ prefix: 'pushtag', description: 'Push a tag onto the stack.', body: 'pushtag #${1:TagName}\n$0' },
	{ prefix: 'poptag', description: 'Pop a tag from the stack.', body: 'poptag #${1:TagName}\n$0' },
	{
		prefix: 'budget',
		description: 'Add a Fava compatible budget directive.',
		body: `${DATE} custom "budget" \${1:Expenses:} "\${2|daily,weekly,monthly,quaterly,yearly|}" \${3:Amount}\n$0`,
	},
];

/** Snippets whose prefix starts with `query`, exact match first. */
export function matchSnippets(query: string): Snippet[] {
	return SNIPPETS.filter((snippet) => snippet.prefix.startsWith(query)).sort((a, b) => {
		const aExact = a.prefix === query ? 0 : 1;
		const bExact = b.prefix === query ? 0 : 1;
		return aExact - bExact || a.prefix.localeCompare(b.prefix);
	});
}

/**
 * Resolve date placeholders and collect `$n` ranges. Unknown `$` text is
 * left alone. A body with no stops gets a final caret at the end.
 */
export function expandSnippet(body: string, now: Date = new Date()): Expansion {
	const date = todayDate(now);
	const [year, month, day] = date.split('-');
	const withDates = body
		.replace(/\$\{CURRENT_YEAR\}|\$CURRENT_YEAR/g, year)
		.replace(/\$\{CURRENT_MONTH\}|\$CURRENT_MONTH/g, month)
		.replace(/\$\{CURRENT_DATE\}|\$CURRENT_DATE/g, day);

	const stopRe = /\$\{(\d+)(?::([^{}|]*)|\|([^}]*)\|)?\}|\$(\d+)/g;
	let text = '';
	const raw: TabStop[] = [];
	let cursor = 0;
	let match: RegExpExecArray | null;
	while ((match = stopRe.exec(withDates)) !== null) {
		text += withDates.slice(cursor, match.index);
		const index = Number(match[1] ?? match[4]);
		const placeholder = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3].split(',')[0] : '';
		const from = text.length;
		text += placeholder;
		raw.push({ index, from, to: text.length });
		cursor = match.index + match[0].length;
	}
	text += withDates.slice(cursor);

	const numbered = raw.filter((stop) => stop.index > 0).sort((a, b) => a.index - b.index);
	const zeros = raw.filter((stop) => stop.index === 0);
	const stops = numbered.concat(zeros);
	if (stops.length === 0) stops.push({ index: 0, from: text.length, to: text.length });
	return { text, stops };
}
