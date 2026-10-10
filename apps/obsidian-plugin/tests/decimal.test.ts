import { describe, expect, it } from 'vitest';
import { Decimal } from '../decimal';

function dec(text: string): Decimal {
	const value = Decimal.fromString(text);
	if (!value) throw new Error(`not a decimal: ${text}`);
	return value;
}

describe('Decimal', () => {
	it('parses plain, signed, and scientific forms, and rejects what is not a decimal', () => {
		expect(dec('1e-7').format(0)).toBe('0.0000001');
		expect(dec('-1e-7').format(0)).toBe('-0.0000001');
		expect(dec('1.5e21').format(0)).toBe('1500000000000000000000');
		expect(dec('-1.5e21').format(0)).toBe('-1500000000000000000000');
		expect(dec('  +1.5e+2 ').format(0)).toBe('150');
		expect(dec('1E-7').compare(dec('0.0000001'))).toBe(0);
		expect(dec('.5').format(1)).toBe('0.5');
		expect(dec('-.5').format(0)).toBe('-0.5');
		expect(dec('1.').format(0)).toBe('1');
		expect(dec('+1.5').format(0)).toBe('1.5');

		expect(Decimal.fromString('nope')).toBeNull();
		expect(Decimal.fromString('')).toBeNull();
		expect(Decimal.fromString('1e')).toBeNull();
		expect(Decimal.fromString('1e+')).toBeNull();
		expect(Decimal.fromString('1.2.3')).toBeNull();
		expect(Decimal.fromString(`1e${'9'.repeat(400)}`)).toBeNull();
		expect(Decimal.fromString(`-1e-${'9'.repeat(400)}`)).toBeNull();
	});

	it('treats zero, negative zero, and trailing zeros as a single zero or a stripped scale', () => {
		expect(dec('0').isZero()).toBe(true);
		expect(dec('0.00').isZero()).toBe(true);
		expect(dec('-0').isZero()).toBe(true);
		expect(dec('+0').sign()).toBe(0);
		expect(dec('.0').format(2)).toBe('0.00');
		expect(Decimal.fromNumber(0)?.sign()).toBe(0);
		expect(Decimal.fromNumber(-0)?.isZero()).toBe(true);
		expect(Decimal.fromNumber(-0)?.format(2)).toBe('0.00');
		expect(dec('1.10').format(0)).toBe('1.1');
		expect(dec('100.00').format(0)).toBe('100');
		expect(dec('-1.50').neg().isZero()).toBe(false);
	});

	it('aligns scales for add, sub, and mul, and keeps the sign of a product', () => {
		expect(dec('1.5').add(dec('0.02')).format(0)).toBe('1.52');
		expect(dec('0.1').add(dec('-0.1')).isZero()).toBe(true);
		expect(dec('1').sub(dec('0.1')).format(0)).toBe('0.9');
		expect(dec('0.10').sub(dec('0.1')).isZero()).toBe(true);
		expect(dec('1.5').mul(dec('2')).format(0)).toBe('3');
		expect(dec('-1.5').mul(dec('-2')).format(0)).toBe('3');
		expect(dec('-1.5').mul(dec('2')).format(1)).toBe('-3.0');
		expect(dec('0.2').mul(dec('0.5')).format(0)).toBe('0.1');
		expect(dec('5').mul(dec('0')).isZero()).toBe(true);
		expect(dec('1.5').neg().format(0)).toBe('-1.5');
		expect(dec('-1.5').neg().format(2)).toBe('1.50');
		expect(dec('0').neg().sign()).toBe(0);
		expect(dec('4').sign()).toBe(1);
		expect(dec('-4').sign()).toBe(-1);
	});

	it('compares across scales and pads to the requested fractional digits', () => {
		expect(dec('1').compare(dec('2'))).toBe(-1);
		expect(dec('2').compare(dec('1'))).toBe(1);
		expect(dec('-2').compare(dec('-1'))).toBe(-1);
		expect(dec('-1').compare(dec('-2'))).toBe(1);
		expect(dec('5').format(2)).toBe('5.00');
		expect(dec('-1.2').format(4)).toBe('-1.2000');
		expect(dec('-5').format(0)).toBe('-5');
		expect(dec('1.5').format(0)).toBe('1.5');
		expect(Decimal.zero().format(3)).toBe('0.000');
	});

	it('converts finite numbers through their shortest round-trip, including exponents', () => {
		expect(Decimal.fromNumber(1e-7)?.format(0)).toBe('0.0000001');
		expect(Decimal.fromNumber(1.5e21)?.compare(dec('1.5e21'))).toBe(0);
		expect(Decimal.fromNumber(-1.5e21)?.format(0)).toBe('-1500000000000000000000');
		const tenths = Decimal.fromNumber(0.2);
		expect(tenths && Decimal.fromNumber(0.1)?.add(tenths).format(0)).toBe('0.3');
		expect(Decimal.fromNumber(Number.NaN)).toBeNull();
		expect(Decimal.fromNumber(Number.POSITIVE_INFINITY)).toBeNull();
		expect(Decimal.fromNumber(Number.NEGATIVE_INFINITY)).toBeNull();
	});
});
