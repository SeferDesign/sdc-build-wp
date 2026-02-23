let randomSessionID = Array.from({ length: 50 }, () => Math.random().toString(36)[2]).join('');

let socket = window.___browserSync___?.socket;

let checkedForPort = false;

function redirectAdminFromPort() {
	checkedForPort = true;
	if (!window.location.port) { return; }
	const url = new URL(window.location.href);
	const isAdmin = /^\/wp-admin(?:\/|$)/.test(url.pathname);
	const urlParams = new URLSearchParams(url.search);
	if (!isAdmin || urlParams.has('keepPort')) {
		return;
	}
	url.port = '';
	socket.emit('sdc:redirectAdminFromPort', {
		timestamp: Date.now(),
		port: window.location.port,
		from: window.location.href,
		to: url.toString()
	});
	window.location.replace(url.toString());
}

function getScriptsOnPage() {
	socket.emit('sdc:scriptsOnPage', {
		timestamp: Date.now(),
		sessionID: randomSessionID,
		data: Array.from(document.querySelectorAll('script') || []).map((script) => script.src || false).filter(script => script && script.length > 0)
	});
}


const scriptsOnPageInterval = setInterval(() => {
	socket = window.___browserSync___?.socket;
	if (socket) {
		if (!checkedForPort) { redirectAdminFromPort(); }
		getScriptsOnPage();
		clearInterval(scriptsOnPageInterval);
	}
}, 500);
