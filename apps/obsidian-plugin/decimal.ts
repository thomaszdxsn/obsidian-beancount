/**
 * Scaled-integer decimals for balance arithmetic.
 *
 * `fromString` strips trailing zeros, matching a float round-trip. `fromLiteral`
 * keeps the written exponent (`1.00` stays scale 2) so a ledger spelling can
 * be summed the way beancount's `Decimal` does. Addition and multiplication
 * keep the sum of those scales; they do not strip zeros the user wrote.
 *
 * `render` matches `str(Decimal)` in Python 3.9: fixed point unless the
 * coefficient exponent is positive or the adjusted exponent is below -6.
 *
 * `BigInt` literals and `bigint **` need a newer tsconfig target than this
 * package's ES6 emit, so powers of ten are built with `BigInt` calls.
 */
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);
const TWO = BigInt(2);

export class Decimal {
	readonly value: bigint;
	/** Digits after the point. Negative means a positive coefficient exponent (`2E+1`). */
	readonly scale: number;

	constructor(value: bigint, scale: number) {
		this.value = value;
		this.scale = scale;
	}

	static zero(): Decimal {
		return new Decimal(ZERO, 0);
	}

	/** `null` when `n` is not finite or its round-trip text is not a decimal. */
	static fromNumber(n: number): Decimal | null {
		if (!Number.isFinite(n) || Object.is(n, -0)) return Object.is(n, -0) ? Decimal.zero() : null;
		return Decimal.fromString(n.toString());
	}

	/** `null` when `text` is not a plain or scientific decimal. Trailing zeros are stripped. */
	static fromString(text: string): Decimal | null {
		const parsed = parseDecimal(text);
		if (!parsed) return null;
		return normalize(parsed.value, parsed.scale);
	}

	/**
	 * `null` when `text` is not a plain or scientific decimal. The written
	 * fractional digits are kept, including trailing zeros and a zero value.
	 */
	static fromLiteral(text: string): Decimal | null {
		const parsed = parseDecimal(text);
		if (!parsed) return null;
		if (parsed.scale < 0) return new Decimal(parsed.value * pow10(-parsed.scale), 0);
		return new Decimal(parsed.value, parsed.scale);
	}

	isZero(): boolean {
		return this.value === ZERO;
	}

	sign(): -1 | 0 | 1 {
		if (this.value === ZERO) return 0;
		return this.value < ZERO ? -1 : 1;
	}

	neg(): Decimal {
		return new Decimal(-this.value, this.scale);
	}

	add(other: Decimal): Decimal {
		const scale = Math.max(this.scale, other.scale);
		return new Decimal(rescale(this, scale) + rescale(other, scale), scale);
	}

	sub(other: Decimal): Decimal {
		return this.add(other.neg());
	}

	mul(other: Decimal): Decimal {
		return new Decimal(this.value * other.value, this.scale + other.scale);
	}

	compare(other: Decimal): number {
		const scale = Math.max(this.scale, other.scale);
		const diff = rescale(this, scale) - rescale(other, scale);
		if (diff === ZERO) return 0;
		return diff < ZERO ? -1 : 1;
	}

	/**
	 * Round half-even so the coefficient exponent equals `targetExp`, the way
	 * `Decimal.quantize` does. A zero result keeps that exponent.
	 */
	quantizeExponent(targetExp: number): Decimal {
		const remove = targetExp - -this.scale;
		if (remove <= 0) return new Decimal(this.value * pow10(-remove), -targetExp);
		const factor = pow10(remove);
		const neg = this.value < ZERO;
		const abs = neg ? -this.value : this.value;
		const quot = abs / factor;
		const rem = abs % factor;
		const half = factor / TWO;
		let rounded = quot;
		if (rem > half || (rem === half && quot % TWO === ONE)) rounded += ONE;
		return new Decimal(neg ? -rounded : rounded, -targetExp);
	}

	/** Python `Decimal.normalize`: drop trailing coefficient zeros and shift the exponent. */
	normalized(): Decimal {
		if (this.value === ZERO) return Decimal.zero();
		const exp = this.exponent();
		const raw = (this.value < ZERO ? -this.value : this.value).toString().replace(/0+$/, '');
		const sign = this.value < ZERO ? -ONE : ONE;
		return new Decimal(sign * BigInt(raw), -exp);
	}

	/** Exponent of the last significant coefficient digit, as `Decimal.as_tuple().exponent` after normalize. */
	exponent(): number {
		if (this.value === ZERO) return -this.scale;
		const raw = (this.value < ZERO ? -this.value : this.value).toString();
		const trimmed = raw.replace(/0+$/, '');
		return -this.scale + (raw.length - trimmed.length);
	}

	/** Significant coefficient digits after normalize. A zero has one. */
	significantDigits(): number {
		if (this.value === ZERO) return 1;
		return (this.value < ZERO ? -this.value : this.value).toString().replace(/0+$/, '').length;
	}

	/**
	 * Render without scientific notation. `minScale` is the most fractional
	 * digits seen for the currency; the exact value is never rounded away, so
	 * a sum that needs more places than `minScale` keeps them.
	 */
	format(minScale: number): string {
		const base = this.scale < 0 ? new Decimal(this.value * pow10(-this.scale), 0) : this;
		const scale = Math.max(base.scale, minScale);
		const padded = rescale(base, scale);
		const neg = padded < ZERO;
		const digits = (neg ? -padded : padded).toString().padStart(scale + 1, '0');
		const body = scale === 0 ? digits : digits.slice(0, digits.length - scale) + '.' + digits.slice(digits.length - scale);
		return neg ? '-' + body : body;
	}

	/** `str(Decimal)` from CPython: scientific when the exponent is above 0 or the adjusted exponent is below -6. */
	render(): string {
		const exp = -this.scale;
		const neg = this.value < ZERO;
		const digits = (neg ? -this.value : this.value).toString();
		const adjusted = exp + digits.length - 1;
		const body = exp > 0 || adjusted < -6 ? scientific(digits, adjusted) : fixed(digits, this.scale);
		return neg ? '-' + body : body;
	}
}

function scientific(digits: string, adjusted: number): string {
	const rest = digits.slice(1);
	const exp = adjusted < 0 ? String(adjusted) : '+' + adjusted;
	const head = digits.charAt(0);
	return rest.length === 0 ? head + 'E' + exp : head + '.' + rest + 'E' + exp;
}

function fixed(digits: string, scale: number): string {
	if (scale <= 0) return digits;
	const padded = digits.padStart(scale + 1, '0');
	return padded.slice(0, padded.length - scale) + '.' + padded.slice(padded.length - scale);
}

function parseDecimal(text: string): { value: bigint; scale: number } | null {
	const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text.trim());
	if (!match) return null;
	const sign = match[1] === '-' ? -ONE : ONE;
	const whole = match[2] ?? '0';
	const frac = match[3] ?? match[4] ?? '';
	const exp = match[5] === undefined ? 0 : Number(match[5]);
	if (!Number.isFinite(exp)) return null;
	const digits = (whole + frac).replace(/^0+(?=\d)/, '') || '0';
	return { value: sign * BigInt(digits), scale: frac.length - exp };
}

function pow10(exp: number): bigint {
	let value = ONE;
	for (let i = 0; i < exp; i += 1) value *= TEN;
	return value;
}

function rescale(decimal: Decimal, scale: number): bigint {
	const diff = scale - decimal.scale;
	if (diff >= 0) return decimal.value * pow10(diff);
	return decimal.value / pow10(-diff);
}

function normalize(value: bigint, scale: number): Decimal {
	if (value === ZERO) return Decimal.zero();
	if (scale < 0) {
		value *= pow10(-scale);
		scale = 0;
	}
	while (scale > 0 && value % TEN === ZERO) {
		value /= TEN;
		scale -= 1;
	}
	return new Decimal(value, scale);
}
