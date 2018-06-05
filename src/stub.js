(function() {

	// Add locator frame
	function addLocatorFrame() {
		if (!window.frames['__cmpLocator']) {
			if (document.body) {
				const frame = document.createElement('iframe');
				frame.style.display = 'none';
				frame.name = '__cmpLocator';
				document.body.appendChild(frame);
			}
			else {
				setTimeout(addLocatorFrame, 5);
			}
		}
	}

	addLocatorFrame();

	// Add stub
	const commandQueue = [];
	const cmp = function (command, parameter, callback) {
		commandQueue.push({
			command,
			parameter,
			callback
		});
	};
	cmp.commandQueue = commandQueue;
	cmp.receiveMessage = function (event) {
		const data = event && event.data && event.data.__cmpCall;
		if (data) {
			const {callId, command, parameter} = data;
			commandQueue.push({
				callId,
				command,
				parameter,
				event
			});
		}
	};

	cmp.isRelevantCmp = true;

	window.__cmp = cmp;

	// Listen for postMessage events
	const listen = window.attachEvent || window.addEventListener;
	listen('message', event => {
		window.__cmp.receiveMessage(event);
	}, false);

})();
