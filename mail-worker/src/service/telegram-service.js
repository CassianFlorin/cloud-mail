import orm from '../entity/orm';
import email from '../entity/email';
import settingService from './setting-service';
import { eq } from 'drizzle-orm';
import jwtUtils from '../utils/jwt-utils';
import emailMsgTemplate from '../template/email-msg';
import emailTextTemplate from '../template/email-text';
import emailHtmlTemplate from '../template/email-html';
import domainUtils from "../utils/domain-uitls";

const telegramService = {

	async getEmailContent(c, params) {

		const { token } = params

		const result = await jwtUtils.verifyToken(c, token);

		if (!result) {
			return emailTextTemplate('Access denied')
		}

		const emailRow = await orm(c).select().from(email).where(eq(email.emailId, result.emailId)).get();

		if (emailRow) {

			if (emailRow.content) {
				const { r2Domain } = await settingService.query(c);
				return emailHtmlTemplate(emailRow.content || '', r2Domain)
			} else {
				return emailTextTemplate(emailRow.text || '')
			}

		} else {
			return emailTextTemplate('The email does not exist')
		}

	},

	// 推送和 /latest 共用：查看、复制验证码、已读、删除。
	// 查看按钮里的签名链接同时用于从回复消息反查 emailId。
	async buildKeyboard(c, email, customDomain) {
		const jwtToken = await jwtUtils.generateToken(c, { emailId: email.emailId })

		const webAppUrl = customDomain ? `${domainUtils.toOssDomain(customDomain)}/api/telegram/getEmail/${jwtToken}` : 'https://www.cloudflare.com/404'
		const inlineKeyboard = [
			[
				{
					text: '查看完整邮件',
					web_app: { url: webAppUrl }
				}
			]
		];

		const code = String(email.code || '');
		// Telegram's native clipboard button accepts 1-256 characters.
		if (code && Array.from(code).length <= 256) {
			inlineKeyboard.push([
				{
					text: `复制验证码 ${code}`,
					copy_text: { text: code }
				}
			]);
		}

		inlineKeyboard.push([
			{ text: '标为已读', callback_data: `read:${email.emailId}` },
			{ text: '删除', callback_data: `del:${email.emailId}` }
		]);

		return inlineKeyboard;
	},

	// 只信任本 bot 发出的消息里、签名有效的查看链接。
	async emailIdFromMessage(c, message, tgBotToken) {
		const botId = Number(String(tgBotToken).split(':')[0]);
		if (!message?.from?.is_bot || message.from.id !== botId) return null;

		const buttons = (message.reply_markup?.inline_keyboard || []).flat();
		for (const button of buttons) {
			const token = button.web_app?.url?.split('/api/telegram/getEmail/')[1];
			if (!token) continue;
			const payload = await jwtUtils.verifyToken(c, token);
			if (payload?.emailId) return payload.emailId;
		}
		return null;
	},

	async api(tgBotToken, method, body) {
		const res = await fetch(`https://api.telegram.org/bot${tgBotToken}/${method}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});
		const data = await res.json().catch(() => ({ ok: false, description: `status ${res.status}` }));
		if (!data.ok) {
			throw new Error(`${method} status: ${res.status} ${data.description}`);
		}
		return data.result;
	},

	async sendEmailCard(c, chatId, email, setting) {
		const { tgBotToken, customDomain, tgMsgTo, tgMsgFrom, tgMsgText } = setting;
		const richMessage = emailMsgTemplate(email, tgMsgTo, tgMsgFrom, tgMsgText);
		await this.api(tgBotToken, 'sendRichMessage', {
			chat_id: chatId,
			rich_message: richMessage,
			reply_markup: {
				inline_keyboard: await this.buildKeyboard(c, email, customDomain)
			}
		});
	},

	// 由 jwt_secret 派生，不需要额外配置；Telegram 只接受 [A-Za-z0-9_-]。
	async webhookSecret(c) {
		const key = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(c.env.jwt_secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('telegram-webhook'));
		return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
	},

	tgChatIds(tgChatId) {
		return String(tgChatId || '').split(',').map(chatId => chatId.trim()).filter(Boolean);
	},

	async sendEmailToBot(c, email) {

		const setting = await settingService.query(c);

		await Promise.all(this.tgChatIds(setting.tgChatId).map(async chatId => {
			try {
				await this.sendEmailCard(c, chatId, email, setting);
			} catch (e) {
				console.error(`转发 Telegram 失败: ${e.message}`);
			}
		}));

	}

}

export default telegramService
