// 远程图片走已登录的接口，由服务器去取。浏览器只收到本地 blob。
export async function fetchRemoteImage(url) {
	const base = (import.meta.env.VITE_BASE_URL || '/api').replace(/\/$/, '');
	const response = await fetch(`${base}/remote-image`, {
		method: 'POST',
		headers: {
			Authorization: localStorage.getItem('token') || '',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ url }),
		cache: 'no-store'
	});
	if (!response.ok) throw new Error('Remote image was not loaded');
	const type = (response.headers.get('content-type') || '').toLowerCase();
	if (!type.startsWith('image/') || type.includes('svg')) throw new Error('Remote image was not loaded');
	return response.blob();
}
