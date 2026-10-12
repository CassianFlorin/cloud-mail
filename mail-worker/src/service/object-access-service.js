import r2Service from './r2-service';
import permService from './perm-service';

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
		return r2Service.toObjResp(c, key, true);
	}
};

export default objectAccessService;
