import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import type { Plugin, PluginManifest } from 'obsidian';
import { Plugin as RecordingPlugin } from './mocks/obsidian';
import { AccountIndex, extractAccounts } from '../account-index';
import { extractPayees } from '../payee-index';
import { registerVaultIndex, VaultIndex } from '../vault-index';
import { FakeVault, flush } from './fakes';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;

describe('VaultIndex', () => {
	it('caches strings per file and exposes a sorted union', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('b.md', 'Expenses:Food');
		index.setFileContent('a.md', 'Assets:Cash Expenses:Food');
		expect(index.values()).toEqual(['Assets:Cash', 'Expenses:Food']);
		expect(index.values()).toBe(index.values()); // cached between calls
	});

	it('replaces a file’s strings when its content changes', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('a.md', 'Assets:Old');
		index.setFileContent('a.md', 'Assets:New');
		expect(index.values()).toEqual(['Assets:New']);
	});

	it('tracks nothing for content without strings', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('a.md', 'Assets:Cash');
		index.setFileContent('a.md', 'just prose, no names');
		expect(index.values()).toEqual([]);
		// String-less files are untracked: a rename needs a fresh read.
		expect(index.renameFile('a.md', 'b.md')).toBe(false);
	});

	it('drops a file’s strings on removal', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('a.md', 'Assets:Cash');
		index.setFileContent('b.md', 'Expenses:Food');
		index.removeFile('a.md');
		expect(index.values()).toEqual(['Expenses:Food']);
	});

	it('keeps a string that another file still contains', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('a.md', 'Assets:Cash');
		index.setFileContent('b.md', 'Assets:Cash');
		index.removeFile('a.md');
		expect(index.values()).toEqual(['Assets:Cash']);
	});

	it('ignores removal of untracked paths', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('a.md', 'Assets:Cash');
		index.removeFile('missing.md');
		expect(index.values()).toEqual(['Assets:Cash']);
	});

	it('re-keys a renamed file without re-reading its content', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('a.md', 'Assets:Cash');
		expect(index.renameFile('a.md', 'b.md')).toBe(true);
		expect(index.values()).toEqual(['Assets:Cash']);
		index.removeFile('a.md');
		expect(index.values()).toEqual(['Assets:Cash']);
	});

	it('re-keys children on a folder rename', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('dir/a.md', 'Assets:Cash');
		index.setFileContent('other.md', 'Expenses:Food');
		expect(index.renameFile('dir', 'moved')).toBe(true);
		expect(index.values()).toEqual(['Assets:Cash', 'Expenses:Food']);
		index.removeFile('moved/a.md');
		expect(index.values()).toEqual(['Expenses:Food']);
	});

	it('reports nothing moved for unknown rename sources', () => {
		const index = new VaultIndex(extractAccounts);
		expect(index.renameFile('missing.md', 'b.md')).toBe(false);
	});

	it('matches prefixes case-insensitively in sorted order', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('a.md', 'Assets:Cash:Wallet Assets:Broker:IBKR');
		expect(index.match('assets:ca')).toEqual(['Assets:Cash:Wallet']);
		expect(index.match('Assets:')).toEqual(['Assets:Broker:IBKR', 'Assets:Cash:Wallet']);
	});

	it('returns every string for an empty query and nothing for a miss', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('a.md', 'Assets:Cash Expenses:Food');
		expect(index.match('')).toEqual(['Assets:Cash', 'Expenses:Food']);
		expect(index.match('Income')).toEqual([]);
	});

	it('caps the popup window instead of returning the whole vault', () => {
		const index = new VaultIndex(extractAccounts);
		// Zero-padded so the sorted union is the generation order.
		const accounts = Array.from({ length: 60 }, (_, i) => `Assets:A${String(i).padStart(2, '0')}`);
		index.setFileContent('a.md', accounts.join(' '));
		expect(index.match('Assets:')).toEqual(accounts.slice(0, 50));
		// Prefix hits (A50–A59) rank ahead of subsequence hits (A05, A15, …).
		expect(index.match('Assets:A5')).toEqual([
			...accounts.slice(50, 60),
			'Assets:A05',
			'Assets:A15',
			'Assets:A25',
			'Assets:A35',
			'Assets:A45',
		]);
	});

	it('drops values longer than a name could be', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('a.md', `Assets:Cash Assets:${'x'.repeat(300)}`);
		expect(index.values()).toEqual(['Assets:Cash']);
	});
});

interface Fixture {
	vault: FakeVault;
	index: VaultIndex;
	plugin: RecordingPlugin;
}

function setup(files: Record<string, string> = {}): Fixture {
	const vault = new FakeVault();
	for (const [path, content] of Object.entries(files)) vault.write(path, content);
	const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
	const index = new VaultIndex(extractAccounts);
	registerVaultIndex(plugin as unknown as Plugin, index);
	return { vault, index, plugin };
}

describe('registerVaultIndex', () => {
	it('scans indexed extensions once and skips everything else', async () => {
		const vault = new FakeVault();
		vault.folder('notes');
		vault.write('a.md', 'Assets:Cash');
		vault.write('b.bean', 'Expenses:Food');
		vault.write('c.beancount', 'Income:Salary');
		vault.write('d.png', 'Assets:Ignored');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new VaultIndex(extractAccounts);
		registerVaultIndex(plugin as unknown as Plugin, index);
		await flush();

		expect(index.values()).toEqual(['Assets:Cash', 'Expenses:Food', 'Income:Salary'].sort());
		expect([...vault.reads].sort()).toEqual(['a.md', 'b.bean', 'c.beancount']);
	});

	it('feeds every registered index from a single read', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', '2026-09-30 * "Whole Foods" "Groceries"\n  Expenses:Food  10.00 USD');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const accounts = new VaultIndex(extractAccounts);
		const payees = new VaultIndex(extractPayees);
		registerVaultIndex(plugin as unknown as Plugin, accounts, payees);
		await flush();

		expect(vault.reads).toEqual(['ledger.bean']);
		expect(accounts.values()).toEqual(['Expenses:Food']);
		expect(payees.values()).toEqual(['Whole Foods']);
	});

	it('registers the four vault events', () => {
		const { plugin, vault } = setup();
		expect(plugin.registrations.events).toHaveLength(4);
		expect([...vault.handlers.keys()].sort()).toEqual(['create', 'delete', 'modify', 'rename']);
	});

	it('re-indexes a modified file', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old' });
		await flush();
		const file = vault.write('a.md', 'Assets:New Expenses:Food');
		await vault.emit('modify', file);
		expect(index.values()).toEqual(['Assets:New', 'Expenses:Food']);
	});

	it('indexes files created after load', async () => {
		const { vault, index } = setup();
		await flush();
		const file = vault.write('new.md', 'Liabilities:Card');
		await vault.emit('create', file);
		expect(index.values()).toEqual(['Liabilities:Card']);
	});

	it('drops strings when a file is deleted', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Cash', 'b.md': 'Expenses:Food' });
		await flush();
		await vault.emit('delete', vault.delete('a.md'));
		expect(index.values()).toEqual(['Expenses:Food']);
	});

	it('ignores events for files outside the indexed extensions', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Cash' });
		await flush();
		const file = vault.write('d.png', 'Assets:Ignored');
		await vault.emit('modify', file);
		expect(index.values()).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['a.md']);
	});

	it('keeps cached strings on rename without re-reading', async () => {
		const { vault, index } = setup({ 'dir/a.md': 'Assets:Cash' });
		await flush();
		const renamed = vault.rename('dir/a.md', 'dir/b.md');
		await vault.emit('rename', renamed, 'dir/a.md');
		expect(index.values()).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['dir/a.md']);
		index.removeFile('dir/b.md');
		expect(index.values()).toEqual([]);
	});

	it('skips the rename re-read when one of several indexes tracked the file', async () => {
		// The file carries an account but no payee: the payee index stays
		// untracked, yet the path was read before, so no re-read is needed.
		const vault = new FakeVault();
		vault.write('a.md', 'Assets:Cash');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const accounts = new VaultIndex(extractAccounts);
		const payees = new VaultIndex(extractPayees);
		registerVaultIndex(plugin as unknown as Plugin, accounts, payees);
		await flush();
		const renamed = vault.rename('a.md', 'b.md');
		await vault.emit('rename', renamed, 'a.md');
		expect(accounts.values()).toEqual(['Assets:Cash']);
		expect(payees.values()).toEqual([]);
		expect(vault.reads).toEqual(['a.md']);
	});

	it('re-keys every index on rename and drops every index on delete', async () => {
		// Both indexes track the file: `renameFile` must run for each of them —
		// a short-circuiting `moved ||= …` would leave the later index's
		// entries behind under the old path — and delete must clear both.
		const vault = new FakeVault();
		vault.write('ledger.bean', '2026-09-30 * "Whole Foods" "Groceries"\n  Expenses:Food  10.00 USD');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const accounts = new VaultIndex(extractAccounts);
		const payees = new VaultIndex(extractPayees);
		registerVaultIndex(plugin as unknown as Plugin, accounts, payees);
		await flush();
		const renamed = vault.rename('ledger.bean', 'book.bean');
		await vault.emit('rename', renamed, 'ledger.bean');
		expect(accounts.values()).toEqual(['Expenses:Food']);
		expect(payees.values()).toEqual(['Whole Foods']);
		expect(vault.reads).toEqual(['ledger.bean']);
		await vault.emit('delete', vault.delete('book.bean'));
		expect(accounts.values()).toEqual([]);
		expect(payees.values()).toEqual([]);
	});

	it('moves every child entry on a folder rename', async () => {
		const { vault, index } = setup({ 'dir/a.md': 'Assets:Cash', 'other.md': 'Expenses:Food' });
		await flush();
		const renamed = vault.rename('dir', 'moved');
		await vault.emit('rename', renamed, 'dir');
		expect(index.values()).toEqual(['Assets:Cash', 'Expenses:Food']);
		index.removeFile('moved/a.md');
		expect(index.values()).toEqual(['Expenses:Food']);
	});

	it('reads the file when a rename makes it indexable', async () => {
		const { vault, index } = setup({ 'note.txt': 'Assets:Cash' });
		await flush();
		const renamed = vault.rename('note.txt', 'note.md');
		await vault.emit('rename', renamed, 'note.txt');
		expect(index.values()).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['note.md']);
	});

	it('re-reads a note ↔ ledger rename, whose ledger text differs', async () => {
		const vault = new FakeVault();
		vault.write('x.md', 'Prose:Name\n```bean\n  Expenses:Food  1 USD\n```');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const accounts = new AccountIndex();
		registerVaultIndex(plugin as unknown as Plugin, accounts);
		await flush();
		expect(accounts.match('')).toEqual(['Expenses:Food']);

		await vault.emit('rename', vault.rename('x.md', 'x.bean'), 'x.md');
		await flush();
		expect(accounts.match('')).toEqual(['Expenses:Food', 'Prose:Name']);

		await vault.emit('rename', vault.rename('x.bean', 'x.md'), 'x.bean');
		await flush();
		expect(accounts.match('')).toEqual(['Expenses:Food']);
	});

	it('drops the entry when a rename makes the file unindexable', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Cash' });
		await flush();
		const renamed = vault.rename('a.md', 'a.txt');
		await vault.emit('rename', renamed, 'a.md');
		expect(index.values()).toEqual([]);
	});

	it('replaces a dropped in-flight read after rename', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old' });
		await flush();
		// A modify read is in flight when the rename arrives; the rename drops
		// it, so a read of the new path must take over.
		vault.delays.set('a.md', [50]);
		const file = vault.write('a.md', 'Assets:Fresh');
		await vault.emit('modify', file);
		const renamed = vault.rename('a.md', 'b.md');
		await vault.emit('rename', renamed, 'a.md');
		expect(index.values()).toEqual(['Assets:Fresh']);
		await delay(100);
		expect(index.values()).toEqual(['Assets:Fresh']);
		index.removeFile('b.md');
		expect(index.values()).toEqual([]);
	});

	it('does not let a stale read overwrite a recreated file', async () => {
		const vault = new FakeVault();
		vault.delays.set('a.md', [50]);
		vault.write('a.md', 'Assets:Stale');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new VaultIndex(extractAccounts);
		registerVaultIndex(plugin as unknown as Plugin, index);
		// Delete and recreate while the first read is still on disk; the path's
		// first-life read must not clobber the recreated content.
		await vault.emit('delete', vault.delete('a.md'));
		const recreated = vault.write('a.md', 'Assets:Fresh');
		await vault.emit('create', recreated);
		expect(index.values()).toEqual(['Assets:Fresh']);
		await delay(100);
		expect(index.values()).toEqual(['Assets:Fresh']);
	});

	it('skips prototype-named extensions in the scan', async () => {
		const vault = new FakeVault();
		vault.write('a.md', 'Assets:Cash');
		vault.write('trap.constructor', 'Expenses:Trap');
		vault.write('trap.toString', 'Expenses:Trap');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new VaultIndex(extractAccounts);
		registerVaultIndex(plugin as unknown as Plugin, index);
		await flush();
		expect(index.values()).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['a.md']);
	});

	it('replaces dropped in-flight child reads on a folder rename', async () => {
		const { vault, index } = setup({ 'dir/a.md': 'Assets:Old', 'other.md': 'Expenses:Food' });
		await flush();
		vault.delays.set('dir/a.md', [50]);
		const file = vault.write('dir/a.md', 'Assets:Fresh');
		await vault.emit('modify', file);
		const renamed = vault.rename('dir', 'moved');
		await vault.emit('rename', renamed, 'dir');
		await delay(100);
		// The dropped read may only land under the new path, never back under
		// the old one.
		expect(index.values()).toEqual(['Assets:Fresh', 'Expenses:Food']);
		index.removeFile('moved/a.md');
		expect(index.values()).toEqual(['Expenses:Food']);
	});

	it('discards an in-flight read when the rename makes the file unindexable', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old' });
		await flush();
		vault.delays.set('a.md', [50]);
		const file = vault.write('a.md', 'Assets:Fresh');
		await vault.emit('modify', file);
		const renamed = vault.rename('a.md', 'a.txt');
		await vault.emit('rename', renamed, 'a.md');
		await delay(100);
		expect(index.values()).toEqual([]);
	});

	it('discards an in-flight read when the file is deleted', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old' });
		await flush();
		vault.delays.set('a.md', [50]);
		const file = vault.write('a.md', 'Assets:Fresh');
		await vault.emit('modify', file);
		await vault.emit('delete', vault.delete('a.md'));
		await delay(100);
		expect(index.values()).toEqual([]);
	});

	it('leaves unrelated in-flight reads alone on rename', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old', 'other.md': 'Expenses:Food' });
		await flush();
		vault.delays.set('other.md', [20]);
		const other = vault.write('other.md', 'Expenses:Fresh');
		await vault.emit('modify', other);
		const renamed = vault.rename('a.md', 'b.md');
		await vault.emit('rename', renamed, 'a.md');
		expect(index.values()).toEqual(['Assets:Old', 'Expenses:Food']);
		await delay(60);
		expect(index.values()).toEqual(['Assets:Old', 'Expenses:Fresh']);
	});

	it('ignores dropped children that vanished from the file listing', async () => {
		const { vault, index } = setup({ 'dir/a.md': 'Assets:Old' });
		await flush();
		vault.delays.set('dir/a.md', [50]);
		const file = vault.write('dir/a.md', 'Assets:Fresh');
		await vault.emit('modify', file);
		const renamed = vault.rename('dir', 'moved');
		// The host's listing can lag the rename event: the child is gone by
		// the time the dropped read would be replaced. Must not throw, and the
		// re-keyed entry survives.
		vault.files.delete('moved/a.md');
		await vault.emit('rename', renamed, 'dir');
		await delay(100);
		expect(index.values()).toEqual(['Assets:Old']);
	});

	it('drops stale out-of-order reads instead of applying them', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old' });
		await flush();
		// The first read is slow and captures `Assets:Old`; the second read
		// lands first with `Assets:Fresh`. The stale one must not win.
		vault.delays.set('a.md', [50, 0]);
		const file = vault.write('a.md', 'Assets:Old');
		await vault.emit('modify', file);
		vault.write('a.md', 'Assets:Fresh');
		await vault.emit('modify', file);
		expect(index.values()).toEqual(['Assets:Fresh']);
		await delay(100);
		expect(index.values()).toEqual(['Assets:Fresh']);
	});

	it('keeps the last good cache entry when a read fails', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old', 'b.md': 'Expenses:Food' });
		await flush();
		vault.failures.add('a.md');
		const file = vault.write('a.md', 'Assets:New');
		await vault.emit('modify', file);
		expect(index.values()).toEqual(['Assets:Old', 'Expenses:Food']);
	});

	it('skips unreadable files during the initial scan', async () => {
		const vault = new FakeVault();
		vault.write('a.md', 'Assets:Cash');
		vault.write('b.md', 'Expenses:Food');
		vault.failures.add('a.md');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new VaultIndex(extractAccounts);
		registerVaultIndex(plugin as unknown as Plugin, index);
		await flush();
		expect(index.values()).toEqual(['Expenses:Food']);
	});
});
