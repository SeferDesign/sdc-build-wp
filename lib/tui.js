import React from 'react';
import { Box, Text, render as renderInk, useInput, useStdout } from 'ink';
import { styleText } from 'node:util';
import log from './logging.js';

const sgrMouseRegex = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;

function TUIRoot({ tui }) {
	const { stdout } = useStdout();
	const terminalRows = stdout?.rows || 24;
	const headerLines = tui.getHeaderLines();
	const promptLines = tui.getPromptRenderLines();
	const availableLogRows = Math.max(3, terminalRows - headerLines.length - promptLines.length - 6);
	const visibleLogs = tui.getVisibleLogLines(availableLogRows);

	useInput((input, key) => {
		if (!tui.isInitialized) {
			return;
		}

		if (tui.isMouseEscapeSequence(input)) {
			return;
		}

		if (tui.hasPrompt()) {
			tui.handlePromptInput(input, key);
			return;
		}

		if (key.upArrow) {
			tui.scrollLogs(1);
			return;
		}

		if (key.downArrow) {
			tui.scrollLogs(-1);
			return;
		}

		if (key.pageUp) {
			tui.scrollLogs(availableLogRows);
			return;
		}

		if (key.pageDown) {
			tui.scrollLogs(-availableLogRows);
		}
	});

	return React.createElement(
		Box,
		{ flexDirection: 'column' },
		React.createElement(
			Box,
			{
				borderStyle: 'round',
				borderColor: 'blue',
				paddingX: 1,
				flexDirection: 'column'
			},
			headerLines.map((line, index) => React.createElement(Text, { key: `header-${index}` }, line))
		),
		React.createElement(
			Box,
			{
				borderStyle: 'single',
				borderColor: 'blue',
				paddingX: 1,
				flexDirection: 'column',
				height: availableLogRows + 2
			},
			visibleLogs.map((line, index) => React.createElement(Text, { key: `log-${index}` }, line))
		),
		tui.hasPrompt()
			? React.createElement(
				Box,
				{
					borderStyle: 'round',
					borderColor: 'cyan',
					paddingX: 1,
					marginTop: 1,
					flexDirection: 'column'
				},
				tui.getPromptRenderLines().map((line, index) => React.createElement(Text, { key: `prompt-${index}` }, line))
			)
			: null
	);
}

class TUI {
	constructor() {
		this.app = null;
		this.isInitialized = false;
		this.urls = {
			local: '',
			external: ''
		};
		this.commands = '';
		this.components = [];
		this.watchMode = false;
		this.isPaused = false;
		this.isMouseEnabled = true;
		this._logHistory = [];
		this._logScrollOffset = 0;
		this._activePrompt = null;
		this._mouseDataHandler = null;
	}

	init() {
		if (this.isInitialized) {
			this.render();
			return;
		}

		this.isInitialized = true;
		this.app = renderInk(React.createElement(TUIRoot, { tui: this }), {
			exitOnCtrlC: false,
			stdin: process.stdin,
			stdout: process.stdout,
			patchConsole: false
		});

		this.setMouseCaptureEnabled(this.isMouseEnabled);
		this.attachMouseHandler();

		this.render();
	}

	isMouseEscapeSequence(input) {
		if (!input || typeof input !== 'string') {
			return false;
		}

		sgrMouseRegex.lastIndex = 0;
		return sgrMouseRegex.test(input);
	}

	attachMouseHandler() {
		if (!process.stdin?.isTTY || this._mouseDataHandler) {
			return;
		}

		this._mouseDataHandler = (chunk) => {
			if (!this.isInitialized || !this.isMouseEnabled || this.hasPrompt()) {
				return;
			}

			const data = String(chunk);
			this.handleMouseData(data);
		};

		process.stdin.on('data', this._mouseDataHandler);
	}

	handleMouseData(data) {
		sgrMouseRegex.lastIndex = 0;

		let match;
		while ((match = sgrMouseRegex.exec(data)) !== null) {
			const code = Number(match[1]);
			const action = match[4];

			if ((code & 64) === 64) {
				const isScrollDown = (code & 1) === 1;
				this.scrollLogs(isScrollDown ? -3 : 3);
				continue;
			}

			const isButtonPress = action === 'M';
			const isDragEvent = (code & 32) === 32;

			if (isButtonPress && !isDragEvent) {
				this.disableMouseCapture();
				break;
			}
		}
	}

	setMouseCaptureEnabled(isEnabled) {
		if (!process.stdout?.isTTY) {
			return;
		}

		if (isEnabled) {
			process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
			return;
		}

		process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
	}

	getHeaderLines() {
		const lines = [];

		let titleLine = ' ' + styleText(['bold', 'blue'], 'SDC Build WP');
		if (this.isPaused) {
			titleLine += styleText(['bold', 'yellow'], ' [PAUSED]');
		}
		if (!this.isMouseEnabled) {
			titleLine += styleText(['bold', 'yellow'], ' [TEXT SELECT - Press Enter to Exit]');
		}
		if (this.components.length > 0) {
			titleLine += styleText('gray', ' [') + styleText('cyan', this.components.join(', ')) + styleText('gray', ']');
		}
		lines.push(titleLine);

		if (this.urls.local || this.urls.external) {
			let urlLine = ' ';
			if (this.urls.local) {
				urlLine += `Local: ${styleText('green', this.urls.local)}`;
			}
			if (this.urls.external) {
				if (urlLine.length > 1) {
					urlLine += '  ';
				}
				urlLine += `External: ${styleText('green', this.urls.external)}`;
			}
			lines.push(urlLine);
		} else {
			lines.push(' ');
		}

		if (this.commands) {
			lines.push(' ' + this.commands);
		} else {
			lines.push(' ');
		}

		if (!this.isMouseEnabled) {
			lines.push(' ' + styleText('yellow', 'Text select on. Press Enter to enable mouse.'));
		} else {
			lines.push(' ');
		}

		return lines;
	}

	setURLs(local, external) {
		this.urls.local = local;
		this.urls.external = external;
		this.render();
	}

	setCommands(commands) {
		this.commands = commands;
		this.render();
	}

	setPaused(isPaused) {
		this.isPaused = isPaused;
		this.render();
	}

	setComponents(components, watchMode = false) {
		this.components = components;
		this.watchMode = watchMode;
		this.render();
	}

	log(message) {
		this._logHistory.push(message);
		if (!this.isInitialized) {
			log(null, message);
			return;
		}

		if (this._logScrollOffset === 0) {
			this._logScrollOffset = 0;
		}
		this.render();
	}

	getLogHistory() {
		return this._logHistory.join('\n');
	}

	getVisibleLogLines(maxRows) {
		if (this._logHistory.length === 0) {
			return [''];
		}

		const maxOffset = Math.max(0, this._logHistory.length - maxRows);
		this._logScrollOffset = Math.max(0, Math.min(this._logScrollOffset, maxOffset));

		const endIndex = this._logHistory.length - this._logScrollOffset;
		const startIndex = Math.max(0, endIndex - maxRows);
		return this._logHistory.slice(startIndex, endIndex);
	}

	scrollLogs(delta) {
		const nextOffset = this._logScrollOffset + delta;
		const maxOffset = Math.max(0, this._logHistory.length - 1);
		this._logScrollOffset = Math.max(0, Math.min(nextOffset, maxOffset));
		this.render();
	}

	render() {
		if (this.isInitialized && this.app) {
			this.app.rerender(React.createElement(TUIRoot, { tui: this }));
		}
	}

	hasPrompt() {
		return Boolean(this._activePrompt);
	}

	getPromptRenderLines() {
		if (!this._activePrompt) {
			return [];
		}

		if (this._activePrompt.type === 'menu') {
			const promptLines = [this._activePrompt.prompt];
			for (let i = 0; i < this._activePrompt.options.length; i++) {
				const isSelected = i === this._activePrompt.selectedIndex;
				const prefix = isSelected ? styleText(['bold', 'green'], '>') : ' ';
				promptLines.push(`${prefix} ${this._activePrompt.options[i]}`);
			}
			promptLines.push(styleText('gray', 'Use arrows to choose. Enter to confirm. Esc/q to cancel.'));
			return promptLines;
		}

		if (this._activePrompt.type === 'input') {
			const cursor = styleText(['bold', 'cyan'], '_');
			return [
				this._activePrompt.prompt,
				`${styleText('gray', '>')} ${this._activePrompt.value}${cursor}`,
				styleText('gray', 'Type your value, Enter to submit, Esc/q to cancel.')
			];
		}

		return [];
	}

	handlePromptInput(input, key) {
		if (!this._activePrompt) {
			return;
		}

		if (this._activePrompt.type === 'menu') {
			if (key.upArrow) {
				this._activePrompt.selectedIndex = (this._activePrompt.selectedIndex - 1 + this._activePrompt.options.length) % this._activePrompt.options.length;
				this.render();
				return;
			}
			if (key.downArrow) {
				this._activePrompt.selectedIndex = (this._activePrompt.selectedIndex + 1) % this._activePrompt.options.length;
				this.render();
				return;
			}
			if (key.return) {
				const selectedIndex = this._activePrompt.selectedIndex;
				const selectedValue = this._activePrompt.options[selectedIndex];
				const resolve = this._activePrompt.resolve;
				this._activePrompt = null;
				this.render();
				resolve({ value: selectedValue, index: selectedIndex });
				return;
			}
			if (key.escape || input === 'q') {
				const resolve = this._activePrompt.resolve;
				this._activePrompt = null;
				this.render();
				resolve(null);
			}
			return;
		}

		if (this._activePrompt.type === 'input') {
			if (key.return) {
				const resolve = this._activePrompt.resolve;
				const value = this._activePrompt.value;
				this._activePrompt = null;
				this.render();
				resolve(value);
				return;
			}
			if (key.escape || input === 'q') {
				const resolve = this._activePrompt.resolve;
				this._activePrompt = null;
				this.render();
				resolve(null);
				return;
			}
			if (key.backspace || key.delete) {
				this._activePrompt.value = this._activePrompt.value.slice(0, -1);
				this.render();
				return;
			}
			if (!key.ctrl && !key.meta && input) {
				this._activePrompt.value += input;
				this.render();
			}
		}
	}

	async showMenu(options, prompt = 'Choose an option:') {
		if (!this.isInitialized) {
			return null;
		}

		return new Promise((resolve) => {
			this._activePrompt = {
				type: 'menu',
				options,
				prompt,
				selectedIndex: 0,
				resolve
			};
			this.render();
		});
	}

	async showInput(prompt = 'Enter value:') {
		if (!this.isInitialized) {
			return null;
		}

		return new Promise((resolve) => {
			this._activePrompt = {
				type: 'input',
				prompt,
				value: '',
				resolve
			};
			this.render();
		});
	}

	getState() {
		return {
			urls: { ...this.urls },
			commands: this.commands,
			components: [...this.components],
			watchMode: this.watchMode,
			isPaused: this.isPaused,
			isMouseEnabled: this.isMouseEnabled
		};
	}

	setState(state) {
		if (state) {
			this.urls = { ...state.urls };
			this.commands = state.commands;
			this.components = [...state.components];
			this.watchMode = state.watchMode;
			this.isPaused = state.isPaused;
			this.isMouseEnabled = state.isMouseEnabled ?? true;
			this.render();
		}
	}

	enableMouseCapture() {
		if (this.isMouseEnabled) {
			return;
		}
		this.isMouseEnabled = true;
		this.setMouseCaptureEnabled(true);
		this.render();
	}

	disableMouseCapture() {
		if (!this.isMouseEnabled) {
			return;
		}
		this.isMouseEnabled = false;
		this.setMouseCaptureEnabled(false);
		this.render();
	}

	destroy() {
		if (!this.isInitialized) {
			return;
		}

		if (this.app) {
			this.app.unmount();
			this.app = null;
		}

		if (this._mouseDataHandler && process.stdin) {
			process.stdin.off('data', this._mouseDataHandler);
			this._mouseDataHandler = null;
		}

		this.setMouseCaptureEnabled(false);

		this.isInitialized = false;
		this.isMouseEnabled = true;
		this._activePrompt = null;
		this._logScrollOffset = 0;

		if (process.stdout.isTTY) {
			process.stdout.write('\x1b[?25h');
			process.stdout.write('\x1b[0m');
		}
	}
}

const tui = new TUI();
export default tui;
