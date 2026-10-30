import orm from '../entity/orm';
import email from '../entity/email';
import { and, desc, eq, ne } from 'drizzle-orm';
import { emailConst, isDel, settingConst } from '../const/entity-const';
import settingService from './setting-service';
import telegramService from './telegram-service';
import emailService from './email-service';
import accountService from './account-service';
import userService from './user-service';
import BizError from '../error/biz-error';
import verifyUtils from '../utils/verify-utils';
import emailUtils from '../utils/email-utils';
import domainUtils from '../utils/domain-uitls';

const COMMANDS = [
	{ command: 'new', description: '新建邮箱：/new [前缀|完整地址]' },
	{ command: 'latest', description: '最近收到的邮件：/latest [数量]' },
	{ command: 'code', description: '最新一条验证码' },
	{ command: 'help', description: '使用说明' }
];

const HELP_TEXT = [
	'/new [前缀|完整地址] 新建邮箱，不填前缀则随机生成',
	'/latest [数量] 重新推送最近收到的邮件，默认 5 封，最多 10 封',
	'/code 最新一条验证码',
	'',
	'直接回复某条邮件通知即可回信（纯文本），收件人为原发件人，发件地址为原收件地址。'
].join('\n');

function escapeHtml(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function randomPrefix() {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = crypto.getRandomValues(new Uint8Array(10));
	return [...bytes].map(b => chars[b % chars.length]).join('');
}

const telegramBotService = {

	// 保存 TG 设置后同步 webhook：开启则注册并更新命令菜单，关闭则移除。
	async syncWebhook(c) {
		const { tgBotToken, tgBotStatus, customDomain } = await settingService.query(c);

		if (!tgBotToken) return;

		try {
			if (tgBotStatus !== settingConst.tgBotStatus.OPEN || !customDomain) {
				await telegramService.api(tgBotToken, 'deleteWebhook', {});
				return;
			}

			await telegramService.api(tgBotToken, 'setWebhook', {
				url: `${domainUtils.toOssDomain(customDomain)}/api/telegram/webhook`,
				secret_token: await telegramService.webhookSecret(c),
				allowed_updates: ['message', 'callback_query']
			});
			await telegramService.api(tgBotToken, 'setMyCommands', { commands: COMMANDS });
		} catch (e) {
			throw new BizError(`设置已保存，但 Telegram webhook 同步失败：${e.message}`);
		}
	},

	async handleUpdate(c, update) {
		const setting = await settingService.query(c);
		const { tgBotToken, tgBotStatus, tgChatId } = setting;

		if (tgBotStatus !== settingConst.tgBotStatus.OPEN || !tgBotToken) return;

		const chatIds = telegramService.tgChatIds(tgChatId);

		// 只响应配置在推送列表里的会话，其余一律忽略。
		if (update.callback_query) {
			const query = update.callback_query;
			if (!chatIds.includes(String(query.message?.chat?.id))) return;
			await this.handleCallback(c, setting, query);
			return;
		}

		const message = update.message;
		if (!message?.text || !chatIds.includes(String(message.chat.id))) return;

		try {
			if (message.reply_to_message) {
				await this.replyEmail(c, setting, message);
			} else if (message.text.startsWith('/')) {
				await this.handleCommand(c, setting, message);
			} else {
				await this.sendText(tgBotToken, message.chat.id, HELP_TEXT);
			}
		} catch (e) {
			if (e.name !== 'BizError') console.error('Telegram bot 处理失败:', e);
			await this.sendText(tgBotToken, message.chat.id, `操作失败：${e.message}`, message.message_id)
				.catch(err => console.error('Telegram 回复失败:', err.message));
		}
	},

	async handleCommand(c, setting, message) {
		const [rawCommand, ...args] = message.text.trim().split(/\s+/);
		// 群组里命令可能带 @botname 后缀。
		const command = rawCommand.slice(1).split('@')[0].toLowerCase();
		const chatId = message.chat.id;

		switch (command) {
			case 'new':
				return this.newAccount(c, setting, chatId, args[0]);
			case 'latest':
				return this.latest(c, setting, chatId, args[0]);
			case 'code':
				return this.latestCode(c, setting, chatId);
			default:
				return this.sendText(setting.tgBotToken, chatId, `${HELP_TEXT}\n\n当前会话 ID：${chatId}`);
		}
	},

	// 新邮箱归属管理员账号，bot 视为管理员本人操作，跳过人机验证和数量限制。
	async newAccount(c, setting, chatId, arg) {
		const { domainList, tgBotToken } = setting;

		let address = arg ? arg.toLowerCase() : randomPrefix();
		if (!address.includes('@')) {
			address += domainList[0];
		}

		if (!verifyUtils.isEmail(address)) {
			throw new BizError('邮箱格式不正确');
		}

		if (!domainList.includes('@' + emailUtils.getDomain(address))) {
			throw new BizError(`域名不可用，可选：${domainList.join(' ')}`);
		}

		if (await accountService.selectByEmailIncludeDel(c, address)) {
			throw new BizError('该邮箱已存在或已被删除');
		}

		const adminRow = await userService.selectByEmail(c, c.env.admin);
		if (!adminRow) {
			throw new BizError('管理员账号不存在');
		}

		await accountService.insert(c, { email: address, userId: adminRow.userId, name: emailUtils.getName(address) });

		await telegramService.api(tgBotToken, 'sendMessage', {
			chat_id: chatId,
			text: `已创建邮箱：<code>${escapeHtml(address)}</code>`,
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [[{ text: '复制地址', copy_text: { text: address } }]]
			}
		});
	},

	async latest(c, setting, chatId, arg) {
		const size = Math.min(Math.max(Number(arg) || 5, 1), 10);

		const list = await orm(c).select().from(email)
			.where(and(
				eq(email.type, emailConst.type.RECEIVE),
				eq(email.isDel, isDel.NORMAL)))
			.orderBy(desc(email.emailId))
			.limit(size)
			.all();

		if (list.length === 0) {
			await this.sendText(setting.tgBotToken, chatId, '还没有收到邮件');
			return;
		}

		// 旧的先发，最新一封落在会话底部。
		for (const row of list.reverse()) {
			await telegramService.sendEmailCard(c, chatId, row, setting);
		}
	},

	async latestCode(c, setting, chatId) {
		const row = await orm(c).select().from(email)
			.where(and(
				eq(email.type, emailConst.type.RECEIVE),
				eq(email.isDel, isDel.NORMAL),
				ne(email.code, '')))
			.orderBy(desc(email.emailId))
			.limit(1)
			.get();

		if (!row) {
			await this.sendText(setting.tgBotToken, chatId, '没有找到验证码');
			return;
		}

		const lines = [
			`验证码：<code>${escapeHtml(row.code)}</code>`,
			`来自：${escapeHtml(row.name || row.sendEmail || '')}`,
			`收件：${escapeHtml(row.toEmail || '')}`,
			`时间：${escapeHtml(row.createTime || '')} UTC`
		];

		await telegramService.api(setting.tgBotToken, 'sendMessage', {
			chat_id: chatId,
			text: lines.join('\n'),
			parse_mode: 'HTML',
			reply_markup: Array.from(row.code).length <= 256
				? { inline_keyboard: [[{ text: '复制验证码', copy_text: { text: row.code } }]] }
				: undefined
		});
	},

	// 回复通知消息即回信：从原消息的签名链接取 emailId，用原收件地址回给原发件人。
	async replyEmail(c, setting, message) {
		const { tgBotToken } = setting;
		const emailId = await telegramService.emailIdFromMessage(c, message.reply_to_message, tgBotToken);

		if (!emailId) {
			throw new BizError('只能回复邮件通知消息');
		}

		const emailRow = await emailService.selectById(c, emailId);

		if (!emailRow || emailRow.type !== emailConst.type.RECEIVE) {
			throw new BizError('原邮件不存在或已删除');
		}

		if (!emailRow.accountId) {
			throw new BizError('原邮件没有对应的收件邮箱，无法回信');
		}

		const text = message.text;
		const subject = /^re:/i.test(emailRow.subject || '') ? emailRow.subject : `Re: ${emailRow.subject || ''}`;

		await emailService.send(c, {
			accountId: emailRow.accountId,
			sendType: 'reply',
			emailId: emailRow.emailId,
			receiveEmail: [emailRow.sendEmail],
			subject,
			text,
			content: `<div>${escapeHtml(text).replace(/\n/g, '<br>')}</div>`,
			attachments: []
		}, emailRow.userId);

		await this.sendText(tgBotToken, message.chat.id, `已回信给 ${emailRow.sendEmail}`, message.message_id);
	},

	async handleCallback(c, setting, query) {
		const { tgBotToken } = setting;
		const [action, id] = String(query.data || '').split(':');
		const emailId = Number(id);
		let notice = '';

		try {
			const emailRow = emailId ? await emailService.selectById(c, emailId) : null;

			if (action === 'noop') {
				notice = '';
			} else if (!emailRow) {
				notice = '邮件不存在或已删除';
			} else if (action === 'read') {
				await emailService.read(c, { emailIds: [emailId] }, emailRow.userId);
				await this.updateButtons(tgBotToken, query.message, button =>
					button.callback_data === `read:${emailId}` ? { text: '✓ 已读', callback_data: 'noop' } : button);
				notice = '已标为已读';
			} else if (action === 'del') {
				await emailService.delete(c, { emailIds: String(emailId) }, emailRow.userId);
				await telegramService.api(tgBotToken, 'editMessageReplyMarkup', {
					chat_id: query.message.chat.id,
					message_id: query.message.message_id,
					reply_markup: { inline_keyboard: [[{ text: '✓ 已删除', callback_data: 'noop' }]] }
				});
				notice = '已删除';
			}
		} catch (e) {
			console.error('Telegram 按钮处理失败:', e);
			notice = `操作失败：${e.message}`;
		}

		// 无论成功与否都要应答，否则按钮会一直转圈。
		await telegramService.api(tgBotToken, 'answerCallbackQuery', {
			callback_query_id: query.id,
			text: notice.slice(0, 200)
		}).catch(err => console.error('Telegram 应答失败:', err.message));
	},

	async updateButtons(tgBotToken, message, mapper) {
		const keyboard = (message.reply_markup?.inline_keyboard || []).map(row => row.map(mapper));
		await telegramService.api(tgBotToken, 'editMessageReplyMarkup', {
			chat_id: message.chat.id,
			message_id: message.message_id,
			reply_markup: { inline_keyboard: keyboard }
		});
	},

	sendText(tgBotToken, chatId, text, replyTo) {
		return telegramService.api(tgBotToken, 'sendMessage', {
			chat_id: chatId,
			text,
			...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {})
		});
	}

};

export default telegramBotService;
