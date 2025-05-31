import BaseComponent from './base.js';
import { create as bsCreate } from 'browser-sync';

export default class ServerComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Run a dev proxy server for live reloading`;
		this.server = bsCreate();
		this.watchedFiles = [
			`${this.project.path}/${this.project.paths.dist}/**/*`,
			`!**/*.map`,
			`${this.project.path}/**/*.html`,
			`${this.project.path}/**/*.json`,
		];
		if (!this.project.shouldPHPLint) {
			this.watchedFiles.push(`${this.project.path}/**/*.php`);
		}
	}

	async init() {
		//
	}

	serve(watch = false) {
		let bsOptions = {
			logPrefix: '',
			port: this.project.package.sdc?.port || 3000,
			proxy: this.project.package.sdc?.browsersync?.localProxyURL,
			files: watch ? this.watchedFiles : [],
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
			}
		};
		if (this.project.package.sdc?.browsersync?.location == 'end') {
			bsOptions.snippetOptions = {
				rule: {
					match: /<\/body>/i,
					fn: function (snippet, match) {
						return snippet + match;
					}
				}
			};
		}
		this.server.init(bsOptions);
	}

	async watch() {
		this.server.watch(this.watchedFiles, (event, file) => {
			if (event === 'change' || event === 'add') {
				this.server.reload(file);
			} else if (event === 'unlink') {
				this.server.reload();
			}
		});
	}

}
