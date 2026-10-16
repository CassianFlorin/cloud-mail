// HTML、SVG 这类附件用浏览器打开就会执行里面的脚本。下载前要先认出来。

export function isActiveFile(contentType, name) {
	const type = String(contentType || '').toLowerCase();
	const file = String(name || '').split('?')[0].toLowerCase();
	return /text\/html|image\/svg|application\/xhtml|\+xml|text\/xml|application\/xml/.test(type)
		|| /\.(?:html?|svg|xhtml|xml|xht)$/.test(file);
}
