import { parseHTML } from 'linkedom';
import domainUtils from '../utils/domain-uitls';
import { protectEmailDocument } from '../../../shared/anti-track.js';

export default function emailHtmlTemplate(html, domain) {

	const normalizedDomain = domainUtils.toOssDomain(domain);
	html = (html || '').replace(/{{domain}}/g, normalizedDomain + '/');
	const { document } = parseHTML(html);
	const stats = protectEmailDocument(document, {
		blockRemote: true,
		// 这个页面没有登录态，不能代取图片。留下原地址也不会再恢复，避免浏览器自己去请求。
		keepRemote: false,
		trustedOrigins: trustedOrigins(normalizedDomain)
	});
	html = document.toString();
	const safeHtmlJson = JSON.stringify(html).replace(/</g, '\\u003C');
	const interceptHtml = renderIntercept(stats.findings, stats.omitted);
	const remoteBanner = stats.blockedRemote > 0 ? `
        <div id="cm-remote-banner" style="margin:0 0 12px;padding:10px 12px;border:1px solid #d6e4ff;background:#f5f9ff;color:#1f2a37;font:14px/1.5 sans-serif;">
            <span style="background:transparent">已拦截 ${stats.blockedRemote} 处远程内容。此页不加载这些图片，避免把你的网络地址发给发件人。</span>
        </div>` : '';

	return `<!DOCTYPE html>
<html lang='en' >
<head>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            background: #FFF;
        }

        .content-box {
        		padding: 15px 10px;
            width: 100%;
            height: 100%;
            overflow: auto; /* 改为 auto 允许滚动 */
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .content-html {
            width: 100%;
            height: 100%;
        }
    </style>
</head>
<body>
    <div class='content-box'>
        ${interceptHtml}
        ${remoteBanner}
        <iframe id='container' class='content-html' sandbox='allow-same-origin allow-popups allow-popups-to-escape-sandbox' referrerpolicy='no-referrer' title='email'></iframe>
    </div>

    <script>

        function readBodyStyle(html) {
            const tag = html.match(/<body[^>]*>/i);
            if (!tag) return '';
            const style = tag[0].match(/(?:^|\\s)style\\s*=\\s*"([^"]*)"/i);
            return style ? style[1] : '';
        }

        function renderHTML(html) {
            const frame = document.getElementById('container');
            const bodyStyle = readBodyStyle(html);
            const cleanedHtml = html.replace(/<\\/?body[^>]*>/gi, '');
            // 没有 allow-scripts。allow-same-origin 只用来量高度。
            frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \\'none\\'; img-src blob: data:; media-src blob: data:; style-src \\'unsafe-inline\\'; font-src blob: data:; form-action \\'none\\'"><style>html,body{margin:0;padding:0}body{font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#13181D;word-break:break-word}p{margin:0}a{text-decoration:none;color:#0E70DF}.shadow-content{background:#fff;width:fit-content;min-width:100%}img:not(table img){max-width:100%!important;height:auto!important}</style></head><body><div class="shadow-content">' + cleanedHtml + '</div></body></html>';
            frame.onload = function () {
                const styled = frame.contentDocument && frame.contentDocument.querySelector('.shadow-content');
                if (styled && bodyStyle) styled.style.cssText = bodyStyle;
                autoScale(frame);
            };
        }

        function autoScale(frame) {
            const doc = frame.contentDocument;
            const content = doc && doc.querySelector('.shadow-content');
            if (!content) return;
            const parentWidth = frame.parentElement ? frame.parentElement.clientWidth : frame.offsetWidth;
            const childWidth = content.scrollWidth;
            if (!parentWidth || !childWidth) return;
            const scale = childWidth > parentWidth ? parentWidth / childWidth : 1;
            frame.style.zoom = String(scale);
            frame.style.height = Math.max(Math.ceil(content.scrollHeight * scale), 40) + 'px';
        }

        // 使用示例
        const exampleHtml = ${safeHtmlJson};

        // 渲染HTML
        renderHTML(exampleHtml);
    </script>
</body>
</html>`
}

const INTERCEPT_LABELS = {
	active: '脚本和可执行内容',
	pixel: '追踪像素',
	stylesheet: '远程样式表',
	import: '外部样式',
	font: '远程字体',
	remote: '远程图片和资源',
	tracker: '已停用的追踪链接',
	link: '追踪链接'
};

const ACTIVE_LABELS = {
	script: '脚本',
	iframe: '内嵌框架',
	object: '嵌入对象',
	embed: '嵌入内容',
	applet: '小程序',
	frame: '框架',
	frameset: '框架集',
	base: '页面基址',
	portal: '内嵌页面',
	fencedframe: '内嵌页面',
	foreignobject: '外部图形',
	'annotation-xml': '标注',
	noscript: '备用脚本',
	animate: '动画',
	animatetransform: '动画',
	animatemotion: '动画',
	set: '动画',
	discard: '动画',
	handler: '事件处理',
	form: '表单提交',
	meta: '自动跳转',
	prefetch: '预取',
	preconnect: '预连接',
	'dns-prefetch': '域名预解析',
	prerender: '预渲染',
	preload: '预加载',
	modulepreload: '模块预加载',
	import: '样式导入',
	expression: '样式表达式',
	behavior: '样式绑定',
	url: '可执行地址',
	ping: '点击上报',
	srcdoc: '内嵌页面源码',
	formaction: '表单提交地址'
};

function renderIntercept(findings, omitted) {
	const list = findings || [];
	if (!list.length) {
		return `<p style="margin:0 0 12px;color:#5c6b7a;font:13px/1.5 sans-serif;background:transparent;">这封邮件没有拦截到远程内容、追踪链接或脚本。</p>`;
	}
	const buckets = new Map();
	for (const item of list) {
		if (!buckets.has(item.kind)) buckets.set(item.kind, []);
		buckets.get(item.kind).push(item);
	}
	const order = ['active', 'pixel', 'stylesheet', 'import', 'font', 'remote', 'tracker', 'link'];
	const kinds = [...order.filter(kind => buckets.has(kind)), ...[...buckets.keys()].filter(kind => !order.includes(kind))];
	const body = kinds.map(kind => {
		const items = buckets.get(kind).map(item => `<li style="margin:0 0 8px;background:transparent;overflow-wrap:anywhere;">${findingHtml(item)}</li>`).join('');
		const label = INTERCEPT_LABELS[kind] || kind;
		return `<section style="margin-top:10px;background:transparent;"><div style="font-weight:600;background:transparent;">${escapeHtml(label)}</div><ul style="margin:6px 0 0;padding-left:18px;background:transparent;">${items}</ul></section>`;
	}).join('');
	const more = omitted ? `<p style="margin:8px 0 0;background:transparent;">还有 ${omitted} 项没有列出。</p>` : '';
	return `<details style="margin:0 0 12px;padding:10px 12px;border:1px solid #d6e4ff;background:#f5f9ff;color:#1f2a37;font:14px/1.5 sans-serif;">
<summary style="cursor:pointer;background:transparent;">这封邮件拦截了 ${list.length} 项</summary>
<div style="background:transparent;">${body}${more}</div>
</details>`;
}

function findingHtml(item) {
	if (item.kind === 'link') {
		return `<div style="background:transparent;">${escapeHtml(item.from || '')}</div><div style="background:transparent;">清理后 ${escapeHtml(item.url || '')}</div>`;
	}
	if (item.kind === 'active') {
		const title = item.target && item.name
			? `${item.target} 上的 ${item.name}`
			: (ACTIVE_LABELS[item.name] || item.name || '可执行内容');
		const extra = [item.url, item.text].filter(Boolean).map(value => `<div style="background:transparent;">${escapeHtml(value)}</div>`).join('');
		return `<div style="background:transparent;">${escapeHtml(title)}</div>${extra}`;
	}
	return `<div style="background:transparent;">${escapeHtml(item.url || '')}</div>`;
}

function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	}[ch]));
}

function trustedOrigins(domain) {
	if (!domain) return [];
	try {
		return [new URL(domain).origin];
	} catch {
		return [];
	}
}
