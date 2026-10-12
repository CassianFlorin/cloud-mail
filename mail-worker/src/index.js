import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import r2Service from './service/r2-service';
import settingService from './service/setting-service';
import oauthService from './service/oauth-service';
import analysisService from './service/analysis-service';
export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		 if (url.pathname.startsWith('/attachments/')) {
			 // Legacy URLs now use the same session and ownership checks as the API.
			 url.pathname = '/oss' + url.pathname;
			 return app.fetch(new Request(url.toString(), req), env, ctx);
		 }

		 if (url.pathname.startsWith('/static/background/')) {
			 const key = decodeURIComponent(url.pathname.substring(1));
			 const c = { env };
			 const setting = await settingService.query(c);
			 // Only the configured login background is intentionally public.
			 if (key !== setting.background) return new Response(null, { status: 404 });
			 return r2Service.toObjResp(c, key);
		 }

		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(c, env, ctx) {
		if (c.cron === '*/30 * * * *') {
			await analysisService.refreshEchartsCache({ env })
			return;
		}

		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await emailService.autoClean({ env })
		await analysisService.refreshEchartsCache({ env })
		await oauthService.clearNoBindOathUser({ env })
	},
};
