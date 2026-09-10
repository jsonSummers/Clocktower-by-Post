import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Static SPA build: no server runtime, deployable to any static host,
			// and cacheable on-device for the flaky-venue-wifi scenario. All routes
			// are client-rendered (see src/routes/+layout.ts), served via the
			// index.html fallback.
			adapter: adapter({ fallback: 'index.html', strict: false })
		})
	]
});
