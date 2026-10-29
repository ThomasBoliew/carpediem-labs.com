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

	function sendPageView() {
		var payload = JSON.stringify({
			event: 'page_view',
			page: window.location.pathname,
			destination: '',
			referrer: referralHost(),
			utm_source: campaignValue('utm_source'),
			utm_medium: campaignValue('utm_medium'),
			utm_campaign: campaignValue('utm_campaign'),
			utm_content: campaignValue('utm_content')
		});

		if (navigator.sendBeacon) {
			navigator.sendBeacon(endpoint + '/collect', new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
			return;
		}

		fetch(endpoint + '/collect', {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
			body: payload,
			keepalive: true
		}).catch(function () {});
	}

	function preserveCampaignOnStoreLinks() {
		var campaign = new URLSearchParams(window.location.search);
		document.querySelectorAll('a[data-store]').forEach(function (link) {
			var target = new URL(link.href);
			['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (name) {
				var value = campaign.get(name);
				if (value) target.searchParams.set(name, value);
			});
			link.href = target.toString();
		});
	}

	preserveCampaignOnStoreLinks();
	sendPageView();
})();
