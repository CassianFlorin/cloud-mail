import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(realpathSync(join(root, 'node_modules/wrangler')), 'package.json'));
const { build } = require('esbuild');

// Bundle the real recipient rules; account and user lookups read fixtures from env.
await build({
	entryPoints: [join(root, 'src/email/recipient.js')],
	outfile: join(root, '.wrangler/recipient-tests.mjs'),
	bundle: true,
	platform: 'node',
	format: 'esm',
	plugins: [{
		name: 'recipient-fixtures',
		setup(build) {
			build.onResolve({ filter: /\/(account-service|user-service)$/ }, args => ({
				path: args.path.split('/').pop(), namespace: 'fixture'
			}));
			build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
				contents: args.path === 'account-service'
					? 'export default { selectByEmailIncludeDel: async (c, email) => c.env.accounts.find(a => a.email.toLowerCase() === email.toLowerCase()) };'
					: 'export default { selectByIdIncludeDel: async (c, userId) => c.env.users.find(u => u.userId === userId) };'
			}));
		}
	}]
});

const result = spawnSync(process.execPath, ['--test', join(root, 'test/recipient.spec.mjs')], { stdio: 'inherit' });
process.exit(result.status ?? 1);
