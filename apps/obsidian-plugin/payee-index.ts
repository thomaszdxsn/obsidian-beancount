/**
 * Payees: how to recognize the payee field while typing (`PAYEE_PREFIX_RE`)
 * and the first quoted field of a transaction line (`transactionPayee`).
 * Vault-wide payee facts live in `LedgerIndex`.
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
import { headerPayee, parseHeaderLine } from './scan';

/**
 * The same shape while typing: the first quoted field still open at the
 * cursor. A closed first field cannot match — the body never crosses a
 * quote — so the second field (the narration) never triggers.
 */
export const PAYEE_PREFIX_RE =
	/^[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}[ \t]*(?:txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])[ \t]*"((?:[^"\\\n]|\\.)*)$/;

/**
 * The payee of one transaction line: the same literal the index stores
 * and payee completion inserts. Null when the line is not a transaction or
 * the first quoted field is missing or empty.
 */
export function transactionPayee(line: string): string | null {
	const header = parseHeaderLine(line);
	if (header === null || header.kind !== 'txn-header') return null;
	return headerPayee(line, header) ?? null;
}
