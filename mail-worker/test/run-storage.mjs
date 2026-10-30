import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(realpathSync(join(root, 'node_modules/wrangler')), 'package.json'));
const { build } = require('esbuild');

// Exercise real storage and ownership code while keeping settings, permissions
// and S3 deterministic; SQLite below executes the actual ownership query.
await build({
	entryPoints: [join(root, 'src/service/object-access-service.js')],
	outfile: join(root, '.wrangler/object-access-service.mjs'),
	bundle: true,
	platform: 'node',
	format: 'esm',
	plugins: [{
		name: 'test-dependencies',
		setup(build) {
			build.onResolve({ filter: /\/(setting-service|perm-service|s3-service)$/ }, args => ({
				path: args.path.split('/').pop(), namespace: 'fixture'
			}));
			build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
				contents: args.path === 'setting-service'
					? 'export default { query: async c => c.setting || {} };'
					: args.path === 'perm-service'
						? 'export default { userPermKeys: async c => c.permissions || [] };'
						: 'export default { getObj: async c => c.s3Object, putObj: async c => c.s3Writes++, deleteObj: async c => c.s3Deletes++ };'
			}));
		}
	}]
});
await build({
	entryPoints: [join(root, 'src/service/r2-service.js')],
	outfile: join(root, '.wrangler/storage-service.mjs'),
	bundle: true,
	platform: 'node',
	format: 'esm',
	plugins: [{
		name: 'test-dependencies',
		setup(build) {
			build.onResolve({ filter: /\/(setting-service|s3-service)$/ }, args => ({
				path: args.path.split('/').pop(), namespace: 'fixture'
			}));
			build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
				contents: args.path === 'setting-service'
					? 'export default { query: async c => c.setting || {} };'
					: 'export default { getObj: async c => c.s3Object, putObj: async c => c.s3Writes++, deleteObj: async c => c.s3Deletes++ };'
			}));
		}
	}]
});
await build({
	stdin: {
		contents: "export { default as worker } from './src/index.js'; export { default as jwt } from './src/utils/jwt-utils.js';",
		resolveDir: root,
		loader: 'js'
	},
	outfile: join(root, '.wrangler/storage-worker.mjs'),
	bundle: true,
	// Node's bundled CommonJS dependencies still need a real require function.
	banner: { js: "import { createRequire as nodeRequire } from 'node:module'; const require = nodeRequire(import.meta.url);" },
	// Workers-only modules are imported lazily and never reached by these tests.
	external: ['cloudflare:*'],
	platform: 'node',
	format: 'esm'
});
const result = spawnSync(process.execPath,
	['--experimental-sqlite', '--test', join(root, 'test/storage.spec.mjs')], { stdio: 'inherit' });
process.exit(result.status ?? 1);
