/**
 * Scaled-integer decimals for balance arithmetic.
 *
 * The parser stores amounts as JS numbers, so each number is converted through
 * its shortest round-trip string (`Number#toString`) before any addition.
 * Summing the floats themselves would make `0.1 + 0.2` into
 * `0.30000000000000004`. Trailing zeros the user wrote (`10.00`) are already
 * gone by the time a number reaches this module.
 *
 * `BigInt` literals and `bigint **` need a newer tsconfig target than this
 * package's ES6 emit, so powers of ten are built with `BigInt` calls.
 */
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);

export class Decimal {
	readonly value: bigint;
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

	/** `null` when `text` is not a plain or scientific decimal. */
	static fromString(text: string): Decimal | null {
		const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text.trim());
		if (!match) return null;
		const sign = match[1] === '-' ? BigInt(-1) : ONE;
		const whole = match[2] ?? '0';
		const frac = match[3] ?? match[4] ?? '';
		const exp = match[5] === undefined ? 0 : Number(match[5]);
		if (!Number.isFinite(exp)) return null;
		const digits = (whole + frac).replace(/^0+(?=\d)/, '') || '0';
		let scale = frac.length - exp;
		let value = sign * BigInt(digits);
		if (scale < 0) {
			value *= pow10(-scale);
			scale = 0;
		}
		return normalize(value, scale);
	}

	isZero(): boolean {
		return this.value === ZERO;
	}

	sign(): -1 | 0 | 1 {
		if (this.value === ZERO) return 0;
		return this.value < ZERO ? -1 : 1;
	}

	neg(): Decimal {
		return normalize(-this.value, this.scale);
	}

	add(other: Decimal): Decimal {
		const scale = Math.max(this.scale, other.scale);
		return normalize(rescale(this, scale) + rescale(other, scale), scale);
	}

	sub(other: Decimal): Decimal {
		return this.add(other.neg());
	}

	mul(other: Decimal): Decimal {
		return normalize(this.value * other.value, this.scale + other.scale);
	}

	compare(other: Decimal): number {
		const scale = Math.max(this.scale, other.scale);
		const diff = rescale(this, scale) - rescale(other, scale);
		if (diff === ZERO) return 0;
		return diff < ZERO ? -1 : 1;
	}

	/**
	 * Render without scientific notation. `minScale` is the most fractional
	 * digits seen for the currency; the exact value is never rounded away, so
	 * a sum that needs more places than `minScale` keeps them.
	 */
	format(minScale: number): string {
		const scale = Math.max(this.scale, minScale);
		const padded = rescale(this, scale);
		const neg = padded < ZERO;
		const digits = (neg ? -padded : padded).toString().padStart(scale + 1, '0');
		const body = scale === 0 ? digits : digits.slice(0, digits.length - scale) + '.' + digits.slice(digits.length - scale);
		return neg ? '-' + body : body;
	}
}

function pow10(exp: number): bigint {
	let value = ONE;
	for (let i = 0; i < exp; i += 1) value *= TEN;
	return value;
}

function rescale(decimal: Decimal, scale: number): bigint {
	return decimal.value * pow10(scale - decimal.scale);
}

function normalize(value: bigint, scale: number): Decimal {
	if (value === ZERO) return Decimal.zero();
	while (scale > 0 && value % TEN === ZERO) {
		value /= TEN;
		scale -= 1;
	}
	return new Decimal(value, scale);
}
