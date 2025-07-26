import BaseComponent from './base.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { create } from 'browser-sync';

export default class ServerComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Run a dev proxy server for live reloading`;
		this.sessions = {};
		this.server = create('SDC WP Build Server');
		this.watchedFiles = [
			`${this.project.paths.dist}/**/*`,
			`**/*.html`,
			`**/*.json`
		];
		if (!this.project.shouldPHPLint) {
			this.watchedFiles.push(`**/*.php`);
		}
		this.ignoredFiles = [
			`node_modules/**`,
			`vendor/**/*`,
			`**/*.map`
		];
	}

	async init() {
		this.project.pageScript = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../page-script.js'), 'utf8');
	}

	serve(watch = false) {

		let thisProject = this.project;
		let bsOptions = {
			logPrefix: '',
			logFileChanges: false,
			port: this.project.package.sdc?.port || 3000,
			proxy: this.project.package.sdc?.browsersync?.localProxyURL,
			files: watch ? this.watchedFiles : [],
			watchOptions: {
				cwd: this.project.path,
				ignored: this.ignoredFiles,
				ignoreInitial: true
			},
			reloadDelay: 250,
			reloadDebounce: 1000,
			reloadOnRestart: true,
			watchEvents: this.project.package.sdc?.browsersync?.watchEvents || ['add', 'change', 'unlink', 'addDir', 'unlinkDir'],
			open: this.project.package.sdc?.open || false,
			https: (process.env.SSL_KEY_PATH && process.env.SSL_CRT_PATH ? {
				key: process.env.SSL_KEY_PATH,
				cert: process.env.SSL_CRT_PATH
			} : false),
			ui: false,
			tunnel: this.project.package.sdc?.browsersync?.tunnel,
			notify: {
				styles: {
					pointerEvents: 'none',
					userSelect: 'none',
					opacity: '0.5',
					top: 'auto',
					bottom: '0',
					borderRadius: '5px 0px 0px'
				}
			},
			snippetOptions: {
				rule: {
					match: thisProject.package.sdc?.browsersync?.location == 'end' ? /<\/body>/ : /<body[^>]*>/,
					fn: function (snippet, match) {
						const customScript = `<script async>${thisProject.pageScript}</script>`;
						const allScripts = snippet + customScript;
						return thisProject.package.sdc?.browsersync?.location == 'end' ? allScripts + match : match + allScripts;
					}
				}
			}
    };

		this.server.init(bsOptions, (err, bs) => {
			if (err) {
				this.log('error', `Failed to start BrowserSync server: ${err.message}`);
				this.log('warn', 'Continuing without live reload server');
				return;
			}
			try {
				this.setupSocketHandlers(this);
			} catch (setupError) {
				this.log('error', `Failed to setup socket handlers: ${setupError.message}`);
			}
		});
	}

	setupSocketHandlers(serverComponent) {
		this.server.sockets.on('connection', (socket) => {
			socket.on('sdc:scriptsOnPage', (data) => {
				if (!serverComponent.sessions[data.sessionID]) {
					serverComponent.sessions[data.sessionID] = {
						scripts: []
					};
				}
				serverComponent.sessions[data.sessionID].scripts = data.data;
			});
		});
	}

	async watch() {
		try {
			this.server.watch(this.watchedFiles, {
				ignored: this.ignoredFiles,
				ignoreInitial: true
			}, (event, file) => {
				if (!this.project.isRunning) { return; }
				try {
					if (['add', 'addDir', 'change'].includes(event)) {
						this.server.reload(file);
						if (file.split('.').pop() == 'css') {
							this.server.notify('Style updated', 500);
							return;
						}
					} else if (['unlink', 'unlinkDir'].includes(event)) {
						this.server.reload();
					}
					this.server.notify('Reloading...', 10000);
				} catch (reloadError) {
					this.log('warn', `Failed to reload ${file}: ${reloadError.message}`);
				}
			});
		} catch (watchError) {
			this.log('error', `Failed to start file watcher: ${watchError.message}`);
			throw watchError;
		}
	}

}
