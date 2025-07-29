import log from './logging.js';

const configSchema = {
	imagesPath: { type: 'string', optional: true },
	errorLogPath: { type: 'string', optional: true },
	entries: { type: 'object', optional: true },
	php: {
		type: 'object',
		optional: true,
		properties: {
			enabled: { type: 'boolean', optional: true }
		}
	}
};

function validateType(value, expectedType, path = '') {
	const actualType = Array.isArray(value) ? 'array' : typeof value;
	if (actualType !== expectedType) {
		throw new Error(`Configuration error at '${path}': expected ${expectedType}, got ${actualType}`);
	}
}

function validateObject(obj, schema, path = '') {
	if (!obj || typeof obj !== 'object') {
		if (!schema.optional) {
			throw new Error(`Configuration error at '${path}': expected object, got ${typeof obj}`);
		}
		return;
	}

	const allowedKeys = Object.keys(schema.properties || {});
	const objKeys = Object.keys(obj);
	const unknownKeys = objKeys.filter(key => !allowedKeys.includes(key));

	if (unknownKeys.length > 0) {
		log('warn', `Unknown configuration properties: ${unknownKeys.map(key => `${path}.${key}`).join(', ')}`);
	}

	for (const [key, subSchema] of Object.entries(schema.properties || {})) {
		const currentPath = path ? `${path}.${key}` : key;
		const value = obj[key];

		if (value === undefined || value === null) {
			if (!subSchema.optional) {
				throw new Error(`Configuration error: required property '${currentPath}' is missing`);
			}
			continue;
		}

		if (subSchema.type === 'object' && subSchema.properties) {
			validateObject(value, subSchema, currentPath);
		} else {
			validateType(value, subSchema.type, currentPath);
		}
	}
}

function validateConfig(config) {
	try {
		for (const [key, schema] of Object.entries(configSchema)) {
			const value = config[key];
			const currentPath = key;

			if (value === undefined || value === null) {
				if (!schema.optional) {
					throw new Error(`Configuration error: required property '${currentPath}' is missing`);
				}
				continue;
			}

			if (schema.type === 'object' && schema.properties) {
				validateObject(value, schema, currentPath);
			} else {
				validateType(value, schema.type, currentPath);
			}
		}
		return true;
	} catch (error) {``
		console.error(error);
		log('error', `Configuration validation failed`);
		return false;
	}
}

function getDefaultConfig() {
	return {
		errorLogPath: '../../../../../logs/php/error.log', // default Local by Flywheel error log path
		php: {
			enabled: true
		}
	};
}

function mergeWithDefaults(userConfig) {
	const defaults = getDefaultConfig();

	return {
		...defaults,
		...userConfig,
		php: { ...defaults.php, ...userConfig.php }
	};
}

export { validateConfig, getDefaultConfig, mergeWithDefaults };
