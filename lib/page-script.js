let randomSessionID = Array.from({ length: 50 }, () => Math.random().toString(36)[2]).join('');

let socket = window.___browserSync___?.socket;

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
		getScriptsOnPage();
		clearInterval(scriptsOnPageInterval);
	}
}, 500);
