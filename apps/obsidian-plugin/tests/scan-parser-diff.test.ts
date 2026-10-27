/**
 * Scanner vs `@repo/beancount-parser` on inputs the parser accepts.
 * Compared only on the ACCOUNT_SHAPE ∩ g4 intersection; damaged entries
 * must be absent on a legal ledger.
 */
import { describe, expect, it } from 'vitest';
import { BeancountParser, BeancountSyntaxError, Transaction } from '@repo/beancount-parser';
import { generateLedger } from '../bench/common';
import { ACCOUNT_SHAPE, canonicalTxnFlag, scanLedger } from '../scan';

const ACCOUNT_FULL = new RegExp(`^${ACCOUNT_SHAPE}$`, 'u');

function unescapeLiteral(text: string): string {
	return text.includes('\\') ? text.replace(/\\(.)/g, '$1') : text;
}

function isoDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function diffAgainstParser(text: string): void {
	let parsed;
	try {
		parsed = BeancountParser.parse(text);
	} catch (e) {
		if (e instanceof BeancountSyntaxError) return;
		throw e;
	}
	const scanned = scanLedger(text);
	expect(scanned.entries.filter((entry) => entry.damaged)).toEqual([]);

	const txns = parsed.directives.filter((d): d is Transaction => d instanceof Transaction);
	const scannedTxns = scanned.entries.filter((entry) => entry.header !== undefined && entry.header.keyword === undefined);
	expect(scannedTxns).toHaveLength(txns.length);

	for (let i = 0; i < txns.length; i += 1) {
		const txn = txns[i];
		const entry = scannedTxns[i];
		const header = entry.header;
		expect(header).toBeDefined();
		if (header === undefined) continue;
		expect(header.date.replace(/\//g, '-')).toBe(isoDate(txn.date));
		expect(canonicalTxnFlag(header.flag ?? '*')).toBe(txn.flag);
		if (txn.payee !== null && header.payee !== undefined) {
			const line = text.split('\n')[entry.startLine] ?? '';
			expect(unescapeLiteral(line.slice(header.payee.from, header.payee.to))).toBe(txn.payee);
		}
		const parserAccounts = txn.postings.map((p) => p.account).filter((name) => ACCOUNT_FULL.test(name));
		const scannerAccounts = entry.postings
			.map((p) => p.account?.text)
			.filter((name): name is string => name !== undefined && ACCOUNT_FULL.test(name));
		expect(scannerAccounts).toEqual(parserAccounts);
	}
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
		];
		for (const text of fragments) diffAgainstParser(text + '\n');
	});
});
