import { describe, expect, it, vi } from 'vitest';
import type { App, Editor, EditorSuggestContext, TFile } from 'obsidian';
import { AccountIndex } from '../account-index';
import { AccountSuggest } from '../account-suggest';
import { CompletionUsage, rankCompletions } from '../completion-rank';
import { PayeeSuggest } from '../payee-suggest';
import { extractPayees } from '../payee-index';
import { PINYIN_INITIALS_CACHE_CAP, pinyinInitials } from '../pinyin';
import { NarrationSuggest } from '../token-suggest';
import { extractNarrations } from '../token-index';
import { VaultIndex } from '../vault-index';
import { createEditor } from './fakes';

describe('pinyinInitials', () => {
	it('keeps ASCII and punctuation lowercased and maps CJK to initials', () => {
		expect(pinyinInitials('Expenses:餐饮')).toBe('expenses:cy');
		expect(pinyinInitials('A1:餐饮-卡')).toBe('a1:cy-k');
		expect(pinyinInitials('卡片-贷款')).toBe('kp-dk');
		expect(pinyinInitials('')).toBe('');
	});

	it('uses the single initial the table assigns for polyphonic characters', () => {
		// 行 is xing here, not hang; 乐 is le, not yue; 长 is zhang, not chang.
		expect(pinyinInitials('银行')).toBe('yx');
		expect(pinyinInitials('音乐')).toBe('yl');
		expect(pinyinInitials('成长')).toBe('cz');
		expect(pinyinInitials('银行')).not.toBe('yh');
	});

	it('keeps characters the table does not list, including a supplementary-plane character', () => {
		expect(pinyinInitials('A€餐')).toBe('a€c');
		expect(pinyinInitials('𠮷餐')).toBe('𠮷c');
	});

	it('returns the same initials for a repeated value, including after the cache clears', () => {
		expect(pinyinInitials('Expenses:餐饮')).toBe('expenses:cy');
		expect(pinyinInitials('Expenses:餐饮')).toBe('expenses:cy');
		expect(pinyinInitials('卡片-贷款')).toBe(pinyinInitials('卡片-贷款'));
		// Distinct keys past the cap force a clear. Evicted values must convert the same way.
		for (let i = 0; i < PINYIN_INITIALS_CACHE_CAP; i++) pinyinInitials(`cache-fill-${i}`);
		expect(pinyinInitials('cache-fill-0')).toBe('cache-fill-0');
		expect(pinyinInitials(`cache-fill-${PINYIN_INITIALS_CACHE_CAP - 1}`)).toBe(
			`cache-fill-${PINYIN_INITIALS_CACHE_CAP - 1}`
		);
		expect(pinyinInitials('Expenses:餐饮')).toBe('expenses:cy');
		expect(pinyinInitials('银行')).toBe('yx');
		expect(pinyinInitials('A€餐')).toBe('a€c');
		expect(pinyinInitials('𠮷餐')).toBe('𠮷c');
		expect(pinyinInitials('')).toBe('');
	});
});

describe('rankCompletions pinyin tiers', () => {
	const values = ['餐饮', 'Cash', 'Account', 'Expenses:餐饮', '茶叶'];

	it('does not match initials when pinyin is off', () => {
		expect(rankCompletions(values, 'cy')).toEqual([]);
		expect(rankCompletions(values, 'Expenses:cy')).toEqual([]);
		expect(rankCompletions(['Assets:Cash', 'Expenses:Food'], 'e')).toEqual([
			'Expenses:Food',
			'Assets:Cash',
		]);
		expect(rankCompletions(values, '')).toEqual([...values].sort());
	});

	it('ranks direct prefix, pinyin prefix, direct subsequence, then pinyin subsequence', () => {
		expect(rankCompletions(values, 'c', undefined, true)).toEqual([
			'Cash',
			'茶叶',
			'餐饮',
			'Account',
			'Expenses:餐饮',
		]);
		expect(rankCompletions(values, 'cy', undefined, true)).toEqual(['茶叶', '餐饮', 'Expenses:餐饮']);
		expect(rankCompletions(values, 'Expenses:cy', undefined, true)).toEqual(['Expenses:餐饮']);
		expect(rankCompletions(values, 'expenses:CY', undefined, true)).toEqual(['Expenses:餐饮']);
	});

	it('breaks ties inside a pinyin tier by frecency, without crossing tiers', () => {
		const usage = CompletionUsage.parse({}, () => Date.now());
		usage.remember('餐饮');
		usage.remember('餐饮');
		expect(rankCompletions(values, 'c', usage, true)).toEqual([
			'Cash',
			'餐饮',
			'茶叶',
			'Account',
			'Expenses:餐饮',
		]);
		// A hot pinyin subsequence still sits behind a cold direct subsequence.
		expect(rankCompletions(['餐饮', 'Payee', 'Yacht'], 'y', usage, true)).toEqual([
			'Yacht',
			'Payee',
			'餐饮',
		]);
	});

	it('does not treat an unknown character as an initial', () => {
		expect(rankCompletions(['A€餐', '银行'], 'yh', undefined, true)).toEqual([]);
		expect(rankCompletions(['A€餐'], '€c', undefined, true)).toEqual(['A€餐']);
	});

	it('ranks pure ASCII the same with pinyin on', () => {
		const ascii = ['A1-B2', 'Account', 'Assets:Broker:IBKR', 'Assets:Cash:Wallet', 'Expenses:Food'];
		const usage = CompletionUsage.parse(
			{
				completionUsage: {
					Account: { count: 9, lastUsed: 1 },
					'A1-B2': { count: 1, lastUsed: 1 },
				},
			},
			() => 1
		);
		for (const query of ['', 'a', 'e', 'fo', 'c', '12', 'Assets:', 'xyz', 'ASSETS:C']) {
			expect(rankCompletions(ascii, query, usage, true)).toEqual(rankCompletions(ascii, query, usage));
		}
	});

	it('keeps a pinyin prefix ahead of a direct subsequence of the same name', () => {
		// 'c' is a direct subsequence of 餐饮Cash (the ASCII tail) and of Account.
		// It is also a pinyin prefix of 餐饮Cash, which must win. Code-point order
		// would put Account first if both were filed as subsequences.
		expect(rankCompletions(['Account', '餐饮Cash'], 'c', undefined, true)).toEqual([
			'餐饮Cash',
			'Account',
		]);
		expect(rankCompletions(['Account', '餐饮Cash'], 'c')).toEqual(['Account', '餐饮Cash']);
	});
});

describe('account and payee pinyin completion', () => {
	it('matches Expenses:cy to Expenses:餐饮 only while the getter is on, and hides closed names', () => {
		let on = false;
		const index = new AccountIndex(undefined, () => on);
		index.setFileContent(
			'a.bean',
			[
				'2020-01-01 open Expenses:餐饮',
				'2020-01-01 open Expenses:Food',
				'2020-01-01 open Expenses:Cash',
				'2020-01-01 open Expenses:餐饮:午饭',
				'2021-01-01 close Expenses:餐饮:午饭',
			].join('\n')
		);
		expect(index.match('Expenses:cy')).toEqual([]);
		expect(index.match('Expenses:C')).toEqual(['Expenses:Cash']);
		on = true;
		expect(index.match('Expenses:cy')).toEqual(['Expenses:餐饮']);
		expect(index.match('Expenses:cy:wf')).toEqual([]);
		// Direct prefix still outranks a pinyin prefix of the same query.
		expect(index.match('Expenses:C')).toEqual(['Expenses:Cash', 'Expenses:餐饮']);
	});

	it('triggers on an ASCII account query and inserts the account, not the initials', () => {
		const index = new AccountIndex(undefined, () => true);
		index.setFileContent('a.bean', '2020-01-01 open Expenses:餐饮 USD');
		const suggest = new AccountSuggest({} as App, index);
		const line = '  Expenses:cy';
		const editor = createEditor([line]);
		const info = suggest.onTrigger({ line: 0, ch: line.length }, editor as unknown as Editor, null);
		expect(info).toEqual({
			start: { line: 0, ch: 2 },
			end: { line: 0, ch: line.length },
			query: 'Expenses:cy',
		});
		expect(suggest.getSuggestions({ query: 'Expenses:cy' } as EditorSuggestContext)).toEqual(['Expenses:餐饮']);
		suggest.context = {
			start: info!.start,
			end: info!.end,
			query: 'Expenses:cy',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		suggest.selectSuggestion('Expenses:餐饮', {} as MouseEvent);
		expect(editor.replacements).toEqual([
			{ replacement: 'Expenses:餐饮', from: { line: 0, ch: 2 }, to: { line: 0, ch: line.length } },
		]);
	});

	it('stays quiet on Expenses:cy when pinyin matching is off', () => {
		const index = new AccountIndex(undefined, () => false);
		index.setFileContent('a.bean', '2020-01-01 open Expenses:餐饮 USD');
		const suggest = new AccountSuggest({} as App, index);
		const line = '  Expenses:cy';
		expect(suggest.onTrigger({ line: 0, ch: line.length }, createEditor([line]) as unknown as Editor, null)).toBeNull();
	});

	it('completes a payee from its initials and replaces the typed query', () => {
		const index = new VaultIndex(extractPayees, undefined, () => true);
		index.setFileContent('a.bean', '2026-09-30 * "餐饮" "午饭"');
		const suggest = new PayeeSuggest({} as App, index);
		const line = '2026-09-30 * "cy';
		const editor = createEditor([line]);
		const info = suggest.onTrigger({ line: 0, ch: line.length }, editor as unknown as Editor, null);
		expect(info).toMatchObject({ query: 'cy', start: { line: 0, ch: 14 } });
		expect(suggest.getSuggestions({ query: 'cy' } as EditorSuggestContext)).toEqual(['餐饮']);
		suggest.context = {
			start: info!.start,
			end: info!.end,
			query: 'cy',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		const close = vi.spyOn(suggest, 'close');
		suggest.selectSuggestion('餐饮', {} as MouseEvent);
		expect(editor.replacements).toEqual([
			{ replacement: '餐饮"', from: { line: 0, ch: 14 }, to: { line: 0, ch: line.length } },
		]);
		expect(close).toHaveBeenCalledOnce();
	});

	it('does not offer a pinyin payee when the getter is off', () => {
		const index = new VaultIndex(extractPayees, undefined, () => false);
		index.setFileContent('a.bean', '2026-09-30 * "餐饮" "午饭"');
		const suggest = new PayeeSuggest({} as App, index);
		const line = '2026-09-30 * "cy';
		expect(suggest.onTrigger({ line: 0, ch: line.length }, createEditor([line]) as unknown as Editor, null)).toBeNull();
		expect(index.match('cy')).toEqual([]);
	});

	it('completes a narration from ASCII initials and inserts the narration text', () => {
		const index = new VaultIndex(extractNarrations, undefined, () => true);
		index.setFileContent('a.bean', '2026-09-30 * "Shell" "午饭"');
		const suggest = new NarrationSuggest({} as App, index, () => true);
		const line = '2026-09-30 * "Shell" "wf';
		const editor = createEditor([line]);
		const info = suggest.onTrigger({ line: 0, ch: line.length }, editor as unknown as Editor, null);
		expect(info).toMatchObject({ query: 'wf' });
		expect(suggest.getSuggestions({ query: 'wf' } as EditorSuggestContext)).toEqual(['午饭']);
		suggest.context = {
			start: info!.start,
			end: info!.end,
			query: 'wf',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		suggest.selectSuggestion('午饭', {} as MouseEvent);
		expect(editor.replacements[0]?.replacement.startsWith('午饭')).toBe(true);
		expect(editor.replacements[0]?.replacement).not.toContain('wf');
	});
});
