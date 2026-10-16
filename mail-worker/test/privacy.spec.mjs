import assert from 'node:assert/strict';
import test from 'node:test';
import { isSafeRemoteImageUrl } from '../../shared/remote-image.js';
import { isActiveFile } from '../../shared/active-file.js';

test('remote image proxy only accepts public http addresses', () => {
	assert.equal(isSafeRemoteImageUrl('https://cdn.example.com/a.png'), true);
	assert.equal(isSafeRemoteImageUrl('http://127.0.0.1/a.png'), false);
	assert.equal(isSafeRemoteImageUrl('http://10.1.1.1/a.png'), false);
	assert.equal(isSafeRemoteImageUrl('http://192.168.0.8/a.png'), false);
	assert.equal(isSafeRemoteImageUrl('http://169.254.169.254/latest'), false);
	assert.equal(isSafeRemoteImageUrl('http://localhost/a.png'), false);
	assert.equal(isSafeRemoteImageUrl('https://user:pass@cdn.example.com/a.png'), false);
	assert.equal(isSafeRemoteImageUrl('javascript:alert(1)'), false);
	assert.equal(isSafeRemoteImageUrl('http://[::1]/a.png'), false);
	assert.equal(isSafeRemoteImageUrl('http://127.1/a.png'), false);
	assert.equal(isSafeRemoteImageUrl('http://2130706433/a.png'), false);
	assert.equal(isSafeRemoteImageUrl('http://0177.0.0.1/a.png'), false);
	assert.equal(isSafeRemoteImageUrl('http://198.19.0.1/a.png'), false);
	assert.equal(isSafeRemoteImageUrl('https://cdn.example.com/photo.jpg'), true);
});

test('html and svg attachments are treated as active files', () => {
	assert.equal(isActiveFile('text/html', 'attachments/a'), true);
	assert.equal(isActiveFile('image/svg+xml', 'attachments/a'), true);
	assert.equal(isActiveFile('application/octet-stream', 'attachments/note.html'), true);
	assert.equal(isActiveFile('image/png', 'attachments/a.png'), false);
});
