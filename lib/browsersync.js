const parentPath = process.cwd();
const ourPackage = require(parentPath + '/package.json');
const browserSync = require('browser-sync').create();

const buildBrowserSync = () => {
	browserSync.init({
		port: ourPackage.sdc?.port || 3000,
		proxy: ourPackage.sdc?.browsersync?.localProxyURL,
		files: [
			parentPath + '/dist/**/*',
			parentPath + '/**/*.php'
		],
		open: ourPackage.sdc?.open || false,
		https: (process.env.SSL_KEY_PATH && process.env.SSL_CRT_PATH ? {
			key: process.env.SSL_KEY_PATH,
			cert: process.env.SSL_CRT_PATH
		} : false)
	});
};

module.exports = buildBrowserSync;
