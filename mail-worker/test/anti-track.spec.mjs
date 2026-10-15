import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { protectEmailDocument } from '../../shared/anti-track.js';

function render(html, options) {
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const stats = protectEmailDocument(document, options);
	return { html: document.toString(), stats, document };
}

test('blocks remote images and keeps a restorable address when requested', () => {
	const blocked = render('<img alt="Logo" src="https://cdn.example.com/logo.png">', {
		blockRemote: true
	});
	assert.equal(blocked.stats.blockedRemote, 1);
	assert.equal(blocked.document.querySelector('img'), null);
	assert.match(blocked.html, /Logo/);

	const kept = render('<img alt="Logo" src="https://cdn.example.com/logo.png">', {
		blockRemote: true,
		keepRemote: true
	});
	const image = kept.document.querySelector('img');
	assert.equal(image.getAttribute('data-cm-src'), 'https://cdn.example.com/logo.png');
	assert.match(image.getAttribute('src'), /^data:image\/gif/);
});

test('leaves local, inline, and owned attachment images alone', () => {
	const { document, stats } = render([
		'<img src="cid:logo">',
		'<img src="data:image/gif;base64,AAAA">',
		'<img src="blob:https://mail.example/111">',
		'<img src="https://files.example/attachments/a.png">'
	].join(''), {
		blockRemote: true,
		trustedOrigins: ['https://files.example']
	});
	assert.equal(stats.blockedRemote, 0);
	assert.equal(document.querySelectorAll('img').length, 4);
});

test('removes tracking pixels even when other remote images are allowed', () => {
	const { document, stats } = render([
		'<img src="https://cdn.example.com/logo.png" width="600" height="200">',
		'<img src="https://track.example.com/pixel.gif" width="1" height="1">',
		'<img src="https://news.example.com/track/open?id=1" style="display:none">',
		'<img alt="Mobile" src="https://cdn.example.com/mobile.png" width="600" style="display:none">'
	].join(''), { blockRemote: false });
	assert.equal(stats.strippedPixels, 2);
	assert.equal(stats.blockedRemote, 0);
	const sources = [...document.querySelectorAll('img')].map(img => img.getAttribute('src'));
	assert.deepEqual(sources, [
		'https://cdn.example.com/logo.png',
		'https://cdn.example.com/mobile.png'
	]);
});

test('strips tracking parameters and unwraps known click wrappers', () => {
	const outlook = 'https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fwelcome%3Futm_source%3Dnews&amp;data=05&amp;sdata=abc&amp;reserved=0';
	const aws = 'https://abc.r.us-east-1.awstrack.me/L0/https:%2F%2Fexample.com%2Fdocs%3Futm_source%3Dses/1/010101';
	const proofpoint = 'https://urldefense.proofpoint.com/v2/url?u=https-3A__example.com_a-3Futm-5Fsource-3Dx&amp;d=Dw';
	const { document, stats } = render(`
		<a href="https://example.com/item?id=2&amp;utm_source=news&amp;spm=a.b">item</a>
		<a href="${outlook}">outlook</a>
		<a href="${aws}">aws</a>
		<a href="${proofpoint}">proofpoint</a>
		<a href="mailto:a@example.com">mail</a>
	`, { blockRemote: false });
	const hrefs = [...document.querySelectorAll('a')].map(anchor => anchor.getAttribute('href'));
	assert.deepEqual(hrefs, [
		'https://example.com/item?id=2',
		'https://example.com/welcome',
		'https://example.com/docs',
		'https://example.com/a',
		'mailto:a@example.com'
	]);
	assert.equal(stats.rewrittenLinks, 4);
	assert.equal(document.querySelector('a').getAttribute('target'), '_blank');
	assert.match(document.querySelector('a').getAttribute('rel'), /noreferrer/);
});

test('removes active content that can phone home without a remote image', () => {
	const { html, document } = render(`
		<img src="https://cdn.example.com/logo.png" onerror="fetch('https://track.example/x')">
		<a href="javascript:fetch('https://track.example/y')">bad</a>
		<iframe src="https://track.example/frame"></iframe>
		<meta http-equiv="refresh" content="0;url=https://track.example">
		<link rel="preconnect" href="https://track.example">
		<div onclick="navigator.sendBeacon('https://track.example')"></div>
	`, { blockRemote: false });
	assert.equal(document.querySelector('iframe'), null);
	assert.equal(document.querySelector('meta'), null);
	assert.equal(document.querySelector('link'), null);
	assert.equal(document.querySelector('img').hasAttribute('onerror'), false);
	assert.equal(document.querySelector('div').hasAttribute('onclick'), false);
	assert.equal(document.querySelector('a').hasAttribute('href'), false);
	assert.doesNotMatch(html, /sendBeacon|preconnect|javascript:/);
});

test('removes remote style urls and restores them only from the saved copy', () => {
	const { document, stats } = render(`
		<div style="color:#111;background-image:url(https://cdn.example.com/bg.png)"></div>
		<style>@import url("https://cdn.example.com/a.css"); p { background: url(https://track.example/pixel.gif); }</style>
	`, { blockRemote: true, keepRemote: true });
	assert.ok(stats.blockedRemote >= 1);
	assert.equal(stats.strippedPixels, 1);
	const box = document.querySelector('div');
	assert.match(box.getAttribute('data-cm-inline'), /bg\.png/);
	assert.doesNotMatch(box.getAttribute('style'), /cdn\.example\.com/);
	const style = document.querySelector('style');
	assert.equal(style.getAttribute('data-cm-css'), null);
	assert.doesNotMatch(style.textContent, /a\.css|pixel\.gif/);
});

test('saved remote styles and srcset keep real images and drop tracking pixels', () => {
	const { document } = render([
		'<div style="background-image:url(https://cdn.example.com/bg.png);background-image:url(https://track.example/pixel.gif)"></div>',
		'<img src="cid:logo" srcset="https://cdn.example.com/a.png 1x, https://track.example/pixel.gif 2x">'
	].join(''), { blockRemote: true, keepRemote: true });
	const saved = document.querySelector('div').getAttribute('data-cm-inline') || '';
	assert.match(saved, /bg\.png/);
	assert.doesNotMatch(saved, /pixel\.gif/);
	assert.doesNotMatch(document.querySelector('div').getAttribute('style') || '', /cdn\.example|pixel\.gif/);
	const image = document.querySelector('img');
	assert.equal(image.getAttribute('src'), 'cid:logo');
	assert.equal(image.getAttribute('srcset'), null);
	assert.match(image.getAttribute('data-cm-srcset'), /a\.png/);
	assert.doesNotMatch(image.getAttribute('data-cm-srcset'), /pixel\.gif/);
});

test('css escapes, comments, and prefetch cannot phone home when the message is opened', () => {
	const { document, stats } = render(`
		<div style="background:url(https:\\2f\\2ftrack.example\\2fpixel.gif)"></div>
		<div id="logo" style="background:url(\\68 ttps://cdn.example.com/logo.png)"></div>
		<div id="breakout" style="color:red;}</style><img src=https://track.example/pixel.gif>"></div>
		<a rel="prefetch noopener" href="https://example.com/item">item</a>
		<svg><use href="https://evil.example/a.svg#i"></use></svg>
		<style>p{background-image:image-set("https://cdn.example.com/a.png" 1x, "https://cdn.example.com/b.png" 2x)} q{background:url(htt/*x*/ps://track.example/pixel.gif)}</style>
	`, { blockRemote: true });
	assert.ok(stats.strippedPixels >= 2);
	assert.doesNotMatch(document.querySelector('div').getAttribute('style') || '', /track\.example/);
	assert.doesNotMatch(document.getElementById('logo').getAttribute('style') || '', /cdn\.example/);
	assert.doesNotMatch(document.getElementById('breakout').getAttribute('style') || '', /<\/style>/i);
	assert.equal(document.querySelector('use').getAttribute('href'), null);
	assert.doesNotMatch(document.querySelector('a').getAttribute('rel'), /prefetch/);
	assert.match(document.querySelector('a').getAttribute('rel'), /noreferrer/);
	assert.doesNotMatch(document.querySelector('style').textContent, /cdn\.example|track\.example/);
});

test('showing pictures still drops pixels, remote stylesheets, and web fonts', () => {
	const { document } = render([
		'<img src="https://cdn.example.com/logo.png" width="200" height="80">',
		'<link rel="stylesheet" href="https://cdn.example.com/a.css">',
		'<style>@import url("https://cdn.example.com/b.css"); @font-face { src: url("https://cdn.example.com/f.woff"); } p { background: url(https://cdn.example.com/bg.png); }</style>'
	].join(''), { blockRemote: false, keepRemote: true });
	assert.equal(document.querySelector('img').getAttribute('src'), 'https://cdn.example.com/logo.png');
	assert.equal(document.querySelector('link').hasAttribute('href'), false);
	const css = document.querySelector('style').textContent;
	assert.match(css, /bg\.png/);
	assert.doesNotMatch(css, /b\.css|f\.woff/);
});

test('unwraps encoded click wrappers when the destination is still visible', () => {
	const sophosPayload = Buffer.from('https://example.com/a+b').toString('base64');
	const links = [
		['https://linkprotect.cudasvc.com/url?a=https%3A%2F%2Fexample.com%2Fdocs%3Fid%3D2&amp;c=E,1', 'https://example.com/docs?id=2'],
		['https://linkprotect.cudasvc.com/url?a=https%253A%252F%252Fexample.com%252Fdocs&amp;c=E,1', 'https://example.com/docs'],
		['https://www.trendmicro.com/wis/clicktime/v1/query?url=https%3A%2F%2Fexample.com%2Fdocs&amp;umid=1', 'https://example.com/docs'],
		['https://protect2.fireeye.com/v1/url?k=1&amp;u=https%3A%2F%2Fexample.com%2Fdocs', 'https://example.com/docs'],
		[`https://protection.sophos.com/?d=example.com&amp;u=${sophosPayload}`, 'https://example.com/a+b'],
		['https://secure-web.cisco.com/abc/https%3A%2F%2Fexample.com%2Fdocs%3Futm_source%3Dnews', 'https://example.com/docs'],
		['https://url.avanan.click/v2/___https://example.com/docs___.YXZhbmFu', 'https://example.com/docs'],
		['https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fdocs&amp;h=AT', 'https://example.com/docs'],
		['https://www.linkedin.com/safety/go?url=https%3A%2F%2Fexample.com%2Fdocs&amp;urlhash=ab', 'https://example.com/docs'],
		['https://slack-redir.net/link?url=https%3A%2F%2Fexample.com%2Fdocs', 'https://example.com/docs'],
		['https://nam.safelinks.protection.office365.us/?url=https%3A%2F%2Fexample.com%2Fdocs&amp;data=05', 'https://example.com/docs'],
		['https://example.com/share?url=https%3A%2F%2Fother.example%2Fa', 'https://example.com/share?url=https%3A%2F%2Fother.example%2Fa']
	];
	const html = links.map(([href], index) => `<a href="${href}">${index}</a>`).join('');
	const { document } = render(html, { blockRemote: false });
	const hrefs = [...document.querySelectorAll('a')].map(anchor => anchor.getAttribute('href'));
	assert.deepEqual(hrefs, links.map(([, expected]) => expected));
});
