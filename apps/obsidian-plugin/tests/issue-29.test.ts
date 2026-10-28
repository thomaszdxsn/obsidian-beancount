import { describe, expect, it } from 'vitest';
import { isFavaBinary } from '../fava';
import { mergeSettings } from '../settings';
import { DEFAULT_FLAG_WARNINGS } from '../flag-warnings';

describe('isFavaBinary', () => {
	it('accepts fava and rejects anything else', () => {
		expect(isFavaBinary('fava')).toBe(true);
		expect(isFavaBinary('/opt/homebrew/bin/fava')).toBe(true);
		expect(isFavaBinary('C:\\Python\\Scripts\\fava.exe')).toBe(true);
		expect(isFavaBinary('/bin/bash')).toBe(false);
	});
});

describe('mergeSettings', () => {
	it('fills flagWarnings defaults under a partial stored map', () => {
		const settings = mergeSettings({ completePayee: false, flagWarnings: { '!': 'error' } });
		expect(settings.completePayee).toBe(false);
		expect(settings.flagWarnings['!']).toBe('error');
		expect(settings.flagWarnings['*']).toBe(DEFAULT_FLAG_WARNINGS['*']);
		expect(settings.separatorColumn).toBe(50);
		expect(settings.favaPort).toBe(5000);
	});

	it('drops completionUsage so pick history is not a setting', () => {
		const settings = mergeSettings({
			alignOnSave: true,
			completionUsage: { 'Assets:Cash': { count: 3, lastUsed: 1 } },
		});
		expect(settings.alignOnSave).toBe(true);
		expect('completionUsage' in settings).toBe(false);
	});

	it('treats a non-object store as defaults', () => {
		expect(mergeSettings(null).alignOnSave).toBe(false);
		expect(mergeSettings([]).instantAlignment).toBe(true);
		expect(mergeSettings('nope').separatorColumn).toBe(50);
	});
});
