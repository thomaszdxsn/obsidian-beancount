/**
 * Commodities, tags, links and narrations: what counts as one
 * (`extractCommodities`, `extractTags`, `extractLinks`, `extractNarrations`)
 * and how to recognize each field while typing (`COMMODITY_PREFIX_RE`,
 * `TAG_PREFIX_RE`, `LINK_PREFIX_RE`, `NARRATION_PREFIX_RE`). The vault-wide
 * caches live in `VaultIndex`, fed by the extractors.
 *
 * Commodities are the uppercase tokens that carry an amount: a posting's
 * units, a cost or price annotation, a `balance` amount, both currencies of
 * a `price` directive, and the token a `commodity` directive declares. A
 * token shape alone would also match account segments (`Stocks:AAPL`), so
 * extraction is bound to those amount positions.
 *
 * Tags are `#name` and links are `^name` at a token boundary — the shapes
 * the syntax mode highlights (`TAG_RE` / `LINK_RE` there). The sigil is part
 * of the cached string, so a pick replaces the typed `#cr` with `#credit` in
 * one step. Markdown headings (`# Heading`) have no name and never match.
 *
 * A narration is the second quoted field of a transaction line
 * (`date flag "payee" "narration"`); the first quoted field is the payee's,
 * even on one-string entries, whose string beancount treats as the
 * narration — that field stays the payee's (see `payee-index.ts`). The
 * token shapes mirror `PAYEE_RE` there: the raw literal as written, escapes
 * included, never crossing a line break or a quote.
 */

/**
 * A commodity token: uppercase first, then uppercase/digits/`._'-`, ending
 * alphanumerically — the same shape the syntax mode highlights. Two chars
 * minimum (`C` alone is the shape of an account segment, not a currency).
 */
const COMMODITY_TOKEN = '[A-Z][A-Z0-9._\'-]{0,22}[A-Z0-9]';

/** A date, as every directive line opens. */
const DATE = '[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}';

/** The transaction flag, the same shape `PAYEE_RE` accepts. */
const FLAG = '(?:txn|[*!&#?%PSTCURM])';

/** A quoted string body, escapes included, never crossing a quote or line. */
const STRING_BODY = '(?:[^"\\\\\\n]|\\\\.)*';

/** The `commodity` directive, dated as beancount requires. */
const COMMODITY_DIRECTIVE_RE = new RegExp(
	`^[ \\t]*(?:${DATE}[ \\t]+)?commodity[ \\t]+(${COMMODITY_TOKEN})(?![A-Z0-9])`,
	'gm'
);

/** The currency a `price` directive prices: right after the keyword. */
const PRICE_DIRECTIVE_RE = new RegExp(
	`^${DATE}[ \\t]+price[ \\t]+(${COMMODITY_TOKEN})(?![A-Z0-9])`,
	'gm'
);

/** An amount's commodity: a digit, whitespace, then the token. */
const AMOUNT_RE = new RegExp(`[0-9][ \\t]+(${COMMODITY_TOKEN})(?![A-Z0-9])`, 'g');

/** Lines whose amounts carry commodities: postings (indented) and `balance`/`price` dates. */
const AMOUNT_LINE_RE = /^[ \t]|[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}[ \t]+(?:balance|price)(?![A-Za-z0-9])/;

export function extractCommodities(content: string): ReadonlySet<string> {
	const commodities = new Set<string>();
	for (const match of content.matchAll(COMMODITY_DIRECTIVE_RE)) commodities.add(match[1]);
	for (const match of content.matchAll(PRICE_DIRECTIVE_RE)) commodities.add(match[1]);
	for (const line of content.split('\n')) {
		if (!AMOUNT_LINE_RE.test(line)) continue;
		for (const match of line.matchAll(AMOUNT_RE)) commodities.add(match[1]);
	}
	return commodities;
}

/**
 * While typing: the partial commodity a cursor opens. A digit then the
 * token covers posting units, costs, prices and `balance` amounts; the
 * `price` and `commodity` keywords cover their directives' first token.
 * One typed letter already matches — cached commodities are complete
 * tokens, so completion starts from the first keystroke.
 */
export const COMMODITY_PREFIX_RE = new RegExp(
	`(?:[0-9][ \\t]+|${DATE}[ \\t]+price[ \\t]+|(?:^|[ \\t])(?:${DATE}[ \\t]+)?commodity[ \\t]+)([A-Z][A-Z0-9._'-]*)$`
);

/** A tag while indexing: sigil kept, so a cached value completes `#cr` to `#credit`. */
const TAG_RE = /(?:^|[ \t])#([A-Za-z0-9\-_/.]+)/gm;

/** A link while indexing: sigil kept, so a cached value completes `^pa` to `^patent`. */
const LINK_RE = /(?:^|[ \t])\^([A-Za-z0-9\-_/.]+)/gm;

export function extractTags(content: string): ReadonlySet<string> {
	const tags = new Set<string>();
	for (const match of content.matchAll(TAG_RE)) tags.add(`#${match[1]}`);
	return tags;
}

export function extractLinks(content: string): ReadonlySet<string> {
	const links = new Set<string>();
	for (const match of content.matchAll(LINK_RE)) links.add(`^${match[1]}`);
	return links;
}

/** While typing: the sigil plus the partial name still open at the cursor. */
export const TAG_PREFIX_RE = /(?:^|[ \t])#([A-Za-z0-9\-_/.]*)$/;
export const LINK_PREFIX_RE = /(?:^|[ \t])\^([A-Za-z0-9\-_/.]*)$/;

/** A transaction's second quoted field, fully written. */
const NARRATION_RE = new RegExp(
	`^${DATE}[ \\t]*${FLAG}(?![A-Za-z0-9])[ \\t]*"${STRING_BODY}"[ \\t]*"((?:[^"\\\\\\n]|\\\\.)+)"`,
	'gm'
);

export function extractNarrations(content: string): ReadonlySet<string> {
	const narrations = new Set<string>();
	for (const match of content.matchAll(NARRATION_RE)) narrations.add(match[1]);
	return narrations;
}

/**
 * The same field while typing: the payee string closed, the narration
 * string still open at the cursor. A closed second field cannot match —
 * the body never crosses a quote — so nothing after the field triggers.
 */
export const NARRATION_PREFIX_RE = new RegExp(
	`^${DATE}[ \\t]*${FLAG}(?![A-Za-z0-9])[ \\t]*"${STRING_BODY}"[ \\t]*"(${STRING_BODY})$`
);
