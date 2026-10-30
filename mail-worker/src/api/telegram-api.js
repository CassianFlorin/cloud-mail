import app from '../hono/hono';
import telegramService from '../service/telegram-service';
import telegramBotService from '../service/telegram-bot-service';

app.get('/telegram/getEmail/:token', async (c) => {
	const content = await telegramService.getEmailContent(c, c.req.param());
	c.header('Cache-Control', 'public, max-age=604800, immutable');
	return c.html(content)
});

// /telegram 不走登录鉴权，这里靠 setWebhook 时登记的 secret_token 校验来源。
app.post('/telegram/webhook', async (c) => {
	const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
	if (secret !== await telegramService.webhookSecret(c)) {
		return c.text('Forbidden', 403);
	}

	try {
		await telegramBotService.handleUpdate(c, await c.req.json());
	} catch (e) {
		console.error('Telegram webhook 处理失败:', e);
	}
	// 始终返回 200，避免 Telegram 重复投递同一条更新。
	return c.json({ ok: true });
});
