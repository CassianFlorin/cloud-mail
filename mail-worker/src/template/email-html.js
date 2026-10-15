import { parseHTML } from 'linkedom';
import domainUtils from '../utils/domain-uitls';
import { protectEmailDocument } from '../../../shared/anti-track.js';

export default function emailHtmlTemplate(html, domain) {

	const normalizedDomain = domainUtils.toOssDomain(domain);
	html = (html || '').replace(/{{domain}}/g, normalizedDomain + '/');
	const { document } = parseHTML(html);
	const stats = protectEmailDocument(document, {
		blockRemote: true,
		keepRemote: true,
		trustedOrigins: trustedOrigins(normalizedDomain)
	});
	html = document.toString();
	const safeHtmlJson = JSON.stringify(html).replace(/</g, '\\u003C');
	const interceptHtml = renderIntercept(stats.findings, stats.omitted);
	const remoteBanner = stats.blockedRemote > 0 ? `
        <div id="cm-remote-banner" style="margin:0 0 12px;padding:10px 12px;border:1px solid #d6e4ff;background:#f5f9ff;color:#1f2a37;font:14px/1.5 sans-serif;display:flex;gap:12px;align-items:center;justify-content:space-between;">
            <span style="background:transparent">已拦截 ${stats.blockedRemote} 处远程内容，避免发件人知道这封邮件已被阅读。</span>
            <button type="button" onclick="cmShowRemote()" style="border:0;background:#0e70df;color:#fff;border-radius:4px;padding:6px 10px;cursor:pointer;">显示图片</button>
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
        <div id='container' class='content-html'></div>
    </div>

    <script>

        function cmShowRemote() {
            const host = document.getElementById('container');
            const root = host && host.shadowRoot;
            if (!root) return;
            root.querySelectorAll('[data-cm-src], [data-cm-srcset], [data-cm-poster], [data-cm-href], [data-cm-background], [data-cm-xlink], [data-cm-inline], [data-cm-css]').forEach(function (el) {
                ['src', 'srcset', 'poster', 'href', 'background'].forEach(function (name) {
                    const saved = el.getAttribute('data-cm-' + name);
                    if (saved != null) el.setAttribute(name, saved);
                });
                const xlink = el.getAttribute('data-cm-xlink');
                if (xlink != null) el.setAttribute('xlink:href', xlink);
                if (el.hasAttribute('data-cm-inline')) el.setAttribute('style', el.getAttribute('data-cm-inline'));
                if (el.hasAttribute('data-cm-css')) el.textContent = el.getAttribute('data-cm-css');
                el.setAttribute('referrerpolicy', 'no-referrer');
            });
            const banner = document.getElementById('cm-remote-banner');
            if (banner) banner.remove();
        }

        function readBodyStyle(html) {
            const tag = html.match(/<body[^>]*>/i);
            if (!tag) return '';
            const style = tag[0].match(/(?:^|\\s)style\\s*=\\s*"([^"]*)"/i);
            return style ? style[1] : '';
        }

        function renderHTML(html) {
            const container = document.getElementById('container');
            const shadowRoot = container.attachShadow({ mode: 'open' });

            // 只取 body 自己的 style，避免命中 data-cm-inline 里保存的原始追踪样式。
            const bodyStyle = readBodyStyle(html);

            // 移除 <body> 标签
            const cleanedHtml = html.replace(/<\\/?body[^>]*>/gi, '');

            // 渲染内容
            shadowRoot.innerHTML = \`
                <style>
                    :host {
                        all: initial;
                        width: 100%;
                        height: 100%;
                        font-family: Inter, -apple-system, BlinkMacSystemFont,
                                    'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        font-size: 14px;
                        line-height: 1.5;
                        color: #13181D;
                        word-break: break-word;
                        overflow: auto; /* 添加滚动 */
                    }

                    h1, h2, h3, h4 {
                        font-size: 18px;
                        font-weight: 700;
                    }

                    p {
                        margin: 0;
                    }

                    a {
                        text-decoration: none;
                        color: #0E70DF;
                    }

                    .shadow-content {
                        background: #FFFFFF;
                        width: fit-content;
                        height: fit-content;
                        min-width: 100%;
                    }

                    img:not(table img) {
                        max-width: 100% !important;
                        height: auto !important;
                    }
                </style>
                <div class="shadow-content">
                    \${cleanedHtml}
                </div>
            \`;

            // 用 cssText 套用 body 样式，避免样式文本把 </style> 和追踪图片写进页面。
            const styled = shadowRoot.querySelector('.shadow-content');
            if (styled && bodyStyle) styled.style.cssText = bodyStyle;

            // 自动缩放
            autoScale(shadowRoot, container);
        }

        function autoScale(shadowRoot, container) {

            if (!shadowRoot || !container) return;

            const parent = container;
            const shadowContent = shadowRoot.querySelector('.shadow-content');

            if (!shadowContent) return;

            const parentWidth = parent.offsetWidth;
            const childWidth = shadowContent.scrollWidth;

            if (childWidth === 0) return;

            const scale = parentWidth / childWidth;

            const hostElement = shadowRoot.host;
            hostElement.style.zoom = scale;
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
	const order = ['active', 'pixel', 'stylesheet', 'import', 'font', 'remote', 'link'];
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
