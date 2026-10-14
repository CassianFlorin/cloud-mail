import emailUtils from '../utils/email-utils';
import telegramPreview from '../utils/telegram-preview';

function field(value, maxLength) {
	const text = emailUtils.formatText(String(value || '')).replace(/\s+/g, ' ');
	const characters = Array.from(text);
	return characters.length > maxLength
		? characters.slice(0, maxLength - 3).join('') + '...'
		: text;
}

export default function emailMsgTemplate(email, tgMsgTo, tgMsgFrom, tgMsgText) {
	const blocks = [{
		type: 'heading',
		size: 3,
		text: field(email.subject, 180) || '（无主题）'
	}];

	if (tgMsgFrom === 'show' || tgMsgFrom === 'only-name') {
		const name = field(email.name, 100);
		const address = field(email.sendEmail, 254);
		const text = [{ type: 'bold', text: '发件人：' }];
		if (name) text.push(name);
		if (tgMsgFrom === 'show' && address) {
			if (name) text.push(' ');
			text.push({ type: 'code', text: address });
		}
		if (text.length === 1) text.push('（未知）');
		blocks.push({ type: 'paragraph', text });
	}

	if (tgMsgTo === 'show') {
		blocks.push({
			type: 'paragraph',
			text: [
				{ type: 'bold', text: '收件地址：' },
				{ type: 'code', text: field(email.toEmail, 254) || '（未知）' }
			]
		});
	}

	if (tgMsgText === 'show') {
		const preview = telegramPreview(email);
		blocks.push({ type: 'divider' });
		blocks.push({ type: 'paragraph', text: { type: 'bold', text: '正文预览' } });
		if (preview.length > 250) {
			blocks.push({ type: 'expandable_blockquote', text: preview.text });
		} else {
			blocks.push({
				type: 'blockquote',
				blocks: [{ type: 'paragraph', text: preview.text }]
			});
		}
		blocks.push({
			type: 'footer',
			text: preview.truncated
				? '正文已截取，点击下方按钮查看完整邮件。'
				: '点击下方按钮查看完整邮件。'
		});
	}

	// Native blocks keep untrusted email text separate from Telegram formatting.
	// Schema: https://core.telegram.org/bots/api#inputrichmessage
	return { blocks, skip_entity_detection: true };
}
