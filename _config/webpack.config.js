const pathConfig = require('path');
const path = pathConfig.resolve(__dirname, '.');
const parentPath = process.cwd();
const package = require(process.cwd() + '/package.json');
const notifier = require('node-notifier');
const WebpackBar = require('webpackbar');
// const FriendlyErrorsWebpackPlugin = require('friendly-errors-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const StylelintPlugin = require('stylelint-webpack-plugin');
const ReplaceInFileWebpackPlugin = require('replace-in-file-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const ImageminPlugin = require('imagemin-webpack-plugin').default;
const RemovePlugin = require('remove-files-webpack-plugin');
const BrowserSyncPlugin = require('browser-sync-webpack-plugin');

var entries = {};
for (const [name, files] of Object.entries(package.sdc.entries)) {
	entries[name] = [];
	files.forEach(function(file) {
		entries[name].push(parentPath + file);
	});
}
const config = {
	entry: entries,
	output: {
		filename: '[name].min.js',
		path: parentPath + '/dist',
		libraryTarget: 'var',
		library: 'site'
	},
	mode: 'production',
	// output: {
	// 	filename: '[name].min.js',
	// 	path: parentPath + '/dist'
	// },
	devtool: 'source-map',
	resolve: {
		extensions: ['.js', '.scss']
	},
	module: {
		rules: [
			{
				test: /\.js$/,
				exclude: /node_modules/,
				use: [
					{ loader: 'babel-loader' },
					{ loader: 'eslint-loader', options: {
						configFile: pathConfig.resolve(__dirname, '.eslintrc'),
						fix: true
					}}
				]
			},
			{
				test: /\.scss$/i,
				exclude: /node_modules/,
				use: [
					{ loader: MiniCssExtractPlugin.loader },
					{ loader: 'css-loader', options: {
						url: false
					} },
					{ loader: 'group-css-media-queries-loader' },
					{ loader: 'sass-loader' },
					{ loader: 'postcss-loader' }
				]
			}
		]
	},
	performance: {
		maxEntrypointSize: 512000,
		maxAssetSize: 512000
	},
	plugins: [
		new WebpackBar(),
		// new FriendlyErrorsWebpackPlugin({
		// 	onErrors: function(severity, errors) {
		// 		if (severity !== 'error') { return; }
		// 		const error = errors[0];
		// 		notifier.notify({
		// 			title: 'Webpack error',
		// 			message: severity + ': ' + error.name,
		// 			subtitle: error.file || ''
		// 		});
		// 	}
		// }),
		new StylelintPlugin({
			configFile: pathConfig.resolve(__dirname, '.stylelintrc'),
			fix: true
		}),
		new MiniCssExtractPlugin({
			filename: '[name].min.css'
		}),
		new ReplaceInFileWebpackPlugin([
			{
				dir: './',
				files: ['functions.php'],
				rules: [{
					search: /\$cacheVersion\ \=\ \'(.*)\'\;/g,
					replace: function(match) {
						return match.replace(/\'([^\']+)\'/g, '\'' + new Date().getTime() + '\'');
					}
				}]
			}
		]),
		// new CopyPlugin([
		// 	{
		// 		from: '_src/images/',
		// 		to: 'images'
		// 	},
		// 	{
		// 		from: '_src/fonts/',
		// 		to: 'fonts',
		// 		ignore: ['.keep']
		// 	}
		// ]),
		new ImageminPlugin({
			test: /\.(jpe?g|png|gif|svg)$/i
		}),
		new RemovePlugin({
			after: {
				test: [
					{
						folder: 'dist/style',
						method: (filePath) => {
							return new RegExp(/\.(js|js.map)$/, 'm').test(filePath);
						}
					}
				]
			}
		})
	]
};
if (package.sdc.browsersync) {
	const bspOptions = {
		host: 'localhost',
		port: package.sdc.port || 3000,
		proxy: package.sdc.browsersync.localProxyURL,
		open: package.sdc.open || false,
		reloadDelay: package.sdc.reloadDelay || 800,
		files: [{
			match: ['**/*.php', '_src/style/**/*', '_src/scripts/**/*.js'],
			fn: function(event, file) {
				if (event === 'change') {
					const bs = require('browser-sync').get('bs-webpack-plugin');
					if (file.split('.').pop() == 'scss') {
						bs.reload('*.css');
					} else if (['php', 'js'].includes(file.split('.').pop())) {
						bs.reload();
					}
				}
			}
		}]
	};
	if (process.env.SSL_KEY_PATH && process.env.SSL_CRT_PATH) {
		bspOptions.https = {
			key: process.env.SSL_KEY_PATH,
			cert: process.env.SSL_CRT_PATH
		};
	}
	config.plugins.push(new BrowserSyncPlugin(bspOptions, {
		reload: false,
		name: 'bs-webpack-plugin'
	}));
}

module.exports = config;
