import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so the pure-logic unit tests (clock, etc.)
// run in plain Node without loading the SvelteKit plugin.
export default defineConfig({
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		environment: 'node'
	}
});
