import s3Service from './s3-service';
import settingService from './setting-service';
import kvObjService from './kv-obj-service';

const r2Service = {

	async storageType(c) {

		const setting = await settingService.query(c);
		const { bucket, endpoint, s3AccessKey, s3SecretKey } = setting;

		if (!!(bucket && endpoint && s3AccessKey && s3SecretKey)) {
			return 'S3';
		}

		if (c.env.r2) {
			return 'R2';
		}

		return 'KV';
	},

	async putObj(c, key, content, metadata) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.putObj(c, key, content, metadata);
		}

		if (storageType === 'R2') {
			await c.env.r2.put(key, content, {
				httpMetadata: { ...metadata }
			});
		}

		if (storageType === 'S3') {
			await s3Service.putObj(c, key, content, metadata);
		}

	},

	async getObj(c, key) {
		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			return await kvObjService.getObj(c, key);
		}

		if (storageType === 'R2') {
			// Existing KV files stay readable while migration is in progress.
			const object = await c.env.r2.get(key);
			return object ?? await kvObjService.getObj(c, key);
		}

		if (storageType === 'S3') {
			return await s3Service.getObj(c, key);
		}
	},

	async toObjResp(c, key, privateFile = false) {
		const object = await this.getObj(c, key);
		if (!object) return new Response(null, { status: 404 });

		// R2 returns object metadata; KV and S3 already return a Response.
		const headers = object instanceof Response
			? new Headers(object.headers) : new Headers();
		if (!(object instanceof Response)) {
			// Copy metadata locally so remote binding proxies never need to
			// serialize a Headers instance across their runtime boundary.
			const metadata = object.httpMetadata || {};
			for (const [field, header] of Object.entries({
				contentType: 'Content-Type',
				contentDisposition: 'Content-Disposition',
				contentEncoding: 'Content-Encoding',
				contentLanguage: 'Content-Language',
				cacheControl: 'Cache-Control'
			})) {
				if (metadata[field]) headers.set(header, metadata[field]);
			}
			if (metadata.cacheExpiry) headers.set('Expires', new Date(metadata.cacheExpiry).toUTCString());
			if (object.httpEtag) headers.set('ETag', object.httpEtag);
		}
		if (!headers.has('Content-Type')) {
			headers.set('Content-Type', 'application/octet-stream');
		}
		headers.set('X-Content-Type-Options', 'nosniff');
		if (privateFile) headers.set('Cache-Control', 'private, no-store');
		return new Response(object.body, { headers });
	},

	async delete(c, key) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.deleteObj(c, key);
		}

		if (storageType === 'R2') {
			await c.env.r2.delete(key);
			// Removing a file must also remove its legacy copy, or fallback revives it.
			await kvObjService.deleteObj(c, key);
		}

		if (storageType === 'S3'){
			await s3Service.deleteObj(c, key);
		}

	}

};
export default r2Service;
