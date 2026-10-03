const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
	});
}

function cors(env, request) {
	const origin = request.headers.get('Origin') || '';
	return origin === env.ALLOWED_ORIGIN ? {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Headers': 'Authorization, Content-Type',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Vary': 'Origin'
	} : {};
}

function clean(value, maxLength) {
	return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function base64Url(bytes) {
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value) {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
	return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function signature(value, secret) {
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function makeToken(secret) {
	const payload = base64Url(encoder.encode(JSON.stringify({ exp: Date.now() + (8 * 60 * 60 * 1000) })));
	return payload + '.' + await signature(payload, secret);
}

async function validToken(request, secret) {
	const auth = request.headers.get('Authorization') || '';
	const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
	const parts = token.split('.');
	if (parts.length !== 2 || parts[1] !== await signature(parts[0], secret)) return false;
	try {
		const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
		return payload.exp > Date.now();
	} catch (_) {
		return false;
	}
}

function safeEqual(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
	let different = 0;
	for (let i = 0; i < a.length; i += 1) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return different === 0;
}

async function collect(request, env) {
	const body = await request.json().catch(() => null);
	if (!body || !['page_view', 'store_click'].includes(body.event)) return json({ error: 'Invalid event' }, 400, cors(env, request));

	const page = clean(body.page, 160);
	const destination = clean(body.destination, 32);
	if (page !== '/TopFivePhotos.html' || (body.event === 'store_click' && !['app_store', 'google_play'].includes(destination))) {
		return json({ error: 'Invalid event details' }, 400, cors(env, request));
	}

	await env.ANALYTICS_DB.prepare(`
		INSERT INTO events (event, page, destination, referrer, utm_source, utm_medium, utm_campaign, utm_content)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`).bind(
		body.event,
		page,
		destination,
		clean(body.referrer, 160),
		clean(body.utm_source, 80),
		clean(body.utm_medium, 80),
		clean(body.utm_campaign, 100),
		clean(body.utm_content, 100)
	).run();

	return json({ ok: true }, 202, cors(env, request));
}

async function login(request, env) {
	const body = await request.json().catch(() => null);
	if (!body || !safeEqual(body.password, env.ADMIN_PASSWORD)) return json({ error: 'Incorrect password' }, 401, cors(env, request));
	return json({ token: await makeToken(env.SESSION_SECRET) }, 200, cors(env, request));
}

async function report(request, env) {
	if (!await validToken(request, env.SESSION_SECRET)) return json({ error: 'Unauthorized' }, 401, cors(env, request));
	const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30));
	const result = await env.ANALYTICS_DB.prepare(`
		SELECT
			date(created_at) AS date,
			COALESCE(NULLIF(utm_source, ''), COALESCE(NULLIF(referrer, ''), 'direct')) AS source,
			COALESCE(NULLIF(utm_campaign, ''), '—') AS campaign,
			COALESCE(NULLIF(utm_content, ''), '—') AS creative,
			SUM(CASE WHEN event = 'page_view' THEN 1 ELSE 0 END) AS visits,
			SUM(CASE WHEN event = 'store_click' AND destination = 'app_store' THEN 1 ELSE 0 END) AS apple,
			SUM(CASE WHEN event = 'store_click' AND destination = 'google_play' THEN 1 ELSE 0 END) AS google
		FROM events
		WHERE created_at >= datetime('now', '-' || ? || ' days')
		GROUP BY date, source, campaign, creative
		ORDER BY date DESC, visits DESC
	`).bind(days).all();

	const rows = result.results || [];
	const totals = rows.reduce((sum, row) => ({
		visits: sum.visits + Number(row.visits),
		apple: sum.apple + Number(row.apple),
		google: sum.google + Number(row.google)
	}), { visits: 0, apple: 0, google: 0 });
	totals.clickRate = totals.visits ? Math.round(((totals.apple + totals.google) / totals.visits) * 1000) / 10 : 0;
	return json({ rows, totals }, 200, cors(env, request));
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const headers = cors(env, request);
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
		if (request.headers.get('Origin') && !headers['Access-Control-Allow-Origin']) return json({ error: 'Origin not allowed' }, 403);

		if (url.pathname === '/collect' && request.method === 'POST') return collect(request, env);
		if (url.pathname === '/login' && request.method === 'POST') return login(request, env);
		if (url.pathname === '/report' && request.method === 'GET') return report(request, env);
		if (url.pathname === '/health') return json({ ok: true }, 200, headers);
		return json({ error: 'Not found' }, 404, headers);
	}
};
