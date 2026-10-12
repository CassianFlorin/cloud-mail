import objectAccessService from '../service/object-access-service';
import app from '../hono/hono';

app.get('/oss/*', async (c) => {
	let key;
	try {
		key = decodeURIComponent(c.req.path.split('/oss/')[1]);
	} catch {
		return new Response(null, { status: 400 });
	}
	return objectAccessService.attachment(c, key);
});


