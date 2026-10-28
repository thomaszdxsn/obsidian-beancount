/**
 * Commodities, tags, links and narrations: how to recognize each field
 * while typing (`COMMODITY_PREFIX_RE`, `TAG_PREFIX_RE`, `LINK_PREFIX_RE`,
 * `NARRATION_PREFIX_RE`). Vault-wide tokens live in `LedgerIndex`.
 */

/** A date, as every directive line opens. */
const DATE = '[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}';

/** The transaction flag, the same shape a payee prefix accepts. */
const FLAG = '(?:txn|[*!&#?%PSTCURM])';

/** A quoted string body, escapes included, never crossing a quote or line. */
const STRING_BODY = '(?:[^"\\\\\\n]|\\\\.)*';

/**
 * While typing: the partial commodity a cursor opens. A digit then the
 * token, a `price` currency, or a `commodity` directive name.
 */
export const COMMODITY_PREFIX_RE = new RegExp(
	`(?:[0-9][ \\t]+|${DATE}[ \\t]+price[ \\t]+|(?:^|[ \\t])(?:${DATE}[ \\t]+)?commodity[ \\t]+)([A-Z][A-Z0-9._'-]*)$`
);

/** While typing: the sigil plus the partial name still open at the cursor. */
export const TAG_PREFIX_RE = /(?:^|[ \t])#([A-Za-z0-9\-_/.]*)$/;
export const LINK_PREFIX_RE = /(?:^|[ \t])\^([A-Za-z0-9\-_/.]*)$/;

/** Characters that continue a tag or link token after the sigil. */
export const TAG_LINK_CHAR_RE = /[A-Za-z0-9\-_/.]/;
/** Characters that continue a commodity token. */
export const COMMODITY_CHAR_RE = /[A-Za-z0-9._'-]/;

/**
 * The narration field while typing: the payee string closed, the narration
 * string still open at the cursor. A closed second field cannot match —
 * the body never crosses a quote — so nothing after the field triggers.
 */
export const NARRATION_PREFIX_RE = new RegExp(
	`^${DATE}[ \\t]*${FLAG}(?![A-Za-z0-9])[ \\t]*"${STRING_BODY}"[ \\t]*"(${STRING_BODY})$`
);
