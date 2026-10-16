// 发件人用远程图片、样式和包装过的链接确认邮件已被打开或点击。
// 追踪像素、远程样式表和字体在读者选择“仍然显示”之后也保持移除。
// CSS 转义、注释和 image-set 不能绕过这次清理。
// 脚本、事件和可执行地址与追踪开关无关，阅读时一律去掉。
// 本站 /attachments/ 资源不是第三方追踪器，阅读和引用时都要保留。
// findings 记下这次实际去掉的内容，打开邮件时可以逐项查看。
// 解不开目的地的追踪链接会取消点击，避免一点就通知发件人。

const TRACKING_PARAMS = new Set([
	'mc_cid', 'mc_eid', 'mkt_tok', 'mkt_unsubscribe', 'vero_id', 'vero_conv',
	'_hsenc', '_hsmi', 'hss_channel', 'hsctatracking',
	'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'twclid', 'ttclid',
	'li_fat_id', 'igshid', 'sccid', 'irclickid', 'yclid', 'gad_source', 'gad_campaignid',
	'_openstat', 'oly_anon_id', 'oly_enc_id', 'rb_clickid', 's_cid', 's_kwcid',
	'ml_subscriber', 'ml_subscriber_hash', 'elqtrackid', 'elqtrack', 'elq_cid',
	'vgo_ee', 'trk', 'trk_contact', 'trk_msg', 'trk_module', 'trk_sid',
	'spm', 'scm', 'ns_mchannel', 'ns_source', 'ns_mkt', 'ns_linkname', 'mkt_unsub'
]);

const PIXEL_HOST = /(^|\.)((google-analytics\.com)|(googletagmanager\.com)|(doubleclick\.net)|(googleadservices\.com)|(scorecardresearch\.com)|(quantserve\.com)|(statcounter\.com)|(pstmrk\.it)|(returnpath\.net)|(mailtrack\.io)|(list-manage\.com))$/i;

const PIXEL_FILE = /(^|\/)(spacer|pixel|beacon|clear|blank|tracking|tracker|1x1)\.(gif|png|jpg|jpeg|webp)(\?|$)/i;

const PIXEL_PATH = /(\/track\/open|\/wf\/open|\/email-open|\/e2t\/|\/ads\/ga-audiences|\/pagead\/|\/adsense\/)/i;

const WRAPPER_HOST = /(^|\.)((list-manage\.com)|(mandrillapp\.com)|(sendgrid\.net)|(hubspotemail\.net)|(mailgun\.net)|(mailgun\.org)|(pstmrk\.it))$/i;

const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'background'];

const ACTIVE_TAGS = new Set([
	'script', 'iframe', 'object', 'embed', 'applet', 'frame', 'frameset', 'base',
	'portal', 'fencedframe', 'foreignobject', 'annotation-xml', 'noscript',
	'animate', 'animatetransform', 'animatemotion', 'set', 'discard', 'handler'
]);

export function protectEmailDocument(document, options = {}) {
	const settings = {
		blockRemote: options.blockRemote !== false,
		stripPixels: options.stripPixels !== false,
		rewriteLinks: options.rewriteLinks !== false,
		keepRemote: options.keepRemote === true,
		trustedOrigins: options.trustedOrigins || []
	};
	const stats = { blockedRemote: 0, strippedPixels: 0, rewrittenLinks: 0, findings: [], omitted: 0 };
	const seen = new Set();
	const note = (kind, url, extra = {}) => {
		const item = { kind };
		const cleanUrl = clip(url, 300);
		const from = clip(extra.from, 300);
		const name = clip(extra.name, 40);
		const target = clip(extra.target, 24);
		const text = clip(extra.text, 120);
		if (cleanUrl) item.url = cleanUrl;
		if (from) item.from = from;
		if (name) item.name = name;
		if (target) item.target = target;
		if (text) item.text = text;
		const key = JSON.stringify(item);
		if (seen.has(key)) return;
		if (stats.findings.length >= 200) {
			stats.omitted++;
			return;
		}
		seen.add(key);
		stats.findings.push(item);
	};

	removeActiveContent(document, note);
	protectImages(document, stats, settings, note);
	protectMedia(document, stats, settings, note);
	protectExternalRefs(document, stats, settings, note);
	protectBackgrounds(document, stats, settings, note);
	protectStylesheets(document, stats, settings, note);
	protectCss(document, stats, settings, note);
	if (settings.rewriteLinks) rewriteLinks(document, stats, note);
	// 解不开真实地址的点击追踪，点开会通知发件人。阅读时直接取消点击。
	disableOpaqueTrackers(document, note);

	return stats;
}

function clip(value, max) {
	const text = String(value || '').replace(/\s+/g, ' ').trim();
	if (!text) return '';
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + '…';
}

function removeActiveContent(document, note) {
	stripActiveTree(document, note);
	for (const template of [...document.querySelectorAll('template')]) {
		const content = template.content;
		if (!content || !content.querySelectorAll) continue;
		stripActiveTree(content, note);
	}
}

function stripActiveTree(root, note) {
	for (const el of [...root.querySelectorAll('*')]) {
		const tag = el.tagName.toLowerCase();
		if (!ACTIVE_TAGS.has(tag)) continue;
		const url = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('data') || '';
		note('active', url, { name: tag, text: url ? '' : el.textContent });
		// 外层去掉之后，里面的框架和事件也要记下来。
		stripActiveAttributes(el, note);
		el.remove();
	}

	for (const el of [...root.querySelectorAll('meta')]) {
		const equiv = el.getAttribute('http-equiv');
		const name = (el.getAttribute('name') || '').toLowerCase();
		// http-equiv 可以刷新页面或改引用策略。charset 没有 http-equiv，留下来。
		if (!(equiv || name === 'referrer')) continue;
		note('active', el.getAttribute('content') || equiv || name, { name: 'meta' });
		if (el.parentNode) el.remove();
	}

	for (const el of [...root.querySelectorAll('link')]) {
		const rel = (el.getAttribute('rel') || '').toLowerCase();
		if (/\bstylesheet\b/.test(rel)) continue;
		const token = rel.match(/\b(import|prefetch|preconnect|dns-prefetch|prerender|preload|modulepreload)\b/);
		if (!token) continue;
		note('active', el.getAttribute('href') || '', { name: token[1] });
		if (el.parentNode) el.remove();
	}

	// 表单会把页面里的字段提交到发件人的地址。留下里面的文字，去掉提交能力。
	for (const form of [...root.querySelectorAll('form')]) {
		note('active', form.getAttribute('action') || '', { name: 'form' });
		const parent = form.parentNode;
		if (!parent) continue;
		while (form.firstChild) parent.insertBefore(form.firstChild, form);
		form.remove();
	}

	for (const el of [...root.querySelectorAll('*')]) stripActiveAttributes(el, note);

	// <a rel="prefetch"> 会在阅读时就请求目标，不必等点击。
	for (const el of [...root.querySelectorAll('[rel]')]) {
		const original = el.getAttribute('rel') || '';
		const removed = original.split(/\s+/).filter(token => /^(import|prefetch|preconnect|dns-prefetch|prerender|preload|modulepreload)$/i.test(token));
		const kept = original.split(/\s+/).filter(token => token && !removed.includes(token) && !/^(import|prefetch|preconnect|dns-prefetch|prerender|preload|modulepreload)$/i.test(token));
		const next = kept.join(' ');
		if (next === original) continue;
		if (removed.length) note('active', el.getAttribute('href') || '', { name: removed[0].toLowerCase() });
		if (next) el.setAttribute('rel', next);
		else el.removeAttribute('rel');
	}
}

function stripActiveAttributes(el, note) {
	const target = el.tagName.toLowerCase();
	const remove = [];
	for (let i = 0; i < el.attributes.length; i++) {
		const attr = el.attributes[i];
		const name = attr.name.toLowerCase();
		if ((name.length > 2 && name.slice(0, 2) === 'on') || name === 'srcdoc' || name === 'formaction') {
			note('active', '', { name, target, text: attr.value });
			remove.push(attr.name);
		}
	}
	remove.forEach(name => el.removeAttribute(name));
	if (el.hasAttribute('ping')) {
		note('active', el.getAttribute('ping') || '', { name: 'ping', target });
		el.removeAttribute('ping');
	}

	for (const name of URL_ATTRS) {
		const value = el.getAttribute(name);
		if (value && isDangerousUrl(value)) {
			note('active', value, { name: 'url', target });
			el.removeAttribute(name);
		}
	}
}

function isDangerousUrl(value) {
	const text = String(value || '').replace(/[\u0000-\u0020]/g, '');
	if (/^(javascript|vbscript|livescript|mocha):/i.test(text)) return true;
	if (!/^data:/i.test(text)) return false;
	return !/^data:image\/(?:png|gif|jpe?g|webp|bmp|x-icon|vnd\.microsoft\.icon)[;,]/i.test(text);
}

function protectImages(document, stats, settings, note) {
	for (const el of [...document.querySelectorAll('img, input, image')]) {
		const tag = el.tagName.toLowerCase();
		if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() !== 'image') continue;

		const srcName = ['src', 'href', 'xlink:href'].find(name => el.hasAttribute(name));
		const src = srcName ? el.getAttribute(srcName) : '';
		if (src && isTrackingPixel(el, src, settings)) {
			el.remove();
			stats.strippedPixels++;
			note('pixel', src);
			continue;
		}

		if (srcName && blockAttribute(el, srcName, stats, settings, note) === 'removed') continue;
		if (el.hasAttribute('srcset')) blockSrcset(el, stats, settings, note);
	}
}

function protectMedia(document, stats, settings, note) {
	for (const el of [...document.querySelectorAll('video, audio, source')]) {
		for (const name of ['src', 'poster', 'srcset']) {
			if (!el.hasAttribute(name)) continue;
			if (name === 'srcset') blockSrcset(el, stats, settings, note);
			else blockAttribute(el, name, stats, settings, note);
		}
	}
}

function protectExternalRefs(document, stats, settings, note) {
	for (const el of [...document.querySelectorAll('use, feImage')]) {
		for (const name of ['href', 'xlink:href']) {
			if (el.hasAttribute(name)) blockAttribute(el, name, stats, settings, note);
		}
	}
}

function protectBackgrounds(document, stats, settings, note) {
	for (const el of [...document.querySelectorAll('[background]')]) {
		blockAttribute(el, 'background', stats, settings, note);
	}
}

function protectStylesheets(document, stats, settings, note) {
	for (const el of [...document.querySelectorAll('link')]) {
		if (!/\bstylesheet\b/i.test(el.getAttribute('rel') || '')) continue;
		const href = el.getAttribute('href');
		if (!href) continue;
		// 远程样式表不是图片。显示图片时也不恢复，否则发件人仍能确认已读。
		const kind = classifyUrl(href, { ...settings, blockRemote: true });
		if (!kind) continue;
		el.removeAttribute('href');
		if (kind === 'pixel') {
			stats.strippedPixels++;
			note('pixel', href);
		} else {
			note('stylesheet', href);
		}
	}
}

function protectCss(document, stats, settings, note) {
	for (const el of [...document.querySelectorAll('[style]')]) {
		rewriteStyle(el, el.getAttribute('style') || '', stats, settings, 'inline', note);
	}
	for (const el of [...document.querySelectorAll('style')]) {
		rewriteStyle(el, el.textContent || '', stats, settings, 'css', note);
	}
}

function rewriteStyle(el, original, stats, settings, kind, note) {
	const source = neutralizeCssBreakout(original);
	const always = classifyFor({ ...settings, blockRemote: true });
	const result = rewriteCss(source, classifyFor(settings), always, (found, url) => {
		if (found === 'expression') note('active', '', { name: 'expression' });
		else if (found === 'behavior') note('active', '', { name: 'behavior', text: url });
		else if (found === 'danger') note('active', url, { name: 'url' });
		else note(found, url);
	});
	if (!result.changed && source === original) return;
	if (settings.keepRemote) {
		const restorable = rewriteCss(source, classifyFor({ ...settings, blockRemote: false }), always);
		// 恢复出来的样式只留真正的图片，像素、样式表和字体不再写回去。
		if (restorable.css !== result.css && restorable.css.trim()) {
			el.setAttribute(kind === 'css' ? 'data-cm-css' : 'data-cm-inline', restorable.css);
		}
	}
	if (kind === 'css') el.textContent = result.css;
	else if (!result.css.trim()) el.removeAttribute('style');
	else el.setAttribute('style', result.css);
	stats.blockedRemote += result.remote;
	stats.strippedPixels += result.pixels;
}

const CLICK_TRACKER_HOST = /(^|\.)((list-manage\.com)|(mandrillapp\.com)|(sendgrid\.net)|(hubspotemail\.net)|(mailgun\.net)|(mailgun\.org)|(pstmrk\.it)|(awstrack\.me)|(urldefense\.proofpoint\.com)|(urldefense\.com)|(safelinks\.protection\.outlook\.com)|(safelinks\.protection\.office365\.us)|(linkprotect\.cudasvc\.com)|(protect2?\.fireeye\.com)|(protection\.sophos\.com)|(secure-web\.cisco\.com)|(avanan\.click)|(slack-redir\.net)|(mimecast\.com)|(mimecastprotect\.com)|(mailtrack\.io)|(mailchi\.mp))$/i;

function disableOpaqueTrackers(document, note) {
	for (const el of [...document.querySelectorAll('a[href], area[href]')]) {
		const href = el.getAttribute('href');
		if (!isOpaqueClickTracker(href)) continue;
		note('tracker', href);
		el.removeAttribute('href');
	}
}

function isOpaqueClickTracker(value) {
	let url;
	try {
		url = new URL(String(value || '').trim());
	} catch {
		return false;
	}
	const host = url.hostname;
	if (CLICK_TRACKER_HOST.test(host)) return true;
	if (/(^|\.)google\.com$/i.test(host) && url.pathname === '/url') return true;
	if (/(^|\.)(l\.facebook\.com|lm\.facebook\.com)$/i.test(host) && /^\/l\.php$/i.test(url.pathname)) return true;
	if (/(^|\.)linkedin\.com$/i.test(host) && url.pathname.toLowerCase().startsWith('/safety/go')) return true;
	if (/(^|\.)trendmicro\.com$/i.test(host) && /clicktime/i.test(url.pathname)) return true;
	return false;
}

function rewriteLinks(document, stats, note) {
	for (const el of [...document.querySelectorAll('a[href], area[href]')]) {
		const href = el.getAttribute('href');
		const cleaned = cleanHttpUrl(href);
		if (cleaned !== href) {
			el.setAttribute('href', cleaned);
			stats.rewrittenLinks++;
			note('link', cleaned, { from: href });
		}
		hardenLink(el);
	}

	for (const el of [...document.querySelectorAll('form[action]')]) {
		const action = el.getAttribute('action');
		const cleaned = cleanHttpUrl(action);
		if (cleaned !== action) el.setAttribute('action', cleaned);
	}
}

function blockSrcset(el, stats, settings, note) {
	const original = el.getAttribute('srcset') || '';
	const kept = [];
	const restorable = [];
	let remote = 0;
	let pixels = 0;
	let dropped = false;
	for (const part of original.split(',')) {
		const candidate = part.trim();
		if (!candidate) continue;
		const url = candidate.split(/\s+/)[0];
		if (isDangerousUrl(url)) {
			dropped = true;
			note('active', url, { name: 'url', target: el.tagName.toLowerCase() });
			continue;
		}
		const kind = classifyUrl(url, settings);
		if (kind === 'pixel') {
			pixels++;
			note('pixel', url);
			continue;
		}
		if (kind === 'remote') {
			remote++;
			note('remote', url);
			restorable.push(candidate);
			continue;
		}
		kept.push(candidate);
		restorable.push(candidate);
	}
	if (!remote && !pixels && !dropped) return;
	const saved = restorable.join(', ');
	if (settings.keepRemote && saved && saved !== kept.join(', ')) {
		el.setAttribute('data-cm-srcset', saved);
	}
	const next = kept.join(', ');
	if (next) el.setAttribute('srcset', next);
	else el.removeAttribute('srcset');
	stats.blockedRemote += remote;
	stats.strippedPixels += pixels;
}

function blockAttribute(el, name, stats, settings, note) {
	const value = el.getAttribute(name);
	if (!value) return 'kept';
	const kind = classifyUrl(value, settings);
	if (!kind) {
		if (isRemoteUrl(value)) el.setAttribute('referrerpolicy', 'no-referrer');
		return 'kept';
	}

	if (kind === 'pixel') {
		note('pixel', value);
		if (isImageTag(el) && (name === 'src' || name === 'href' || name === 'xlink:href')) {
			el.remove();
			stats.strippedPixels++;
			return 'removed';
		}
		el.removeAttribute(name);
		stats.strippedPixels++;
		return 'stripped';
	}

	note('remote', value);
	if (settings.keepRemote) {
		el.setAttribute(stashName(name), value);
		if (isImageTag(el) && (name === 'src' || name === 'href' || name === 'xlink:href')) {
			el.setAttribute(name, PLACEHOLDER);
		} else {
			el.removeAttribute(name);
		}
	} else if (isImageTag(el) && (name === 'src' || name === 'href' || name === 'xlink:href')) {
		const alt = (el.getAttribute('alt') || '').trim();
		if (alt) el.replaceWith(el.ownerDocument.createTextNode(alt));
		else el.remove();
		stats.blockedRemote++;
		return 'removed';
	} else {
		el.removeAttribute(name);
	}

	stats.blockedRemote++;
	return 'blocked';
}

function rewriteCss(css, classifyImage, classifyAlways, report = () => {}) {
	let remote = 0;
	let pixels = 0;
	const apply = (url, classify, countRemote, findingKind) => {
		const decoded = decodeCssUrl(url);
		if (isDangerousUrl(decoded)) {
			report('danger', decoded);
			return 'none';
		}
		const kind = classify(decoded);
		if (kind === 'pixel') {
			pixels++;
			report('pixel', decoded);
			return 'none';
		}
		if (kind === 'remote') {
			if (countRemote) remote++;
			report(findingKind, decoded);
			return 'none';
		}
		return null;
	};
	const replaceUrl = (value, classify, countRemote, findingKind) => value.replace(
		/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi,
		(match, quote, url) => {
			const replacement = apply(url, classify, countRemote, findingKind);
			return replacement == null ? match : replacement;
		}
	);

	let next = css.replace(/@import\s+(?:url\(\s*(['"]?)([\s\S]*?)\1\s*\)|(['"])([\s\S]*?)\3)\s*[^;]*;?/gi, (match, q1, u1, q2, u2) => {
		const replacement = apply(u1 || u2 || '', classifyAlways, false, 'import');
		return replacement == null ? match : '';
	});
	next = next.replace(/@font-face\s*\{[^}]*\}/gi, block => replaceUrl(block, classifyAlways, false, 'font'));
	next = next.replace(/(-webkit-)?image-set\(([^()]*)\)/gi, (match, prefix, body) => {
		let hit = false;
		const replaced = body.replace(/(['"])([\s\S]*?)\1/gi, (quoted, quote, url) => {
			const replacement = apply(url, classifyImage, true, 'remote');
			if (replacement == null) return quoted;
			hit = true;
			return quote + quote;
		});
		return hit ? (prefix || '') + 'image-set(' + replaced + ')' : match;
	});
	next = replaceUrl(next, classifyImage, true, 'remote');
	next = next.replace(/expression\s*\((?:[^()]|\([^()]*\))*\)/gi, () => {
		report('expression', 'expression()');
		return 'none';
	});
	next = next.replace(/(?:-moz-binding|behavior)\s*:[^;}]*/gi, (match) => {
		report('behavior', match.trim());
		return '';
	});
	return { css: next, remote, pixels, changed: next !== css };
}

function classifyFor(settings) {
	return url => classifyUrl(url, settings);
}

function neutralizeCssBreakout(css) {
	return String(css).replace(/<\/?\s*style/gi, '');
}

function decodeCssUrl(value) {
	const text = String(value || '').replace(/\/\*[\s\S]*?\*\//g, '');
	return text.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\r\n\f]?|(\r\n|[\n\r\f])|(.))/g, (match, hex, newline, char) => {
		if (hex) {
			const code = parseInt(hex, 16);
			if (!code || code > 0x10FFFF) return '\uFFFD';
			return String.fromCodePoint(code);
		}
		if (newline) return '';
		return char;
	}).trim();
}

function classifyUrl(url, settings) {
	if (isTrustedAttachment(url, settings.trustedOrigins)) return null;
	if (settings.stripPixels && isPixelUrl(url)) return 'pixel';
	if (settings.blockRemote && isRemoteUrl(url)) return 'remote';
	return null;
}

function isTrackingPixel(el, src, settings) {
	if (!src || isTrustedAttachment(src, settings.trustedOrigins)) return false;
	if (!settings.stripPixels) return false;
	if (!(isRemoteUrl(src) || isPixelUrl(src))) return false;
	if (isPixelUrl(src)) return true;
	if (isTiny(el)) return true;
	return isHiddenTracker(el);
}

function isHiddenTracker(el) {
	if (!isHidden(el)) return false;
	const alt = (el.getAttribute('alt') || '').trim().toLowerCase();
	if (alt && !['spacer', 'pixel', 'tracking'].includes(alt)) return false;
	const width = declaredSize(el, 'width');
	const height = declaredSize(el, 'height');
	// 响应式邮件会用内联 display:none 藏起另一张大图，有实际尺寸时保留。
	if (width != null && width > 1) return false;
	if (height != null && height > 1) return false;
	return true;
}

function isHidden(el) {
	const style = el.getAttribute('style') || '';
	return /display\s*:\s*none/i.test(style)
		|| /visibility\s*:\s*hidden/i.test(style)
		|| /opacity\s*:\s*0(?:\.0+)?(?:\s*!important)?(?:\s*;|\s*$)/i.test(style);
}

function isTiny(el) {
	const width = declaredSize(el, 'width');
	const height = declaredSize(el, 'height');
	return width != null && height != null && width <= 1 && height <= 1;
}

function declaredSize(el, name) {
	const attr = el.getAttribute(name);
	if (attr != null && String(attr).trim() !== '') {
		const value = parseFloat(attr);
		if (!Number.isNaN(value)) return value;
	}
	const style = el.getAttribute('style') || '';
	const match = style.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([0-9.]+)\\s*px', 'i'));
	return match ? parseFloat(match[1]) : null;
}

function isPixelUrl(url) {
	const value = String(url || '').trim();
	if (!value || /^(data|blob|cid|mailto|tel):/i.test(value)) return false;
	if (PIXEL_FILE.test(value) || PIXEL_PATH.test(value)) return true;
	try {
		const parsed = new URL(value, 'https://local.invalid');
		const host = parsed.hostname;
		if (PIXEL_HOST.test(host)) return true;
		if (/(^|\.)facebook\.com$/i.test(host) && parsed.pathname.startsWith('/tr')) return true;
		if (/(^|\.)google\.com$/i.test(host) && /^\/(pagead|ads|adsense)\b/i.test(parsed.pathname)) return true;
		if (/(^|\.)awstrack\.me$/i.test(host) && /\/(i0|ci0)\//i.test(parsed.pathname)) return true;
		const target = parsed.pathname + parsed.search;
		return PIXEL_FILE.test(target) || PIXEL_PATH.test(target);
	} catch {
		return false;
	}
}

export function isRemoteUrl(url) {
	const value = String(url || '').trim();
	if (!value) return false;
	if (/^(#|data:|blob:|cid:|mailto:|tel:)/i.test(value)) return false;
	if (/^(javascript|vbscript):/i.test(value)) return false;
	if (value.startsWith('//')) return true;
	return /^https?:\/\//i.test(value);
}

function isTrustedAttachment(url, origins) {
	if (!origins?.length) return false;
	try {
		const parsed = new URL(String(url).trim(), 'https://local.invalid');
		return origins.includes(parsed.origin) && parsed.pathname.startsWith('/attachments/');
	} catch {
		return false;
	}
}

function cleanHttpUrl(value) {
	let current = String(value || '').trim();
	if (!current) return current;
	for (let i = 0; i < 4; i++) {
		const unwrapped = unwrapKnownTracker(current);
		const next = stripTrackingParams(unwrapped || current);
		if (next === current) break;
		current = next;
	}
	return current;
}

function unwrapKnownTracker(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	const host = url.hostname;
	let dest = null;

	if (/(^|\.)awstrack\.me$/i.test(host)) {
		const match = url.pathname.match(/\/L0\/(https?:[^/]+)/i);
		if (match) {
			try {
				dest = decodeURIComponent(match[1]);
			} catch {
				dest = null;
			}
		}
	} else if (/(^|\.)urldefense\.proofpoint\.com$/i.test(host) || /(^|\.)urldefense\.com$/i.test(host)) {
		dest = unwrapProofpoint(value, url);
	} else if (/(^|\.)safelinks\.protection\.outlook\.com$/i.test(host) || /(^|\.)safelinks\.protection\.office365\.us$/i.test(host)) {
		dest = httpParam(url, ['url']);
	} else if (/(^|\.)google\.com$/i.test(host) && url.pathname === '/url') {
		dest = httpParam(url, ['q', 'url']);
	} else if (/(^|\.)linkprotect\.cudasvc\.com$/i.test(host)) {
		dest = httpParam(url, ['a', 'u', 'url']);
	} else if (/(^|\.)trendmicro\.com$/i.test(host) && /clicktime/i.test(url.pathname)) {
		dest = httpParam(url, ['url']);
	} else if (/(^|\.)protect2?\.fireeye\.com$/i.test(host)) {
		dest = httpParam(url, ['u', 'url']);
	} else if (/(^|\.)protection\.sophos\.com$/i.test(host)) {
		dest = httpParam(url, ['u']) || decodeBase64Http(rawQueryParam(url, 'u'));
	} else if (/(^|\.)secure-web\.cisco\.com$/i.test(host)) {
		dest = embeddedHttp(url.pathname);
	} else if (/(^|\.)avanan\.click$/i.test(host)) {
		dest = unwrapAvanan(url.pathname);
	} else if (/(^|\.)(l\.facebook\.com|lm\.facebook\.com)$/i.test(host) && /^\/l\.php$/i.test(url.pathname)) {
		dest = httpParam(url, ['u', 'url']);
	} else if (/(^|\.)linkedin\.com$/i.test(host) && url.pathname.toLowerCase().startsWith('/safety/go')) {
		dest = httpParam(url, ['url']);
	} else if (/(^|\.)slack-redir\.net$/i.test(host)) {
		dest = httpParam(url, ['url']);
	} else if (/(^|\.)(mimecast\.com|mimecastprotect\.com)$/i.test(host)) {
		dest = httpParam(url, ['url', 'u']);
	} else if (WRAPPER_HOST.test(host)) {
		dest = httpParam(url, ['url', 'redirect', 'destination', 'dest', 'redirect_url', 'redirectUrl', 'u']);
	}

	return acceptHttp(dest);
}

function unwrapProofpoint(raw, url) {
	const v3 = String(raw).match(/\/v3\/__(.*?)__;/);
	if (v3) {
		try {
			const dest = decodeURIComponent(v3[1]);
			if (/^https?:\/\//i.test(dest)) return dest;
		} catch {
			// 继续尝试 v1/v2 的 u 参数。
		}
	}

	const encoded = url.searchParams.get('u');
	if (!encoded) return null;
	if (/^https?:\/\//i.test(encoded)) return encoded;
	try {
		// Proofpoint 先把原文里的下划线写成 -5F，再把斜杠写成下划线。
		// 必须先还原斜杠，再解码百分号，否则查询参数名里的下划线会被当成斜杠。
		const dest = decodeURIComponent(encoded.replace(/-/g, '%').replace(/_/g, '/'));
		return /^https?:\/\//i.test(dest) ? dest : null;
	} catch {
		return null;
	}
}

function httpParam(url, names) {
	for (const name of names) {
		let value = url.searchParams.get(name);
		if (!value) continue;
		for (let i = 0; i < 2 && value && !/^https?:\/\//i.test(value); i++) {
			try {
				const decoded = decodeURIComponent(value);
				if (decoded === value) break;
				value = decoded;
			} catch {
				break;
			}
		}
		if (value && /^https?:\/\//i.test(value)) return value;
	}
	return null;
}

function acceptHttp(value) {
	if (!value || /[\u0000-\u001f\s]/.test(value)) return null;
	if (!/^https?:\/\//i.test(value)) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.toString();
	} catch {
		return null;
	}
}

function embeddedHttp(pathname) {
	const match = decodeRepeated(pathname).match(/https?:\/\/[^\s"'<>]+/i);
	return match ? match[0].replace(/[),.;]+$/, '') : null;
}

function unwrapAvanan(pathname) {
	const match = decodeRepeated(pathname).match(/___(https?:\/\/[\s\S]+?)___/i);
	return match ? match[1] : null;
}

function decodeRepeated(value) {
	let current = String(value || '');
	for (let i = 0; i < 2; i++) {
		try {
			const next = decodeURIComponent(current);
			if (next === current) break;
			current = next;
		} catch {
			break;
		}
	}
	return current;
}

function rawQueryParam(url, name) {
	const query = url.search.startsWith('?') ? url.search.slice(1) : url.search;
	for (const part of query.split('&')) {
		const eq = part.indexOf('=');
		const key = eq === -1 ? part : part.slice(0, eq);
		let decodedKey = key;
		try {
			decodedKey = decodeURIComponent(key);
		} catch {
			decodedKey = key;
		}
		if (decodedKey !== name) continue;
		const raw = eq === -1 ? '' : part.slice(eq + 1);
		try {
			return decodeURIComponent(raw.replace(/\+/g, '%2B'));
		} catch {
			return raw;
		}
	}
	return null;
}

function decodeBase64Http(value) {
	if (!value || !/^[A-Za-z0-9+/=_-]+$/.test(value)) return null;
	try {
		const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
		const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
		const decoded = atob(normalized + pad);
		return /^https?:\/\//i.test(decoded) ? decoded : null;
	} catch {
		return null;
	}
}

function stripTrackingParams(value) {
	const raw = String(value || '').trim();
	if (!raw || /^(mailto:|tel:|cid:|data:|blob:|javascript:|#)/i.test(raw)) return raw;
	try {
		const base = 'https://local.invalid';
		const url = new URL(raw, base);
		const keys = [...url.searchParams.keys()];
		let changed = false;
		for (const key of keys) {
			if (!isTrackingParam(key)) continue;
			url.searchParams.delete(key);
			changed = true;
		}
		if (!changed) return raw;
		if (url.origin === base) return url.pathname + url.search + url.hash;
		return url.toString();
	} catch {
		return raw;
	}
}

function isTrackingParam(key) {
	const name = key.toLowerCase();
	return name.startsWith('utm_') || TRACKING_PARAMS.has(name);
}

function hardenLink(el) {
	const href = el.getAttribute('href') || '';
	if (!isRemoteUrl(href)) return;
	const rel = new Set((el.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
	rel.add('noopener');
	rel.add('noreferrer');
	rel.add('nofollow');
	el.setAttribute('rel', [...rel].join(' '));
	el.setAttribute('referrerpolicy', 'no-referrer');
	el.setAttribute('target', '_blank');
}

function isImageTag(el) {
	const tag = el.tagName.toLowerCase();
	return tag === 'img' || tag === 'image' || (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'image');
}

function stashName(name) {
	return name === 'xlink:href' ? 'data-cm-xlink' : 'data-cm-' + name;
}
