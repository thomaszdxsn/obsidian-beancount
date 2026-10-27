/**
 * Timer seam for debounce. Production uses `window`; tests inject FakeClock.
 * Alignment (#73) will share this interface with a separate timer map.
 */

export interface Clock {
	now(): number;
	setTimeout(fn: () => void, ms: number): number;
	clearTimeout(id: number): void;
}

export const systemClock: Clock = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => window.setTimeout(fn, ms),
	clearTimeout: (id) => {
		window.clearTimeout(id);
	},
};
