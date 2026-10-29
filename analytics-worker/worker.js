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

function campaignValue(url, name) {
	return clean(url.searchParams.get(name), name === 'utm_campaign' || name === 'utm_content' ? 100 : 80);
}

function campaignDetails(request) {
	const url = new URL(request.url);
	let referrerUrl = null;
	try {
		referrerUrl = new URL(request.headers.get('Referer') || '');
	} catch (_) {}

	function value(name) {
		return campaignValue(url, name) || (referrerUrl ? campaignValue(referrerUrl, name) : '');
	}

	return {
		referrer: referrerUrl ? clean(referrerUrl.hostname, 160) : '',
		utm_source: value('utm_source'),
		utm_medium: value('utm_medium'),
		utm_campaign: value('utm_campaign'),
		utm_content: value('utm_content')
	};
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

async function recordEvent(env, event) {
	await env.ANALYTICS_DB.prepare(`
		INSERT INTO events (event, page, destination, referrer, utm_source, utm_medium, utm_campaign, utm_content)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`).bind(
		event.event,
		event.page,
		event.destination,
		event.referrer,
		event.utm_source,
		event.utm_medium,
		event.utm_campaign,
		event.utm_content
	).run();
}

async function collect(request, env) {
	const body = await request.json().catch(() => null);
	if (!body || body.event !== 'page_view') return json({ error: 'Invalid event' }, 400, cors(env, request));

	const page = clean(body.page, 160);
	if (page !== '/TopFivePhotos.html') return json({ error: 'Invalid event details' }, 400, cors(env, request));

	await recordEvent(env, {
		event: 'page_view',
		page,
		destination: '',
		referrer: clean(body.referrer, 160),
		utm_source: clean(body.utm_source, 80),
		utm_medium: clean(body.utm_medium, 80),
		utm_campaign: clean(body.utm_campaign, 100),
		utm_content: clean(body.utm_content, 100)
	});

	return json({ ok: true }, 202, cors(env, request));
}

const STORE_URLS = {
	app_store: 'https://apps.apple.com/app/id6809026375',
	google_play: 'https://play.google.com/store/apps/details?id=com.carpediem.fotos'
};

function campaignTarget(details) {
	const target = new URL('https://carpediem-labs.com/TopFivePhotos.html');
	['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(name => {
		if (details[name]) target.searchParams.set(name, details[name]);
	});
	return target.toString();
}

async function landingRedirect(request, env) {
	const details = campaignDetails(request);
	await recordEvent(env, {
		event: 'page_view',
		page: '/go/landing',
		destination: '',
		...details
	});

	return new Response(null, {
		status: 302,
		headers: {
			'Location': campaignTarget(details),
			'Cache-Control': 'no-store'
		}
	});
}

async function storeRedirect(request, env, destination) {
	const details = campaignDetails(request);
	await recordEvent(env, {
		event: 'store_click',
		page: '/TopFivePhotos.html',
		destination,
		...details
	});

	return new Response(null, {
		status: 302,
		headers: {
			'Location': STORE_URLS[destination],
			'Cache-Control': 'no-store'
		}
	});
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
			SUM(CASE WHEN event = 'page_view' AND page = '/go/landing' THEN 1 ELSE 0 END) AS arrivals,
			SUM(CASE WHEN event = 'page_view' AND page = '/TopFivePhotos.html' THEN 1 ELSE 0 END) AS visits,
			SUM(CASE WHEN event = 'store_click' AND destination = 'app_store' THEN 1 ELSE 0 END) AS apple,
			SUM(CASE WHEN event = 'store_click' AND destination = 'google_play' THEN 1 ELSE 0 END) AS google
		FROM events
		WHERE created_at >= datetime('now', '-' || ? || ' days')
		GROUP BY date, source, campaign, creative
		ORDER BY date DESC, visits DESC
	`).bind(days).all();

	const rows = result.results || [];
	const totals = rows.reduce((sum, row) => ({
		arrivals: sum.arrivals + Number(row.arrivals),
		visits: sum.visits + Number(row.visits),
		apple: sum.apple + Number(row.apple),
		google: sum.google + Number(row.google)
	}), { arrivals: 0, visits: 0, apple: 0, google: 0 });
	totals.clickRate = totals.visits ? Math.round(((totals.apple + totals.google) / totals.visits) * 1000) / 10 : 0;
	return json({ rows, totals }, 200, cors(env, request));
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const path = url.pathname.startsWith('/cd-track/') ? url.pathname.slice('/cd-track'.length) : url.pathname;
		const headers = cors(env, request);
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
		if (request.headers.get('Origin') && !headers['Access-Control-Allow-Origin']) return json({ error: 'Origin not allowed' }, 403);

		if (path === '/collect' && request.method === 'POST') return collect(request, env);
		if (path === '/login' && request.method === 'POST') return login(request, env);
		if (path === '/report' && request.method === 'GET') return report(request, env);
		if (path === '/go/landing' && request.method === 'GET') return landingRedirect(request, env);
		if (path === '/go/app-store' && request.method === 'GET') return storeRedirect(request, env, 'app_store');
		if (path === '/go/google-play' && request.method === 'GET') return storeRedirect(request, env, 'google_play');
		if (path === '/health') return json({ ok: true }, 200, headers);
		return json({ error: 'Not found' }, 404, headers);
	}
};
