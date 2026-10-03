CREATE TABLE IF NOT EXISTS events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	event TEXT NOT NULL CHECK (event IN ('page_view', 'store_click')),
	page TEXT NOT NULL,
	destination TEXT NOT NULL DEFAULT '',
	referrer TEXT NOT NULL DEFAULT '',
	utm_source TEXT NOT NULL DEFAULT '',
	utm_medium TEXT NOT NULL DEFAULT '',
	utm_campaign TEXT NOT NULL DEFAULT '',
	utm_content TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(utm_campaign, utm_content);
