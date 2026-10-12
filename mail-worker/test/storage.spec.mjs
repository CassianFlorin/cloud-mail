import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import storage from '../.wrangler/storage-service.mjs';
import access from '../.wrangler/object-access-service.mjs';
import { worker, jwt } from '../.wrangler/storage-worker.mjs';

const encoder = new TextEncoder();
const key = 'attachments/legacy.txt';

function fixture() {
	const values = new Map([[key, encoder.encode('old attachment')], ['setting:', encoder.encode('settings')]]);
	const r2Values = new Map();
	const calls = { kvReads: 0 };
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec(`
		CREATE TABLE email (email_id INTEGER PRIMARY KEY);
		CREATE TABLE attachments (att_id INTEGER PRIMARY KEY, email_id INTEGER, user_id INTEGER, key TEXT);
		INSERT INTO email VALUES (10);
		INSERT INTO attachments VALUES (20, 10, 2, 'attachments/legacy.txt');
	`);
	const c = {
		permissions: [],
		user: { userId: 2, email: 'user@example.test' },
		get() { return this.user; },
		env: {
			admin: 'admin@example.test',
			kv: {
				async getWithMetadata(key) {
					calls.kvReads++;
					return { value: values.get(key) ?? null,
						metadata: { contentType: 'text/plain', contentDisposition: 'attachment; filename="old.txt"' } };
				},
				async put(key, value) { values.set(key, value); },
				async delete(key) { values.delete(key); }
			},
			r2: {
				async get(key) {
					const value = r2Values.get(key);
					if (!value) return null;
					return {
						body: new Blob([value.content]).stream(),
						httpEtag: '"r2-etag"',
						httpMetadata: value.metadata,
						writeHttpMetadata(headers) {
							headers.set('Content-Type', value.metadata.contentType);
							if (value.metadata.contentDisposition) headers.set('Content-Disposition', value.metadata.contentDisposition);
						}
					};
				},
				async put(key, content, options) { r2Values.set(key, { content, metadata: options.httpMetadata }); },
				async delete(keys) { for (const key of [].concat(keys)) r2Values.delete(key); }
			},
			db: {
				prepare(sql) {
					return { bind(...params) {
						return { async first() { return sqlite.prepare(sql).get(...params) ?? null; } };
					} };
				}
			}
		}
	};
	return { c, values, r2Values, calls };
}

test('R2 misses fall back to legacy KV with body and MIME headers intact', async () => {
	const { c } = fixture();
	const response = await storage.toObjResp(c, key, true);
	assert.equal(await response.text(), 'old attachment');
	assert.equal(response.headers.get('Content-Type'), 'text/plain');
	assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="old.txt"');
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('R2 takes precedence and receives new writes without touching KV config', async () => {
	const { c, values, calls, r2Values } = fixture();
	await storage.putObj(c, key, encoder.encode('new attachment'), { contentType: 'text/plain' });
	const response = await storage.toObjResp(c, key, true);
	assert.equal(await response.text(), 'new attachment');
	assert.equal(response.headers.get('ETag'), '"r2-etag"');
	assert.equal(calls.kvReads, 0);
	assert.equal(new TextDecoder().decode(values.get('setting:')), 'settings');
	assert.equal(r2Values.size, 1);
});

test('deletion removes only the chosen file from both stores and cannot revive KV copy', async () => {
	const { c, values } = fixture();
	await storage.putObj(c, key, encoder.encode('new'), { contentType: 'text/plain' });
	await storage.delete(c, key);
	assert.equal((await storage.toObjResp(c, key)).status, 404);
	assert.ok(values.has('setting:'));
});

test('KV-only deployments and missing files remain supported', async () => {
	const { c } = fixture();
	delete c.env.r2;
	assert.equal(await storage.storageType(c), 'KV');
	assert.equal(await (await storage.toObjResp(c, key)).text(), 'old attachment');
	assert.equal((await storage.toObjResp(c, 'attachments/missing')).status, 404);
});

test('storage errors propagate rather than hiding outages behind stale KV', async () => {
	const { c } = fixture();
	c.env.r2.get = async () => { throw new Error('R2 unavailable'); };
	await assert.rejects(storage.getObj(c, key), /R2 unavailable/);
});

test('owner can read a legacy file but another user and anonymous callers cannot', async () => {
	const { c } = fixture();
	assert.equal(await (await access.attachment(c, key)).text(), 'old attachment');
	c.user = { userId: 3, email: 'other@example.test' };
	assert.equal((await access.attachment(c, key)).status, 404);
	c.user = null;
	assert.equal((await access.attachment(c, key)).status, 401);
});

test('administrator and delegated all-mail reader can access existing attachments only', async () => {
	const { c } = fixture();
	c.user = { userId: 1, email: c.env.admin };
	assert.equal((await access.attachment(c, key)).status, 200);
	c.user = { userId: 3, email: 'reader@example.test' };
	c.permissions = ['all-email:query'];
	assert.equal((await access.attachment(c, key)).status, 200);
	assert.equal((await access.attachment(c, 'attachments/orphan')).status, 404);
});

test('object API rejects backgrounds, arbitrary KV keys and traversal', async () => {
	const { c } = fixture();
	for (const key of ['setting:', 'static/background/a', 'attachments/../setting:']) {
		assert.equal((await access.attachment(c, key)).status, 404);
	}
});

test('real Worker routes reject anonymous and revoked sessions before object access', async () => {
	const { c, calls } = fixture();
	c.env.jwt_secret = 'local-test-signing-key';
	const originalGet = c.env.kv.getWithMetadata;
	c.env.kv.get = async () => null;
	for (const path of ['/attachments/legacy.txt', '/api/oss/attachments/legacy.txt']) {
		const response = await worker.fetch(new Request('https://example.test' + path), c.env, {});
		assert.equal(response.status, 401);
	}
	const token = await jwt.generateToken(c, { userId: 2, token: 'revoked' }, 60);
	const response = await worker.fetch(new Request('https://example.test/api/oss/' + key,
		{ headers: { Authorization: token } }), c.env, {});
	assert.equal(response.status, 401);
	assert.equal(calls.kvReads, 0);
	c.env.kv.getWithMetadata = originalGet;
});

test('real Worker serves legacy bytes to a valid administrator session through both paths', async () => {
	const { c, values } = fixture();
	c.env.jwt_secret = 'local-test-signing-key';
	c.env.domain = ['example.test'];
	const sessionId = 'valid-local-session';
	const token = await jwt.generateToken(c, { userId: 1, token: sessionId }, 60);
	c.env.kv.get = async key => {
		if (key === 'auth-uid:1') return {
			tokens: [sessionId], user: { userId: 1, email: c.env.admin },
			refreshTime: new Date().toISOString()
		};
		if (key === 'setting:') return { emailPrefixFilter: '' };
		return null;
	};
	for (const path of ['/attachments/legacy.txt', '/api/oss/attachments/legacy.txt']) {
		const response = await worker.fetch(new Request('https://example.test' + path,
			{ headers: { Authorization: token } }), c.env, {});
		assert.equal(response.status, 200);
		assert.equal(await response.text(), 'old attachment');
		assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
	}
	assert.ok(values.has('setting:'));
});
