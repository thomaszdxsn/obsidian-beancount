/**
 * Account hover: known names get a card (open/close/currencies); unknown
 * names and non-account tokens stay quiet. The CodeMirror `hoverTooltip`
 * is the test double; the behaviour under test is when a tooltip appears
 * and what its DOM contains.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AccountIndex } from '../account-index';
import {
	ACCOUNT_HOVER_CLASS,
	ACCOUNT_HOVER_NAME_CLASS,
	accountHoverTooltip,
	renderAccountHover,
} from '../account-hover';
import type { MockHoverTooltip } from './mocks/codemirror';

interface HoverDoc {
	lineAt(pos: number): { from: number; to: number; text: string };
}

/** A document of `text` with CodeMirror-like `lineAt` (newline belongs to the previous line). */
function fakeDoc(text: string): HoverDoc {
	const pieces = text.split('\n');
	const spans = pieces.map((piece, index) => {
		const from = pieces.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
		return { from, to: from + piece.length, text: piece };
	});
	return {
		lineAt: (pos: number) => spans.find((span) => pos <= span.to) ?? spans[spans.length - 1],
	};
}

function view(text: string) {
	return { state: { doc: fakeDoc(text) } };
}

function source(accounts: AccountIndex) {
	return (accountHoverTooltip(accounts) as unknown as MockHoverTooltip).source;
}

class FakeEl {
	className = '';
	textContent: string | null = '';
	childNodes: FakeEl[] = [];
	constructor(readonly tagName: string) {}
	appendChild(child: FakeEl): FakeEl {
		this.childNodes.push(child);
		return child;
	}
}

function installDocument(): void {
	globalThis.document = {
		createElement: (tag: string) => new FakeEl(tag),
	} as unknown as Document;
}

function ledger(): AccountIndex {
	const index = new AccountIndex();
	index.setFileContent(
		'a.bean',
		[
			'2020-01-01 open Assets:Cash USD',
			'2021-01-01 close Assets:Cash',
			'2020-01-01 open Assets:Broker CNY, EUR',
			'  Expenses:Food  10.00 USD',
		].join('\n')
	);
	return index;
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'document');
});

describe('accountHoverTooltip', () => {
	it('returns a tooltip spanning a known account, including closed ones', () => {
		const hover = source(ledger());
		const closed = hover(view('  Assets:Cash  10.00 USD'), 2);
		expect(closed).toMatchObject({ pos: 2, end: 13 });
		const open = hover(view('Assets:Broker'), 0);
		expect(open).toMatchObject({ pos: 0, end: 13 });
	});

	it('stays quiet for unknown account-shaped names and non-account text', () => {
		const hover = source(ledger());
		expect(hover(view('  Expenses:Ghost  1.00 USD'), 2)).toBeNull();
		expect(hover(view('just prose'), 3)).toBeNull();
		expect(hover(view('Assets:'), 3)).toBeNull();
	});

	it('picks the account under the cursor when a line has two', () => {
		const hover = source(ledger());
		const text = 'Assets:Cash Assets:Broker';
		expect(hover(view(text), 0)).toMatchObject({ pos: 0, end: 11 });
		expect(hover(view(text), 12)).toMatchObject({ pos: 12, end: 25 });
	});

	it('still hovers a posting-only known name', () => {
		const hover = source(ledger());
		expect(hover(view('  Expenses:Food'), 2)).toMatchObject({ pos: 2, end: 15 });
	});

	it('covers the token at both ends and across a newline boundary', () => {
		const hover = source(ledger());
		const text = 'pay Assets:Cash\nnext';
		expect(hover(view(text), 4)).toMatchObject({ pos: 4, end: 15 });
		expect(hover(view(text), 15)).toMatchObject({ pos: 4, end: 15 });
		expect(hover(view(text), 16)).toBeNull();
	});

	it('creates a markdown-list card with open, close and currencies', () => {
		installDocument();
		const hover = source(ledger());
		const tooltip = hover(view('Assets:Cash'), 0);
		const { dom } = tooltip!.create() as { dom: FakeEl };
		expect(dom.className).toBe(ACCOUNT_HOVER_CLASS);
		expect(dom.childNodes[0]?.className).toBe(ACCOUNT_HOVER_NAME_CLASS);
		expect(dom.childNodes[0]?.textContent).toBe('Assets:Cash');
		expect(dom.childNodes[1]?.tagName).toBe('ul');
		expect(dom.childNodes[1]?.childNodes.map((item) => item.textContent)).toEqual([
			'opened on 2020-01-01',
			'closed on 2021-01-01',
			'currencies: USD',
		]);
	});

	it('omits the list when a known name has no lifecycle fields', () => {
		installDocument();
		const hover = source(ledger());
		const { dom } = hover(view('Expenses:Food'), 0)!.create() as { dom: FakeEl };
		expect(dom.childNodes).toHaveLength(1);
		expect(dom.childNodes[0]?.textContent).toBe('Expenses:Food');
	});
});

describe('renderAccountHover', () => {
	it('renders only the name when there are no extra lines', () => {
		installDocument();
		const dom = renderAccountHover({ name: 'Assets:Cash', lines: [] }) as unknown as FakeEl;
		expect(dom.className).toBe(ACCOUNT_HOVER_CLASS);
		expect(dom.childNodes).toHaveLength(1);
		expect(dom.childNodes[0]?.textContent).toBe('Assets:Cash');
	});
});
