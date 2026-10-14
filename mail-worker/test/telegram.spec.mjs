import assert from 'node:assert/strict';
import test from 'node:test';
import { template, preview, emailUtils, service } from '../.wrangler/telegram-tests.mjs';

const email = {
	emailId: 42,
	subject: 'Welcome to DeepL API Free!',
	name: 'DeepL',
	sendEmail: 'hello@example.com',
	toEmail: 'inbox@example.com',
	text: 'Hi Ott Lam,\n\nYour subscription is ready.'
};
const setting = {
	tgBotToken: 'test-bot-token',
	tgChatId: '123',
	customDomain: 'mail.example.com',
	tgMsgFrom: 'show',
	tgMsgTo: 'show',
	tgMsgText: 'show'
};

function visible(text) {
	if (typeof text === 'string') return text;
	if (Array.isArray(text)) return text.map(visible).join('');
	return visible(text.text || '');
}

function validateText(text) {
	if (typeof text === 'string') return;
	if (Array.isArray(text)) {
		text.forEach(validateText);
		return;
	}
	assert.ok(['bold', 'code', 'url'].includes(text.type));
	validateText(text.text);
	if (text.type === 'url') assert.match(text.url, /^https?:\/\//i);
}

function validateBlocks(blocks) {
	for (const block of blocks) {
		assert.ok(['heading', 'paragraph', 'divider', 'blockquote', 'expandable_blockquote', 'footer'].includes(block.type));
		if (block.type === 'heading') assert.ok(block.size >= 1 && block.size <= 6);
		if (block.text !== undefined) validateText(block.text);
		if (block.blocks) validateBlocks(block.blocks);
	}
}

test('notification uses native heading, metadata, quotation and footer blocks', () => {
	const rich = template(email, 'show', 'show', 'show');
	validateBlocks(rich.blocks);
	assert.equal(rich.skip_entity_detection, true);
	assert.equal(rich.blocks[0].text, email.subject);
	assert.match(visible(rich.blocks[1].text), /DeepL hello@example.com/);
	assert.match(visible(rich.blocks[2].text), /inbox@example.com/);
	const quote = rich.blocks.find(block => block.type === 'blockquote');
	assert.equal(visible(quote.blocks[0].text), email.text);
	assert.equal(rich.blocks.at(-1).type, 'footer');
});

test('all display-setting combinations preserve hidden fields', () => {
	const privateEmail = { ...email, name: 'Sender-only-name' };
	for (const from of ['show', 'only-name', 'hide']) {
		for (const to of ['show', 'hide']) {
			for (const body of ['show', 'hide']) {
				const rich = template(privateEmail, to, from, body);
				const serialized = JSON.stringify(rich);
				validateBlocks(rich.blocks);
				assert.equal(serialized.includes(email.sendEmail), from === 'show');
				assert.equal(serialized.includes(privateEmail.name), from !== 'hide');
				assert.equal(serialized.includes(email.toEmail), to === 'show');
				assert.equal(serialized.includes('Your subscription is ready.'), body === 'show');
				assert.equal(rich.blocks.some(block => block.type === 'divider'), body === 'show');
			}
		}
	}
});

test('non-breaking spaces no longer join words and paragraphs remain separated', () => {
	assert.equal(emailUtils.formatText('questions?\u00a0Check\n\n\nNext\u3000paragraph'), 'questions? Check\n\nNext paragraph');
	assert.equal(visible(preview({ text: 'questions?\u00a0Check' }).text), 'questions? Check');
});

test('DeepL banners and repeated subject are removed from the preview', () => {
	const result = preview({
		...email,
		text: '**************************\nWELCOME TO DEEPL API FREE!\n**************************\nHi Ott Lam,\n\nAccount tab [https://www.deepl.com/account?utm_source=email&utm_medium=email]'
	});
	assert.match(visible(result.text), /^Hi Ott Lam,\n\nAccount tab \[deepl.com\]$/);
	const link = result.text.find(part => part.type === 'url');
	assert.equal(link.url, 'https://www.deepl.com/account?utm_source=email&utm_medium=email');
	assert.equal(result.truncated, false);
});

test('forwarded mail removes quote prefixes while preserving metadata, links and the original body', () => {
	const forwarded = {
		subject: 'Fwd: Event invitation',
		text: 'Regards,\nCassian\n\n> Forwarded message:\n>\n> From: CSDN <csdn@example.com>\n> Subject: Event invitation\n> To: inbox@example.com\n>\n> Bring your laptop.\n> Register [https://example.com/event?source=email]'
	};
	const original = { ...forwarded };
	const rich = template(forwarded, 'show', 'show', 'show');
	const quote = rich.blocks.find(block => block.type === 'blockquote');
	assert.equal(visible(quote.blocks[0].text),
		'Regards,\nCassian\n\nForwarded message:\n\nFrom: CSDN <csdn@example.com>\nSubject: Event invitation\nTo: inbox@example.com\n\nBring your laptop.\nRegister [example.com]');
	assert.equal(quote.blocks[0].text.find(part => part.type === 'url').url,
		'https://example.com/event?source=email');
	assert.deepEqual(forwarded, original);
});

test('nested quote prefixes and quote-only lines become clean paragraphs', () => {
	const result = preview({
		text: '> First paragraph\n>\n>>\n> >\n>> Second paragraph\n> > Nested forward\n>>>Deeply nested\n> \t > Last line'
	});
	assert.equal(visible(result.text),
		'First paragraph\n\nSecond paragraph\nNested forward\nDeeply nested\nLast line');
});

test('HTML-only forwarded mail removes decoded quote prefixes', () => {
	const result = preview({
		content: '<p>&gt; First paragraph</p><p>&gt;</p><p>&gt; &gt; Read <a href="https://example.com/docs">docs</a></p>'
	});
	assert.equal(visible(result.text), 'First paragraph\n\nRead docs [example.com]');
	assert.equal(result.text.find(part => part.type === 'url').url, 'https://example.com/docs');
});

test('inline greater-than signs and unquoted body text remain intact', () => {
	const result = preview({ text: 'Normal paragraph\n\nValue > 5; A >> B; arrow => result\n> Quoted value > 3' });
	assert.equal(visible(result.text),
		'Normal paragraph\n\nValue > 5; A >> B; arrow => result\nQuoted value > 3');
});

test('bare URLs get compact clickable labels while sentence punctuation is retained', () => {
	const result = preview({ text: 'See https://www.example.com/docs?q=test&lang=en. Next.' });
	assert.equal(visible(result.text), 'See [example.com]. Next.');
	assert.equal(result.text.find(part => part.type === 'url').url, 'https://www.example.com/docs?q=test&lang=en');
});

test('balanced URL parentheses and emoji joiners are retained', () => {
	const result = preview({ text: 'Family 👨‍👩‍👧‍👦 (https://example.com/wiki/Title_(name)).' });
	assert.equal(visible(result.text), 'Family 👨‍👩‍👧‍👦 ([example.com]).');
	assert.equal(result.text.find(part => part.type === 'url').url, 'https://example.com/wiki/Title_(name)');
});

test('HTML-only mail retains link labels without allowing sender markup to format the message', () => {
	const result = preview({
		content: '<html><body><style>.x{}</style><script>bad()</script><p hidden>secret preheader</p><p>Read <a href="https://example.com/docs?q=a&amp;b=c">API docs</a>&nbsp;today.</p><p><a href="javascript:alert(1)">Bad link</a> &lt;b&gt;literal&lt;/b&gt;</p></body></html>'
	});
	assert.equal(visible(result.text), 'Read API docs [example.com] today.\nBad link <b>literal</b>');
	assert.equal(result.text.filter(part => part.type === 'url').length, 1);
	assert.equal(result.text.find(part => part.type === 'url').url, 'https://example.com/docs?q=a&b=c');
});

test('plain-text body takes priority over the HTML variant', () => {
	const result = preview({ text: 'Plain content', content: '<p>Different content</p>' });
	assert.equal(visible(result.text), 'Plain content');
});

test('500-character clipping preserves emoji and keeps long previews expandable', () => {
	const rich = template({ ...email, text: '😀'.repeat(600) }, 'show', 'show', 'show');
	const quote = rich.blocks.find(block => block.type === 'expandable_blockquote');
	const text = visible(quote.text);
	assert.equal(Array.from(text).length, 500);
	assert.equal(text, '😀'.repeat(497) + '...');
	assert.match(rich.blocks.at(-1).text, /已截取/);
});

test('a link cut by the preview limit remains a well-formed rich text element', () => {
	const result = preview({ text: 'x'.repeat(495) + ' [https://example.com/docs]' });
	assert.equal(Array.from(visible(result.text)).length, 500);
	assert.equal(result.text.find(part => part.type === 'url').url, 'https://example.com/docs');
	validateText(result.text);
});

test('display limits count link labels instead of long tracking URLs', () => {
	const result = preview({ text: `Read docs [https://example.com/docs?tracking=${'x'.repeat(4000)}]` });
	assert.equal(visible(result.text), 'Read docs [example.com]');
	assert.equal(result.truncated, false);
});

test('empty fields and an empty body still produce a valid notification', () => {
	const rich = template({}, 'show', 'show', 'show');
	validateBlocks(rich.blocks);
	assert.equal(rich.blocks[0].text, '（无主题）');
	assert.match(JSON.stringify(rich), /邮件没有可显示的正文/);
});

test('sender content cannot inject rich blocks or create automatic mentions', () => {
	const rich = template({
		...email,
		subject: '<b>Title & entity</b>',
		text: '@everyone /start <tg-spoiler>secret</tg-spoiler> &amp; literal'
	}, 'show', 'show', 'show');
	assert.equal(rich.blocks[0].text, '<b>Title & entity</b>');
	assert.equal(rich.skip_entity_detection, true);
	const quote = rich.blocks.find(block => block.type === 'blockquote');
	assert.equal(visible(quote.blocks[0].text), '@everyone /start <tg-spoiler>secret</tg-spoiler> &amp; literal');
});

test('oversized metadata is bounded without breaking emoji', () => {
	const rich = template({ ...email, subject: '😀'.repeat(1000), name: 'N'.repeat(1000) }, 'show', 'show', 'hide');
	assert.equal(Array.from(rich.blocks[0].text).length, 180);
	assert.ok(visible(rich.blocks[1].text).length < 400);
});

test('production sender sends native blocks and preserves signed View and clipboard buttons', async t => {
	const requests = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		requests.push({ url, ...JSON.parse(options.body) });
		return Response.json({ ok: true, result: { message_id: requests.length } });
	});
	await service.sendEmailToBot({ setting: { ...setting, tgChatId: ' 123, ,456 ' } }, { ...email, code: '012345' });
	assert.equal(requests.length, 2);
	assert.deepEqual(requests.map(request => request.chat_id), ['123', '456']);
	for (const request of requests) {
		assert.match(request.url, /\/sendRichMessage$/);
		assert.equal(request.parse_mode, undefined);
		assert.equal(request.text, undefined);
		validateBlocks(request.rich_message.blocks);
		const buttons = request.reply_markup.inline_keyboard;
		assert.equal(buttons[0][0].text, '查看完整邮件');
		assert.equal(buttons[0][0].web_app.url, 'https://mail.example.com/api/telegram/getEmail/test-token-42');
		assert.equal(buttons[1][0].copy_text.text, '012345');
	}
});

test('absent and oversized verification codes do not produce invalid clipboard buttons', async t => {
	const payloads = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		payloads.push(JSON.parse(options.body));
		return Response.json({ ok: true });
	});
	for (const code of [undefined, '', 'x'.repeat(257)]) {
		await service.sendEmailToBot({ setting }, { ...email, code });
	}
	assert.ok(payloads.every(payload => payload.reply_markup.inline_keyboard.length === 1));
});

test('Telegram errors are reported without retrying and duplicating notifications', async t => {
	let requests = 0;
	const errors = [];
	t.mock.method(globalThis, 'fetch', async () => {
		requests++;
		return Response.json({ ok: false, description: 'Bad Request' }, { status: 400 });
	});
	t.mock.method(console, 'error', message => errors.push(message));
	await service.sendEmailToBot({ setting }, email);
	assert.equal(requests, 1);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /400.*Bad Request/);
});
