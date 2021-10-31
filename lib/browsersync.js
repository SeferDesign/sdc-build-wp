const project = require('./project.js');
const browserSync = require('browser-sync').create();

const buildBrowserSync = () => {
	browserSync.init({
		port: project.package.sdc?.port || 3000,
		proxy: project.package.sdc?.browsersync?.localProxyURL,
		files: [
			project.path + '/dist/**/*',
			project.path + '/**/*.php'
		],
		open: project.package.sdc?.open || false,
		https: (process.env.SSL_KEY_PATH && process.env.SSL_CRT_PATH ? {
			key: process.env.SSL_KEY_PATH,
			cert: process.env.SSL_CRT_PATH
		} : false)
	});
};

module.exports = buildBrowserSync;
