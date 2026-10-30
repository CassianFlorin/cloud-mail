import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(realpathSync(join(root, 'node_modules/wrangler')), 'package.json'));
const { build } = require('esbuild');

// Bundle the production notification path; stub only settings and signed links.
await build({
	stdin: {
		contents: `
			export { default as template } from './src/template/email-msg.js';
			export { default as preview } from './src/utils/telegram-preview.js';
			export { default as emailUtils } from './src/utils/email-utils.js';
			export { default as service } from './src/service/telegram-service.js';
		`,
		resolveDir: root,
		loader: 'js'
	},
	outfile: join(root, '.wrangler/telegram-tests.mjs'),
	bundle: true,
	platform: 'node',
	format: 'esm',
	plugins: [{
		name: 'notification-fixtures',
		setup(build) {
			build.onResolve({ filter: /\/(setting-service|jwt-utils)$/ }, args => ({
				path: args.path.split('/').pop(), namespace: 'fixture'
			}));
			build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
				contents: args.path === 'setting-service'
					? 'export default { query: async c => c.setting };'
					: 'export default { generateToken: async (c, data) => `test-token-${data.emailId}`, verifyToken: async (c, token) => /^test-token-\\d+$/.test(token) ? { emailId: Number(token.slice(11)) } : null };'
			}));
		}
	}]
});
const result = spawnSync(process.execPath,
	['--test', join(root, 'test/telegram.spec.mjs')], { stdio: 'inherit' });
process.exit(result.status ?? 1);
