import app from '../hono/hono';
import BizError from '../error/biz-error';
import { isSafeRemoteImageUrl } from '../../../shared/remote-image.js';

const IMAGE_TYPE = /^image\/(?:png|gif|jpe?g|webp|bmp|x-icon|vnd\.microsoft\.icon)$/i;
const MAX_BYTES = 5_000_000;

app.post('/remote-image', async (c) => {
	let body = null;
	try {
		body = await c.req.json();
	} catch {
		body = null;
	}
	const requested = body && body.url;
	if (!isSafeRemoteImageUrl(requested)) throw new BizError('Image address is not allowed', 400);
	const image = await fetchPublicImage(requested);
	if (!image) return new Response(null, { status: 404 });
	return new Response(image.bytes, {
		headers: {
			'Content-Type': image.type,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'",
			'Referrer-Policy': 'no-referrer'
		}
	});
});

async function fetchPublicImage(start) {
	let current = start;
	for (let hop = 0; hop < 3; hop++) {
		if (!isSafeRemoteImageUrl(current)) return null;
		const response = await fetch(current, {
			redirect: 'manual',
			headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8' },
			signal: AbortSignal.timeout(8000)
		});
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location) return null;
			current = new URL(location, current).toString();
			continue;
		}
		if (!response.ok) return null;
		const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
		if (!IMAGE_TYPE.test(type)) return null;
		const declared = Number(response.headers.get('content-length') || 0);
		if (declared > MAX_BYTES) return null;
		const bytes = await response.arrayBuffer();
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
		return { bytes, type };
	}
	return null;
}
