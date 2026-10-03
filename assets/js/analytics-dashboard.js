(function () {
	'use strict';

	var endpoint = document.currentScript.dataset.endpoint.replace(/\/$/, '');
	var token = sessionStorage.getItem('cdl-analytics-token') || '';
	var rows = [];

	var loginPanel = document.getElementById('login-panel');
	var dashboard = document.getElementById('dashboard');
	var loginForm = document.getElementById('login-form');
	var loginMessage = document.getElementById('login-message');
	var reportMessage = document.getElementById('report-message');

	function configured() {
		return endpoint && endpoint.indexOf('REPLACE_WITH_') === -1;
	}

	function showDashboard(show) {
		loginPanel.hidden = show;
		dashboard.hidden = !show;
	}

	function request(path, options) {
		options = options || {};
		options.headers = Object.assign({}, options.headers || {}, token ? { Authorization: 'Bearer ' + token } : {});
		return fetch(endpoint + path, options).then(function (response) {
			if (!response.ok) throw new Error(response.status === 401 ? 'Login expired or incorrect.' : 'Unable to load analytics.');
			return response.json();
		});
	}

	function render(data) {
		rows = data.rows || [];
		document.getElementById('visit-total').textContent = data.totals.visits;
		document.getElementById('apple-total').textContent = data.totals.apple;
		document.getElementById('google-total').textContent = data.totals.google;
		document.getElementById('click-rate').textContent = data.totals.clickRate + '%';

		var body = document.getElementById('report-body');
		body.textContent = '';
		rows.forEach(function (row) {
			var tr = document.createElement('tr');
			['date', 'source', 'campaign', 'creative', 'visits', 'apple', 'google'].forEach(function (key) {
				var td = document.createElement('td');
				td.textContent = row[key];
				tr.appendChild(td);
			});
			body.appendChild(tr);
		});
		reportMessage.textContent = rows.length ? '' : 'No activity has been recorded for this period.';
	}

	function loadReport() {
		reportMessage.textContent = 'Loading…';
		return request('/report?days=' + document.getElementById('days').value)
			.then(function (data) { render(data); })
			.catch(function (error) {
				reportMessage.textContent = error.message;
				if (error.message.indexOf('Login') !== -1) {
					token = '';
					sessionStorage.removeItem('cdl-analytics-token');
					showDashboard(false);
				}
			});
	}

	loginForm.addEventListener('submit', function (event) {
		event.preventDefault();
		if (!configured()) {
			loginMessage.textContent = 'The private analytics service has not been connected yet.';
			return;
		}
		loginMessage.textContent = 'Logging in…';
		request('/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password: document.getElementById('password').value })
		}).then(function (data) {
			token = data.token;
			sessionStorage.setItem('cdl-analytics-token', token);
			document.getElementById('password').value = '';
			loginMessage.textContent = '';
			showDashboard(true);
			loadReport();
		}).catch(function (error) {
			loginMessage.textContent = error.message;
		});
	});

	document.getElementById('refresh').addEventListener('click', loadReport);
	document.getElementById('days').addEventListener('change', loadReport);
	document.getElementById('logout').addEventListener('click', function () {
		token = '';
		sessionStorage.removeItem('cdl-analytics-token');
		showDashboard(false);
	});

	document.getElementById('download').addEventListener('click', function () {
		var headers = ['Date', 'Source', 'Campaign', 'Creative', 'Visits', 'App Store', 'Google Play'];
		var csvRows = [headers].concat(rows.map(function (row) {
			return [row.date, row.source, row.campaign, row.creative, row.visits, row.apple, row.google];
		}));
		var csv = csvRows.map(function (row) {
			return row.map(function (value) { return '"' + String(value).replace(/"/g, '""') + '"'; }).join(',');
		}).join('\n');
		var link = document.createElement('a');
		link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		link.download = 'carpediem-analytics.csv';
		link.click();
		URL.revokeObjectURL(link.href);
	});

	if (token && configured()) {
		showDashboard(true);
		loadReport();
	}
})();
