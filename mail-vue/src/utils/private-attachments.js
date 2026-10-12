// Binary responses bypass the JSON-only Axios interceptor. The session stays
// in a request header rather than becoming part of a shareable attachment URL.
export async function fetchAttachmentBlob(key) {
    if (!key.startsWith('attachments/')) throw new Error('Invalid attachment key');
    const base = (import.meta.env.VITE_BASE_URL || '/api').replace(/\/$/, '');
    const path = key.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${base}/oss/${path}`, {
        headers: { Authorization: localStorage.getItem('token') || '' },
        cache: 'no-store'
    });
    if (!response.ok) throw new Error('Unable to access attachment');
    return response.blob();
}
