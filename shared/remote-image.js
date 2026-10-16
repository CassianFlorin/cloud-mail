// 远程图片由服务器代取，浏览器不再把读者的网络地址发给发件人。
// 只允许公网 http(s) 图片地址，避免这道接口被用来访问内网。

export function isSafeRemoteImageUrl(value) {
	let url;
	try {
		url = new URL(String(value || '').trim());
	} catch {
		return false;
	}
	if (url.username || url.password) return false;
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
		return false;
	}
	if (!host.includes('.') && !host.includes(':')) return false;
	if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
	return !isPrivateAddress(host);
}

function isPrivateAddress(host) {
	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) {
		const raw = ipv4.slice(1);
		// 前导零会被部分客户端当成八进制，例如 0177.0.0.1。
		if (raw.some(part => part.length > 1 && part.startsWith('0'))) return true;
		const parts = raw.map(part => Number(part));
		if (parts.some(part => part > 255)) return true;
		const [a, b, c] = parts;
		if (a === 0 || a === 10 || a === 127) return true;
		if (a === 169 && b === 254) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true;
		if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
		if (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100))) return true;
		if (a === 203 && b === 0 && c === 113) return true;
		if (a >= 224) return true;
		return false;
	}
	if (!host.includes(':')) return false;
	if (host === '::1' || host === '::') return true;
	if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
	const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
	return mapped ? isPrivateAddress(mapped[1]) : false;
}
