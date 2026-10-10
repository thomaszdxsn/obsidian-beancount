/**
 * Payees: what counts as one (`extractPayees`) and how to recognize the
 * payee field while typing (`PAYEE_PREFIX_RE`). The vault-wide cache lives
 * in `VaultIndex`, fed by the extractor.
 *
 * A transaction line is `date flag "payee" "narration"`, so the entry's
 * first quoted field is the payee position — that is the field completed
 * here, and the one indexed from history. Indexing is literal: every
 * transaction line's first quoted field is a payee candidate, including
 * one-string entries (whose string beancount treats as the narration), so
 * the indexed set and the completed field stay the same thing. Narrations
 * (the second quoted field) are never indexed or completed.
 *
 * A payee spanning lines (an unterminated quote) is not indexed; beancount
 * allows it, no ledger writes it.
 */

/**
 * The first quoted field of a transaction line: `date`, the entry flag
 * (`txn` or a single flag character — the same shape the syntax mode's
 * `DATED_ENTRY_RE` accepts, `|` excluded), then the string. The body is the
 * raw literal as written, escapes included (`\"`, `\\`), which is exactly
 * what a typed prefix looks like and what must be re-inserted between the
 * quotes; it never crosses a line break or a quote. An empty field (`""`) is
 * not a payee.
 */
const PAYEE_LINE_RE =
	/^[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}[ \t]*(?:txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])[ \t]*"((?:[^"\\\n]|\\.)+)"/;
const PAYEE_RE = new RegExp(PAYEE_LINE_RE.source, 'gm');

/**
 * The same shape while typing: the first quoted field still open at the
 * cursor. A closed first field cannot match — the body never crosses a
 * quote — so the second field (the narration) never triggers.
 */
export const PAYEE_PREFIX_RE = /^[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}[ \t]*(?:txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])[ \t]*"((?:[^"\\\n]|\\.)*)$/;

/**
 * The payee of one transaction line: the same literal `extractPayees` indexes
 * and payee completion inserts. Null when the line is not a transaction or
 * the first quoted field is missing or empty.
 */
export function transactionPayee(line: string): string | null {
	return PAYEE_LINE_RE.exec(line)?.[1] ?? null;
}

export function extractPayees(content: string): ReadonlySet<string> {
	const payees = new Set<string>();
	for (const match of content.matchAll(PAYEE_RE)) payees.add(match[1]);
	return payees;
}
