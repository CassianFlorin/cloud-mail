import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Reuse Wrangler's bundler to resolve the application's extensionless imports.
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(realpathSync(join(root, 'node_modules/wrangler')), 'package.json'));
const { build } = require('esbuild');
await build({
	entryPoints: [join(root, 'src/service/mail-claim-service.js')],
	outfile: join(root, '.wrangler/claim-service.mjs'),
	bundle: true,
	platform: 'node',
	format: 'esm'
});
const result = spawnSync(process.execPath,
	['--experimental-sqlite', '--test', join(root, 'test/mail-claim.spec.mjs')], { stdio: 'inherit' });
process.exit(result.status ?? 1);
