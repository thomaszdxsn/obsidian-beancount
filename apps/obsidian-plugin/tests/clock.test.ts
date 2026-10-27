/**
 * Manual clock for debounce tests: tick advances now and runs due timers.
 * Validation (and later alignment) inject this instead of window timers.
 */
import { describe, expect, it } from 'vitest';
import { systemClock } from '../clock';
import { FakeClock } from './fakes';

describe('FakeClock', () => {
	it('does not run a 500ms timer until tick covers the delay', () => {
		const clock = new FakeClock();
		const ran: number[] = [];
		clock.setTimeout(() => ran.push(clock.now()), 500);
		clock.tick(499);
		expect(ran).toEqual([]);
		expect(clock.now()).toBe(499);
		clock.tick(1);
		expect(ran).toEqual([500]);
		expect(clock.now()).toBe(500);
	});

	it('does not run a timer after clearTimeout', () => {
		const clock = new FakeClock();
		let ran = false;
		const id = clock.setTimeout(() => {
			ran = true;
		}, 500);
		clock.clearTimeout(id);
		clock.tick(500);
		expect(ran).toBe(false);
	});

	it('runs multiple timers in expiry order', () => {
		const clock = new FakeClock();
		const order: string[] = [];
		clock.setTimeout(() => order.push('b'), 20);
		clock.setTimeout(() => order.push('a'), 10);
		clock.setTimeout(() => order.push('c'), 20);
		clock.tick(20);
		expect(order).toEqual(['a', 'b', 'c']);
		expect(clock.now()).toBe(20);
	});

	it('advances now even when no timer is due', () => {
		const clock = new FakeClock();
		expect(clock.now()).toBe(0);
		clock.tick(7);
		expect(clock.now()).toBe(7);
	});
});

describe('systemClock', () => {
	it('exposes now and window timers', () => {
		expect(typeof systemClock.now()).toBe('number');
		expect(typeof systemClock.setTimeout).toBe('function');
		expect(typeof systemClock.clearTimeout).toBe('function');
	});
});
