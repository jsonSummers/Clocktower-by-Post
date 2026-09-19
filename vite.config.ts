// Minimal ambient decl so this Node-only config file type-checks without pulling in
// @types/node for the whole (otherwise browser-only) project.
declare const process: { env: Record<string, string | undefined> };

import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Only set for a GitHub Pages *project* page, which is served from
// https://<user>.github.io/<repo>/ rather than the domain root — every
// asset/route reference needs that prefix or they 404. Empty (the existing
// behaviour) for Vercel, a custom domain, or a user/org root page (a repo
// literally named <user>.github.io). Set by the Pages deploy workflow; see
// .github/workflows/deploy-pages.yml.
const basePath = (process.env.BASE_PATH ?? '') as '' | `/${string}`;

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
			adapter: adapter({ fallback: 'index.html', strict: false }),

			paths: {
				base: basePath
			}
		})
	]
});
