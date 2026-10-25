import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'parse5';

const requests = new Map();
const execute = promisify(exec);

async function detectProxyVersion(localProxyURL) {
	const url = new URL(localProxyURL);
	if (!['http:', 'https:'].includes(url.protocol)) { throw new Error('The proxy URL must use HTTP or HTTPS'); }
	const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'Cache-Control': 'no-cache' } });
	if (!response.ok) { throw new Error(`Proxy returned HTTP ${response.status}`); }
	const document = parse(await response.text());
	const versions = new Set();
	const visit = node => {
		if (node.tagName === 'meta') {
			const attributes = Object.fromEntries(node.attrs.map(attribute => [attribute.name, attribute.value]));
			if (attributes.name?.toLowerCase() === 'generator') {
				const match = /^WordPress\s+(\S+)\s*$/i.exec(attributes.content || '');
				if (match) {
					schemaVersion(match[1]);
					versions.add(match[1]);
				}
			}
		}
		for (const child of node.childNodes || []) { visit(child); }
	};
	visit(document);
	if (versions.size !== 1) {
		throw new Error(versions.size ? 'Proxy exposes conflicting WordPress generator versions' : 'Proxy does not expose a WordPress generator meta tag');
	}
	return { version: [...versions][0], source: 'localProxyURL generator metadata' };
}

export function schemaVersion(version) {
	const match = /^(\d+)\.(\d+)(?:\.\d+)?(?:[-+][a-zA-Z0-9.+-]+)?$/.exec(String(version));
	if (!match) { throw new Error(`Invalid detected WordPress version: ${version}`); }
	return `${match[1]}.${match[2]}`;
}

export async function detectWordPressVersion({ root, localProxyURL, wordpressVersionCommand }) {
	const starts = [path.resolve(root)];
	const resolved = await fs.realpath(root);
	if (!starts.includes(resolved)) { starts.push(resolved); }
	const visited = new Set();
	for (const start of starts) {
		let current = start;
		while (!visited.has(current)) {
			visited.add(current);
			const file = path.join(current, 'wp-includes/version.php');
			try {
				const contents = await fs.readFile(file, 'utf8');
				const match = /^\s*\$wp_version\s*=\s*(['"])([^'"\r\n]+)\1\s*;/m.exec(contents);
				if (!match) { throw new Error(`Cannot read the WordPress version assignment in ${file}`); }
				schemaVersion(match[2]);
				return { version: match[2], source: file };
			} catch (error) {
				if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) { throw error; }
			}
			if (current === path.dirname(current)) { break; }
			current = path.dirname(current);
		}
	}
	if (wordpressVersionCommand) {
		let stdout;
		try {
			({ stdout } = await execute(wordpressVersionCommand, { cwd: root, timeout: 10000, maxBuffer: 64 * 1024, windowsHide: true }));
		} catch (error) {
			throw new Error(`Cannot detect WordPress: wordpressVersionCommand failed (${error.killed ? 'timed out or exceeded output limit' : error.code || 'execution error'}). Check the command in config.json.`);
		}
		const version = stdout.trim();
		try {
			schemaVersion(version);
		} catch {
			throw new Error('Cannot detect WordPress: wordpressVersionCommand must print only a WordPress version such as 6.8.3 on stdout.');
		}
		return { version, source: 'configured wordpressVersionCommand' };
	}
	let proxyError = '';
	if (localProxyURL) {
		try {
			return await detectProxyVersion(localProxyURL);
		} catch (error) {
			proxyError = ` Proxy detection failed: ${error.message}.`;
		}
	}
	throw new Error(`Cannot detect WordPress from wp-includes/version.php.${proxyError} Configure wordpressVersionCommand to query this installation, or browsersync.localProxyURL if the site exposes generator metadata.`);
}

function compile(schema) {
	if (!schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type !== 'object' || !schema.properties) {
		throw new Error('Response is not a WordPress object schema');
	}
	const Validator = schema.$schema?.includes('2020-12') ? Ajv2020 : schema.$schema?.includes('2019-09') ? Ajv2019 : Ajv;
	return new Validator({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
}

export async function loadWordPressSchemas({ root, version, fetcher = globalThis.fetch }) {
	const cacheDir = path.resolve(root, '.sdc-build-wp/cache/schemas');
	const target = schemaVersion(version);
	const key = `${path.resolve(cacheDir)}:${target}`;
	if (requests.has(key)) { return requests.get(key); }
	const request = (async () => {
		const load = async name => {
			const file = path.join(cacheDir, `wordpress-${target}-${name}.json`);
			try {
				const schema = JSON.parse(await fs.readFile(file, 'utf8'));
				return { schema, validate: compile(schema) };
			} catch (error) {
				if (error.code && error.code !== 'ENOENT') { throw new Error(`Cannot read schema cache ${file}: ${error.message}`); }
			}
			const url = `https://schemas.wp.org/wp/${target}/${name}.json`;
			let schema, validate;
			try {
				const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
				if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
				schema = await response.json();
				validate = compile(schema);
			} catch (error) {
				throw new Error(`Cannot load WordPress ${target} ${name} schema from ${url}: ${error.message}. Connect to the internet and retry, or check that schemas exist for this release. Cache: ${cacheDir}. No other WordPress version was substituted.`);
			}
			await fs.mkdir(cacheDir, { recursive: true });
			const temporary = `${file}.${randomUUID()}.tmp`;
			try {
				await fs.writeFile(temporary, JSON.stringify(schema));
				await fs.rename(temporary, file);
			} finally {
				await fs.rm(temporary, { force: true });
			}
			return { schema, validate };
		};
		const results = await Promise.allSettled([load('theme'), load('block')]);
		const failure = results.find(result => result.status === 'rejected');
		if (failure) { throw failure.reason; }
		const [theme, block] = results.map(result => result.value);
		return { theme: theme.validate, variation: compile({ ...theme.schema, required: [] }), block: block.validate, version: target };
	})();
	requests.set(key, request);
	try {
		return await request;
	} finally {
		requests.delete(key);
	}
}
