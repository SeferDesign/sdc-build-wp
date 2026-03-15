import defaultConfig from '@wordpress/scripts/config/webpack.config.js';

export default {
	...defaultConfig,
	mode: 'production',
	cache: {
		type: 'memory'
	}
};
