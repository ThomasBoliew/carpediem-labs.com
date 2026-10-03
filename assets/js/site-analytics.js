(function () {
	'use strict';

	var script = document.currentScript;
	var endpoint = script && script.dataset ? script.dataset.endpoint : '';

	if (!endpoint || endpoint.indexOf('REPLACE_WITH_') !== -1) return;

	endpoint = endpoint.replace(/\/$/, '');

	function campaignValue(name) {
		return new URLSearchParams(window.location.search).get(name) || '';
	}

	function referralHost() {
		if (!document.referrer) return '';
		try {
			return new URL(document.referrer).hostname;
		} catch (_) {
			return '';
		}
	}

	function send(eventName, destination) {
		var payload = JSON.stringify({
			event: eventName,
			page: window.location.pathname,
			destination: destination || '',
			referrer: referralHost(),
			utm_source: campaignValue('utm_source'),
			utm_medium: campaignValue('utm_medium'),
			utm_campaign: campaignValue('utm_campaign'),
			utm_content: campaignValue('utm_content')
		});

		if (navigator.sendBeacon) {
			navigator.sendBeacon(endpoint + '/collect', new Blob([payload], { type: 'application/json' }));
			return;
		}

		fetch(endpoint + '/collect', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: payload,
			keepalive: true
		}).catch(function () {});
	}

	var pageKey = 'cdl-page-view:' + window.location.pathname + window.location.search;
	if (!sessionStorage.getItem(pageKey)) {
		sessionStorage.setItem(pageKey, '1');
		send('page_view');
	}

	document.addEventListener('click', function (event) {
		var link = event.target.closest('a[data-store]');
		if (!link) return;
		send('store_click', link.dataset.store);
	});
})();
