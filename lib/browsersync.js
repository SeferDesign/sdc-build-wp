import project from '../lib/project.js';
import { create as bsCreate } from 'browser-sync';
const browserSync = bsCreate();

const buildBrowserSync = () => {
	browserSync.init({
		logPrefix: '',
		port: project.package.sdc?.port || 3000,
		proxy: project.package.sdc?.browsersync?.localProxyURL,
		files: [
			project.path + '/dist/**/*',
			project.path + '/**/*.php',
			project.path + '/**/*.html',
			project.path + '/**/*.json',
		],
		watchEvents: project.package.sdc?.browsersync?.watchEvents || ['add', 'change', 'unlink', 'addDir', 'unlinkDir'],
		open: project.package.sdc?.open || false,
		https: (process.env.SSL_KEY_PATH && process.env.SSL_CRT_PATH ? {
			key: process.env.SSL_KEY_PATH,
			cert: process.env.SSL_CRT_PATH
		} : false),
		ui: false,
		tunnel: project.package.sdc?.browsersync?.tunnel,
		notify: {
			styles: {
				top: 'auto',
				bottom: '0',
				borderRadius: '5px 0px 0px'
			}
		},
		snippetOptions: {
			rule: {
				match: /<\/body>/i,
				fn: function (snippet, match) {
					return snippet + match;
				}
			}
		}
	});
};

export default buildBrowserSync;
