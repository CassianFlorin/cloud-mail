import { parseHTML } from 'linkedom';
import emailUtils from './email-utils';

const PREVIEW_LIMIT = 500;
const SUFFIX = '...';

function httpUrl(value) {
	try {
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) ? url : null;
	} catch {
		return null;
	}
}

function htmlText(content) {
	if (!content) return '';
	try {
		const wrapped = /<body(?:\s|>)/i.test(content)
			? content
			: `<!DOCTYPE html><html><body>${content}</body></html>`;
		const { document } = parseHTML(wrapped);
		document.querySelectorAll('style, script, title, [hidden]').forEach(node => node.remove());
		// Extract labels and HTTP links, never forward the sender's HTML markup.
		document.querySelectorAll('a').forEach(anchor => {
			const href = anchor.getAttribute('href') || '';
			if (!httpUrl(href)) return;
			const label = (anchor.textContent || '').trim();
			const text = label && label !== href ? `${label} [${href}]` : `[${href}]`;
			anchor.replaceWith(document.createTextNode(text));
		});
		return emailUtils.formatText(document.body.innerText);
	} catch {
		return '';
	}
}

function cleanBody(email) {
	const raw = emailUtils.formatText(email.text) || htmlText(email.content);
	const subject = emailUtils.formatText(email.subject || '').toLowerCase();
	// Telegram supplies the quotation styling; strip plain-text quote prefixes,
	// including nested forwards, without changing the stored email or inline >.
	const lines = raw.split('\n')
		.map(line => line.replace(/^(?:>[ \t]*)+/, ''))
		.filter(line => !/^(?:[*=_-]\s*){4,}$/.test(line));
	// Plain-text email variants often repeat the subject between ASCII banners.
	while (lines.length && (!lines[0].trim() || lines[0].toLowerCase() === subject)) {
		lines.shift();
	}
	// Quote-only lines become blank lines; keep at most one paragraph gap.
	return emailUtils.formatText(lines.join('\n'));
}

function bareUrl(candidate) {
	let href = candidate.replace(/[.,;!?，。；！？]+$/u, '');
	// A balanced parenthesis may belong to the URL (e.g. a wiki article title).
	while (href.endsWith(')') &&
		(href.match(/\)/g) || []).length > (href.match(/\(/g) || []).length) {
		href = href.slice(0, -1);
	}
	return href;
}

function inlineText(text) {
	const parts = [];
	const pattern = /\[(https?:\/\/[^\s\]]+)\]|https?:\/\/[^\s<>\]]+/gi;
	let offset = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index > offset) parts.push(text.slice(offset, match.index));
		const candidate = match[1] || match[0];
		// Keep sentence punctuation outside bare URLs; bracketed URLs are explicit.
		const href = match[1] ? candidate : bareUrl(candidate);
		const url = httpUrl(href);
		if (url) {
			const host = url.hostname.replace(/^www\./, '');
			const label = Array.from(host).slice(0, 60).join('');
			// Shorten only the visible label, retaining the exact destination.
			parts.push({ type: 'url', text: `[${label}]`, url: href });
			if (!match[1]) parts.push(candidate.slice(href.length));
		} else {
			parts.push(match[0]);
		}
		offset = match.index + match[0].length;
	}
	if (offset < text.length) parts.push(text.slice(offset));
	return parts.filter(part => typeof part !== 'string' || part.length);
}

export default function telegramPreview(email) {
	const parts = inlineText(cleanBody(email) || '（邮件没有可显示的正文）');
	const length = parts.reduce((sum, part) =>
		sum + Array.from(typeof part === 'string' ? part : part.text).length, 0);
	if (length <= PREVIEW_LIMIT) return { text: parts, length, truncated: false };

	// Truncate visible characters before serialization, preserving links and emoji.
	let remaining = PREVIEW_LIMIT - SUFFIX.length;
	const preview = [];
	for (const part of parts) {
		if (!remaining) break;
		const characters = Array.from(typeof part === 'string' ? part : part.text);
		const clipped = characters.slice(0, remaining).join('');
		preview.push(typeof part === 'string' ? clipped : { ...part, text: clipped });
		remaining -= Math.min(characters.length, remaining);
	}
	preview.push(SUFFIX);
	return { text: preview, length: PREVIEW_LIMIT, truncated: true };
}
