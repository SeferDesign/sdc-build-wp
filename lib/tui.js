import React from 'react';
import { Box, Text, render as renderInk, useInput, useWindowSize, useBoxMetrics, usePaste } from 'ink';
import Spinner from 'ink-spinner';
import { styleText } from 'node:util';
import log from './logging.js';

const sgrMouseRegex = /(?:\x1b)?\[<(\d+);(\d+);(\d+)([mM])/g;
const headerColumnGap = 2;

export function TUIRoot({ tui }) {
	const { rows: terminalRows, columns: terminalColumns } = useWindowSize();
	const headerRef = React.useRef(null);
	const promptRef = React.useRef(null);
	const headerMetrics = useBoxMetrics(headerRef);
	const promptMetrics = useBoxMetrics(promptRef);
	const header = tui.getHeaderLayout();
	const isInitialLoading = tui.isInitialLoading();
	const availableLogRows = Math.max(0, Math.floor(terminalRows - headerMetrics.height - promptMetrics.height - 1));
	const visibleLogs = tui.getVisibleLogLines(availableLogRows);

	usePaste(text => tui.handlePaste(text));

	useInput((input, key) => {
		if (!tui.isInitialized) {
			return;
		}

		if (tui.isMouseEscapeSequence(input)) {
			if (tui.isMouseEnabled && !tui.hasPrompt()) {
				tui.handleMouseData(input);
			}
			return;
		}

		if (key.eventType === 'release') {
			return;
		}

		if (key.ctrl && input === 'c') {
			tui.dispatchCommand(input, key);
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
			return;
		}
		tui.dispatchCommand(input, key);
	});

	return React.createElement(
		Box,
		{ flexDirection: 'column', height: terminalRows, maxHeight: terminalRows, width: terminalColumns, maxWidth: terminalColumns, overflow: 'hidden' },
		React.createElement(
			Box,
			{
				ref: headerRef,
				borderStyle: 'round',
				borderColor: 'blue',
				paddingX: 1,
				flexDirection: 'column',
				flexShrink: 0,
				maxHeight: Math.max(0, terminalRows - promptMetrics.height - 1),
				overflow: 'hidden'
			},
			React.createElement(Text, { bold: true, color: 'blue' }, 'SDC Build WP'),
			header.titleLine || header.urlLine
				? React.createElement(
					Box,
					{
						flexDirection: 'row',
						flexWrap: 'wrap',
						columnGap: headerColumnGap
					},
					header.titleLine ? React.createElement(Text, { key: 'header-title' }, header.titleLine) : null,
					header.urlLine ? React.createElement(Text, { key: 'header-url' }, header.urlLine) : null
				)
				: null,
			header.detailLines.map((line, index) => React.createElement(Text, { key: `header-${index}` }, line)),
			isInitialLoading
				? React.createElement(
					Text,
					{ color: 'cyan' },
					React.createElement(Spinner, { type: 'dots' }),
					' Initial loading...'
				)
				: null
		),
		React.createElement(
			Box,
			{
				borderStyle: 'round',
				borderColor: 'blue',
				borderTop: false,
				paddingX: 1,
				flexDirection: 'column',
				flexGrow: 1,
				flexShrink: 1,
				minHeight: 0,
				overflow: 'hidden'
			},
			visibleLogs.map((line, index) => React.createElement(Text, { key: `log-${index}`, wrap: 'truncate-end' }, line))
		),
		React.createElement(
			Box,
			{ ref: promptRef, flexDirection: 'column', flexShrink: 0, maxHeight: terminalRows, overflow: 'hidden' },
			tui.hasPrompt() ? React.createElement(
				Box,
				{
					borderStyle: 'round',
					borderColor: 'cyan',
					paddingX: 1,
					marginTop: 1,
					flexDirection: 'column'
				},
				tui.getPromptRenderLines().map((line, index) => React.createElement(Text, { key: `prompt-${index}` }, line))
			) : null
		)
	);
}

export class TUI {
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
		this._isInitialLoading = false;
		this._renderScheduled = false;
		this.commandHandler = null;
	}

	init() {
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			return;
		}
		if (this.isInitialized) {
			this._isInitialLoading = true;
			this.render();
			return;
		}

		this._isInitialLoading = true;
		this.isInitialized = true;
		this.app = renderInk(React.createElement(TUIRoot, { tui: this }), {
			exitOnCtrlC: false,
			stdin: process.stdin,
			stdout: process.stdout,
			patchConsole: false,
			alternateScreen: true,
			incrementalRendering: true
		});

		this.setMouseCaptureEnabled(this.isMouseEnabled);

		this.render();
	}

	isInitialLoading() {
		return this._isInitialLoading;
	}

	finishInitialLoading() {
		if (!this._isInitialLoading) {
			return;
		}

		this._isInitialLoading = false;
		this.render();
	}

	isMouseEscapeSequence(input) {
		if (!input || typeof input !== 'string') {
			return false;
		}

		sgrMouseRegex.lastIndex = 0;
		return sgrMouseRegex.test(input);
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

	getHeaderLayout() {
		const detailLines = [];
		const statusMessages = [];

		let titleLine = '';
		if (this.components.length > 0) {
			titleLine = styleText('gray', 'Components: ') + styleText('cyan', this.components.join(', '));
		}

		let urlLine = '';
		if (this.urls.local || this.urls.external) {
			if (this.urls.local) {
				urlLine = `${styleText('gray', 'Local:')} ${styleText('green', this.urls.local)}`;
			}
			if (this.urls.external) {
				if (urlLine) {
					urlLine += '  ';
				}
				urlLine += `${styleText('gray', 'External:')} ${styleText('green', this.urls.external)}`;
			}
		}

		if (this.commands) {
			detailLines.push(this.commands);
		}

		if (this.isPaused) {
			statusMessages.push(styleText(['bold', 'yellow'], 'PAUSED'));
		}

		if (!this.isMouseEnabled) {
			statusMessages.push(styleText(['bold', 'yellow'], 'TEXT SELECT') + styleText('yellow', ' - Press [ENTER] to enable scroll.'));
		}

		if (statusMessages.length > 0) {
			detailLines.push(statusMessages.join(styleText('gray', ' | ')));
		}

		return {
			titleLine,
			urlLine,
			detailLines
		};
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
		if (maxRows <= 0) {
			return [];
		}
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
		if (!this.isInitialized || !this.app) {
			return;
		}
		if (this._renderScheduled) {
			return;
		}
		this._renderScheduled = true;
		setImmediate(() => {
			this._renderScheduled = false;
			if (this.isInitialized && this.app) {
				this.app.rerender(React.createElement(TUIRoot, { tui: this }));
			}
		});
	}

	dispatchCommand(input, key) {
		if (this.commandHandler) {
			Promise.resolve().then(() => this.commandHandler(input, key)).catch(error => {
				log('error', `Failed to handle watch command: ${error.message}`);
			});
		}
	}

	handlePaste(text) {
		if (this._activePrompt?.type !== 'input') {
			return;
		}
		this._activePrompt.value += text.replace(/\r\n|[\r\n\t]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
		this.render();
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
				styleText('gray', 'Type your value, Enter to submit, Esc to cancel.')
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
			if (key.escape) {
				const resolve = this._activePrompt.resolve;
				this._activePrompt = null;
				this.render();
				resolve(null);
				return;
			}
			if (key.backspace || key.delete) {
				this._activePrompt.value = Array.from(this._activePrompt.value).slice(0, -1).join('');
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

	async destroy() {
		if (!this.isInitialized) {
			return;
		}

		const app = this.app;
		this.app = null;
		this.isInitialized = false;

		this.setMouseCaptureEnabled(false);

		this.isMouseEnabled = true;
		this._activePrompt?.resolve(null);
		this._activePrompt = null;
		this._logScrollOffset = 0;
		this._isInitialLoading = false;

		if (app) {
			app.unmount();
			await app.waitUntilExit();
			app.cleanup();
		}

		if (process.stdout.isTTY) {
			process.stdout.write('\x1b[?25h');
			process.stdout.write('\x1b[0m');
		}
	}
}

const tui = new TUI();
export default tui;
