/**
 * Shared by bench/bench.ts (whole-document workloads) and bench/editor.ts
 * (per-keystroke editor workloads): the deterministic ledger generator and
 * the measurement helpers.
 */
import { createHash } from 'node:crypto';

// Parsed dates are local-midnight `Date`s, so hashed outputs depend on the
// zone; the expected hashes were recorded in this one. Set before any date
// is built (this module is imported first).
process.env.TZ = 'Asia/Shanghai';

// ---------- deterministic ledger generator ----------
let seed = 0x9e3779b9;
function rand(): number {
	// mulberry32
	seed = (seed + 0x6d2b79f5) | 0;
	let t = seed;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const EXPENSES = [
	'Expenses:Food:Groceries',
	'Expenses:Food:Restaurant',
	'Expenses:Transport:Taxi',
	'Expenses:Transport:Metro',
	'Expenses:Home:Rent',
	'Expenses:Home:Utilities',
	'Expenses:Fun:Books',
	'Expenses:Health:Pharmacy',
	'Expenses:餐饮:午餐',
];
const ASSETS = ['Assets:Bank:Checking', 'Assets:Bank:Savings', 'Assets:Cash', 'Liabilities:CreditCard:Visa'];
const PAYEES = ['Whole Foods', 'Uber', 'Amazon', 'Landlord', 'City Power', 'Bookshop', '全家便利店', 'Pharmacy "Plus"'];
const TAGS = ['#trip-2023', '#work', '#family', '#reimburse'];

export function generateLedger(days: number): string {
	const out: string[] = [];
	out.push('option "title" "Benchmark Ledger"', 'option "operating_currency" "USD"', 'plugin "beancount.plugins.auto"', '');
	out.push('2020-01-01 commodity USD', '  name: "US Dollar"', '2020-01-01 commodity AAPL', '2020-01-01 commodity CNY', '');
	for (const a of [...ASSETS, ...EXPENSES, 'Assets:Broker:AAPL', 'Income:Salary', 'Income:Dividends', 'Equity:Opening-Balances']) {
		out.push(`2020-01-01 open ${a} USD,CNY,AAPL`);
	}
	out.push('', '2020-01-01 pad Assets:Bank:Savings Equity:Opening-Balances', '');
	let txnId = 0;
	for (let d = 0; d < days; d += 1) {
		const ds = new Date(Date.UTC(2020, 0, 2 + d)).toISOString().slice(0, 10);
		if (d % 30 === 0) out.push(`; ===== Month ${ds.slice(0, 7)} =====`, '');
		const n = 1 + Math.floor(rand() * 4);
		for (let i = 0; i < n; i += 1) {
			txnId += 1;
			const kind = rand();
			const tag = rand() < 0.2 ? ` ${pick(TAGS)}` : '';
			const link = rand() < 0.1 ? ` ^inv-${txnId}` : '';
			const payee = pick(PAYEES).replace(/"/g, '\\"');
			if (kind < 0.08) {
				const units = 1 + Math.floor(rand() * 20);
				const price = (100 + rand() * 100).toFixed(2);
				out.push(`${ds} * "Broker" "Buy AAPL"${tag}${link}`);
				out.push(`  Assets:Broker:AAPL   ${units} AAPL {${price} USD}`);
				out.push(`  Assets:Bank:Checking`);
			} else if (kind < 0.12) {
				out.push(`${ds} * "Employer" "Salary"`);
				out.push(`  trip: "none"`);
				out.push(`  Income:Salary  -5,000.00 USD`);
				out.push(`  Assets:Bank:Checking  4000.00 USD`);
				out.push(`  Assets:Bank:Savings  1000.00 USD ; save`);
			} else if (kind < 0.16) {
				const cny = (rand() * 500).toFixed(2);
				out.push(`${ds} ! "${payee}" "FX spend"${tag}`);
				out.push(`  Expenses:餐饮:午餐       ${cny} CNY @ 0.14 USD`);
				out.push(`  Liabilities:CreditCard:Visa`);
			} else {
				const amt = (1 + rand() * 300).toFixed(2);
				const exp = pick(EXPENSES);
				const src = pick(ASSETS);
				out.push(`${ds} * "${payee}" "Purchase ${txnId}"${tag}${link}`);
				if (rand() < 0.3) out.push(`  receipt: "r-${txnId}.pdf"`);
				out.push(`  ${exp}    ${amt} USD`);
				if (rand() < 0.5) out.push(`  ${src}   -${amt} USD`);
				else out.push(`  ${src}`);
			}
			out.push('');
		}
		if (d % 7 === 6) out.push(`${ds} price AAPL ${(120 + rand() * 60).toFixed(2)} USD`);
		if (d % 15 === 14) out.push(`${ds} note Assets:Cash "counted cash"`);
		if (d % 31 === 30) out.push(`${ds} event "location" "City ${d}"`);
		if (d % 45 === 44) out.push(`${ds} balance Assets:Cash  0.00 USD`, '');
	}
	return out.join('\n') + '\n';
}

/** Raw ledger with misaligned amounts and spacing for format/align. */
export function messUp(text: string): string {
	return text
		.split('\n')
		.map((line, i) => (line.startsWith('  ') ? line.replace(/\s{2,}(-?[0-9])/, i % 3 === 0 ? ' $1' : '      $1') : line))
		.join('\n');
}

export function fencedMarkdown(ledger: string): string {
	const chunks = ledger.split('\n\n');
	const out: string[] = ['# Journal', ''];
	for (let i = 0; i < chunks.length; i += 40) {
		out.push(`## Section ${i / 40}`, '', 'Some prose here.', '', '```beancount', chunks.slice(i, i + 40).join('\n\n'), '```', '');
	}
	return out.join('\n');
}

// ---------- measurement ----------
export const hash = (v: unknown) =>
	createHash('sha1')
		.update(typeof v === 'string' ? v : JSON.stringify(v, (_k, x: unknown): unknown => (x instanceof Set ? [...x] : x instanceof Map ? [...x] : x)))
		.digest('hex')
		.slice(0, 16);

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}

export function measure(fn: () => unknown, iters: number, warmup: number): { ms: number; result: unknown } {
	let result: unknown;
	for (let i = 0; i < warmup; i += 1) result = fn();
	const times: number[] = [];
	for (let i = 0; i < iters; i += 1) {
		const t0 = performance.now();
		result = fn();
		times.push(performance.now() - t0);
	}
	return { ms: median(times), result };
}
