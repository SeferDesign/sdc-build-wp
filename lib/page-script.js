let randomSessionID = Array.from({ length: 50 }, () => Math.random().toString(36)[2]).join('');

let socket = window.___browserSync___?.socket;

let checkedForPort = false;

function redirectAdminFromPort() {
	if (!checkedForPort && window.location.port) {
		const url = new URL(window.location.href);
		const urlParams = new URLSearchParams(window.location.search);
		if (urlParams.has('keepPort')) {
			checkedForPort = true;
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
	checkedForPort = true;
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
		redirectAdminFromPort();
		getScriptsOnPage();
		clearInterval(scriptsOnPageInterval);
	}
}, 500);
