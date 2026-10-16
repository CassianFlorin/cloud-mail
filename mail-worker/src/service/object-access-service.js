import { parseHTML } from 'linkedom';
import r2Service from './r2-service';
import permService from './perm-service';
import { protectEmailDocument } from '../../../shared/anti-track.js';
import { isActiveFile } from '../../../shared/active-file.js';

const ACTIVE_FILE_LIMIT = 2_000_000;

const objectAccessService = {
	async attachment(c, key) {
		if (!key.startsWith('attachments/') || key.includes('..')) {
			return new Response(null, { status: 404 });
		}
		const user = c.get('user');
		if (!user) return new Response(null, { status: 401 });

		const allMail = user.email === c.env.admin
			|| (await permService.userPermKeys(c, user.userId)).includes('all-email:query');
		// Content-addressed files can belong to several messages; one authorized
		// attachment record is sufficient, but knowing the key alone grants nothing.
		const row = await c.env.db.prepare(`
			SELECT a.att_id FROM attachments a JOIN email e ON e.email_id = a.email_id
			WHERE a.key = ? AND (? = 1 OR a.user_id = ?) LIMIT 1
		`).bind(key, allMail ? 1 : 0, user.userId).first();
		if (!row) return new Response(null, { status: 404 });
		const response = await r2Service.toObjResp(c, key, true);
		return neutralizeActiveFile(response, key);
	}
};

async function neutralizeActiveFile(response, key) {
	// 找不到的附件保持原来的状态码。按扩展名误判后会变成一份空白网页。
	if (!response.ok) return response;
	const type = response.headers.get('Content-Type') || '';
	if (!isActiveFile(type, key)) return response;
	const bytes = await response.arrayBuffer();
	const headers = new Headers(response.headers);
	headers.set('Content-Disposition', 'attachment');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Cache-Control', 'private, no-store');
	headers.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
	if (bytes.byteLength > ACTIVE_FILE_LIMIT) {
		headers.set('Content-Type', 'application/octet-stream');
		return new Response(bytes, { headers });
	}
	const { document } = parseHTML(new TextDecoder().decode(bytes));
	protectEmailDocument(document, {
		blockRemote: true,
		stripPixels: true,
		rewriteLinks: true
	});
	headers.set('Content-Type', 'text/html; charset=utf-8');
	return new Response(document.toString(), { headers });
}

export default objectAccessService;
