import Ajv from 'ajv';
import configSchema from '../config.schema.json' with { type: 'json' };
import log from './logging.js';

const validate = new Ajv({ allErrors: true }).compile(configSchema);

function validateConfig(config) {
	if (validate(config)) { return true; }
	for (const error of validate.errors) {
		const location = `${error.instancePath || '/'}${error.params.additionalProperty ? `/${error.params.additionalProperty}` : ''}`;
		log('error', `Configuration error at '${location}': expected ${error.message}, got invalid value`);
	}
	log('error', 'Configuration validation failed');
	return false;
}

function getDefaultConfig() {
	const errorLogPaths = [
		'../../../../../logs/php/error.log',
		'../../debug.log'
	];

	return {
		errorLogPath: errorLogPaths[0], // default Local by Flywheel error log path
		errorLogPaths,
		formatOnly: { style: false, scripts: false },
		php: {
			enabled: true
		}
	};
}

function mergeWithDefaults(userConfig) {
	const defaults = getDefaultConfig();
	const hasSpecificErrorLogPath = userConfig.errorLogPath !== undefined && userConfig.errorLogPath !== null;

	return {
		...defaults,
		...userConfig,
		errorLogPath: hasSpecificErrorLogPath ? userConfig.errorLogPath : defaults.errorLogPath,
		errorLogPaths: hasSpecificErrorLogPath ? [userConfig.errorLogPath] : defaults.errorLogPaths,
		formatOnly: { ...defaults.formatOnly, ...userConfig.formatOnly },
		php: { ...defaults.php, ...userConfig.php }
	};
}

export { validateConfig, getDefaultConfig, mergeWithDefaults };
