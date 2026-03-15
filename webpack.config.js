let defaultConfig = {};

try {
	const wpConfig = await import('@wordpress/scripts/config/webpack.config.js');
	defaultConfig = wpConfig.default || {};
} catch {
	defaultConfig = {};
}

export default {
	...defaultConfig,
	mode: 'production',
	cache: {
		type: 'memory'
	}
};
