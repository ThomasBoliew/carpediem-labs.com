# Carpe Diem Labs website analytics

This Cloudflare Worker stores anonymous page-view and store-click events in D1. It does not store IP addresses, user agents, cookies, names, email addresses, or device fingerprints.

## Deployment checklist

1. Create a Cloudflare account and install or run Wrangler.
2. Create a D1 database named `carpediem-site-analytics`.
3. Copy `wrangler.toml.example` to `wrangler.toml` and add the D1 database ID.
4. Apply `schema.sql` to the production database.
5. Set `ADMIN_PASSWORD` and `SESSION_SECRET` with `wrangler secret put`.
6. Deploy the Worker.
7. Replace `REPLACE_WITH_ANALYTICS_WORKER_URL` in `SiteAnalytics.html` and the tracking script tag in `TopFivePhotos.html` with the deployed HTTPS Worker URL.

The dashboard is intentionally absent from site navigation. Its address is still not a security boundary; the Worker password protects the report data.

## Production

- Worker: `https://carpediem-site-analytics.carpediemlabs.workers.dev`
- Dashboard: `https://carpediem-labs.com/SiteAnalytics.html`
- Database: `carpediem-site-analytics`
