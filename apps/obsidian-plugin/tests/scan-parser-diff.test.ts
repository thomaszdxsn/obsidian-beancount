/**
 * Scanner vs `@repo/beancount-parser` on inputs the parser accepts.
 * Compared only on the ACCOUNT_SHAPE ∩ g4 intersection; damaged entries
 * must be absent on a legal ledger.
 */
import { describe, expect, it } from 'vitest';
import {
	Balance,
	BeancountParser,
	Close,
	Open,
	Transaction,
} from '@repo/beancount-parser';
import { generateLedger } from '../bench/common';
import { ACCOUNT_SHAPE, canonicalTxnFlag, scanLedger, unescapeQuoted } from '../scan';

const ACCOUNT_FULL = new RegExp(`^${ACCOUNT_SHAPE}$`, 'u');

function isoDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function diffAgainstParser(text: string): void {
	const parsed = BeancountParser.parse(text);
	const scanned = scanLedger(text);
	expect(scanned.entries.filter((entry) => entry.damaged)).toEqual([]);
	const lines = text.split('\n');

	const txns = parsed.directives.filter((d): d is Transaction => d instanceof Transaction);
	const scannedTxns = scanned.entries.filter((entry) => entry.header?.kind === 'txn-header');
	expect(scannedTxns).toHaveLength(txns.length);

	for (let i = 0; i < txns.length; i += 1) {
		const txn = txns[i];
		const entry = scannedTxns[i];
		const header = entry.header;
		expect(header).toBeDefined();
		if (header === undefined) continue;
		expect(header.date.replace(/\//g, '-')).toBe(isoDate(txn.date));
		expect(canonicalTxnFlag(header.flag ?? '*')).toBe(txn.flag);
		if (txn.location) {
			expect(entry.startLine).toBe(txn.location.start.line - 1);
			expect(entry.endLine).toBeGreaterThanOrEqual(txn.location.end.line - 1);
		}
		if (txn.payee !== null) {
			expect(header.payee).toBeDefined();
			const line = lines[entry.startLine] ?? '';
			expect(unescapeQuoted(line.slice(header.payee!.from, header.payee!.to))).toBe(txn.payee);
		}
		const parserAccounts = txn.postings.map((p) => p.account).filter((name) => ACCOUNT_FULL.test(name));
		const scannerAccounts = entry.postings.map((p) => p.account.text).filter((name) => ACCOUNT_FULL.test(name));
		expect(scannerAccounts).toEqual(parserAccounts);
		const parserPostings = txn.postings.filter((p) => ACCOUNT_FULL.test(p.account));
		const scannerPostings = entry.postings.filter((p) => ACCOUNT_FULL.test(p.account.text));
		expect(scannerPostings.map((p) => p.account.text)).toEqual(parserPostings.map((p) => p.account));
		for (let p = 0; p < parserPostings.length; p += 1) {
			const posting = parserPostings[p];
			const scannedPosting = scannerPostings[p];
			expect(scannedPosting.leadingFlag ?? scannedPosting.trailingFlag).toBe(posting.flag);
			const amount = posting.amount;
			if (amount && 'currency' in amount && amount.currency) {
				expect(scannedPosting.commodity).toBeDefined();
			}
			expect(scannedPosting.hasCost).toBe(posting.cost !== undefined);
			expect(scannedPosting.hasPrice).toBe(posting.priceAnnotation !== undefined);
		}
	}

	const opens = parsed.directives.filter((d): d is Open => d instanceof Open);
	const closes = parsed.directives.filter((d): d is Close => d instanceof Close);
	const balances = parsed.directives.filter((d): d is Balance => d instanceof Balance);
	const scannedDirs = scanned.entries.filter((entry) => entry.header?.keyword !== undefined);
	expect(scannedDirs.filter((e) => e.header?.keyword === 'open').length).toBe(opens.length);
	expect(scannedDirs.filter((e) => e.header?.keyword === 'close').length).toBe(closes.length);
	expect(scannedDirs.filter((e) => e.header?.keyword === 'balance').length).toBe(balances.length);
}

describe('scanLedger vs BeancountParser', () => {
	it('agrees with the parser on generateLedger(90)', () => {
		diffAgainstParser(generateLedger(90));
	});

	it('agrees on handwritten legal fragments', () => {
		const fragments = [
			['2026-01-01 open Expenses:餐饮 CNY', '2026-01-02 * "面馆" "午餐"', '  Expenses:餐饮  18.00 CNY', '  Assets:Cash'].join('\n'),
			['2026/01/02 * "Cafe"', '  Expenses:Food  1.00 USD', '  Assets:Cash'].join('\n'),
			['2026-10-01! "x"', '  Expenses:Food  1.00 USD', '  Assets:Cash'].join('\n'),
			['2026-10-01 * "Say \\"hi\\"" "n"', '  Assets:Cash  1.00 USD', '  Income:Job'].join('\n'),
			['2026-10-01 * "x" "a ; b"', '  Assets:Cash  1.00 USD', '  Income:Job'].join('\n'),
			['2026-01-01 close Assets:Cash', '2026-01-02 balance Assets:Cash 0 USD'].join('\n'),
		];
		for (const text of fragments) diffAgainstParser(text + '\n');
	});
});
