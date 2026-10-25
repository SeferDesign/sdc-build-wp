import { promises as fs } from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { createHash } from 'node:crypto';
import { detectWordPressVersion, loadWordPressSchemas } from './wordpress-schemas.js';
const scriptFields = ['editorScript', 'script', 'viewScript', 'viewScriptModule'];
const assetFields = [...scriptFields, 'editorStyle', 'style', 'viewStyle', 'render', 'variations'];

export async function validateWordPress({ root, localProxyURL, wordpressVersionCommand, file, context, useCache = true }) {
	const timerStart = performance.now();
	const diagnostics = [];
	const files = [];
	let cachedFiles = 0;
	let activeEntry = null;
	const entries = new Map();
	const relative = file => path.relative(root, file).split(path.sep).join('/');
	const add = (severity, file, pointer, message) => diagnostics.push({ severity, file: relative(file), pointer, message });
	let detected = context?.detected, schemas = context?.schemas;
	try {
		if (!context) {
			detected = await detectWordPressVersion({ root, localProxyURL, wordpressVersionCommand });
			schemas = await loadWordPressSchemas({ root, version: detected.version });
			context = { detected, schemas, blockNames: new Map() };
		}
	} catch (error) {
		add('error', root, '/', error.message);
		return { diagnostics, files, cachedFiles, setupFailed: true, elapsedMs: performance.now() - timerStart };
	}
	context.validationCache ??= new Map();
	context.validationDependencies ??= new Map();
	const requested = file ? path.resolve(root, file) : null;
	const isFile = async file => {
		let exists;
		activeEntry?.dependencies.set(file, null);
		try {
			exists = (await fs.stat(file)).isFile();
		} catch (error) {
			if (!['ENOENT', 'ENOTDIR'].includes(error.code)) { throw error; }
			exists = false;
		}
		activeEntry?.dependencies.set(file, exists);
		return exists;
	};
	const read = async (file, type, optional = false) => {
		files.push(relative(file));
		activeEntry = null;
		let content;
		try {
			content = await fs.readFile(file, 'utf8');
		} catch (error) {
			context.validationCache.delete(file);
			if (optional && ['ENOENT', 'ENOTDIR'].includes(error.code)) {
				files.pop();
				return null;
			}
			add('error', file, '/', `Cannot read JSON: ${error.message}`);
			return null;
		}
		const hash = createHash('sha256').update(content).digest('hex');
		const cached = useCache ? context.validationCache.get(file) : null;
		if (cached?.hash === hash && cached.schema === schemas[type] && cached.wordpressVersion === detected.version) {
			const dependencies = await Promise.all([...cached.dependencies].map(async ([dependency, exists]) => (await isFile(dependency)) === exists));
			if (dependencies.every(Boolean)) {
				cachedFiles++;
				diagnostics.push(...cached.diagnostics);
				if (cached.blockName) { context.blockNames.set(file, cached.blockName); }
				return null;
			}
		}
		activeEntry = { hash, schema: schemas[type], wordpressVersion: detected.version, dependencies: new Map() };
		entries.set(file, activeEntry);
		let data;
		try {
			data = JSON.parse(content);
		} catch (error) {
			add('error', file, '/', `Cannot read JSON: ${error.message}`);
			return null;
		}
		if (!schemas[type](data)) {
			for (const error of schemas[type].errors) {
				const property = error.params.additionalProperty || error.params.missingProperty;
				add('error', file, `${error.instancePath}${property ? `/${property}` : ''}` || '/', error.message);
			}
			return null;
		}
		return data;
	};
	const validateFile = async (file, type, inspect, optional = false) => {
		try {
			const data = await read(file, type, optional);
			if (data) { await inspect(data); }
		} catch (error) {
			context.validationCache.delete(file);
			const entry = entries.get(file);
			if (entry) { entry.cacheable = false; }
			add('error', file, '/', `Cannot validate file: ${error.message}`);
		}
	};
	const reference = async (file, pointer, value, base, deferred = false) => {
		if (typeof value !== 'string' || !value.startsWith('file:')) { return; }
		let target;
		try {
			target = path.resolve(base, decodeURIComponent(value.slice(5).split(/[?#]/)[0]));
		} catch {
			add('error', file, pointer, `Invalid local asset URI: ${value}`);
			return;
		}
		if (path.relative(root, target).startsWith(`..${path.sep}`) || path.relative(root, target) === '..') {
			add('error', file, pointer, `Local asset escapes the project: ${value}`);
			return;
		}
		if (!(await isFile(target))) {
			if (!deferred) { add('error', file, pointer, `Local asset not found: ${value}`); }
			return;
		}
	};
	const themeReferences = async (data, file, pointer = '') => {
		if (typeof data === 'string') {
			if (data.startsWith('file:')) {
				await reference(file, pointer, data, root);
			} else {
				for (const match of data.matchAll(/url\(\s*['"]?(file:[^'")]+)['"]?\s*\)/g)) {
					await reference(file, pointer, match[1].trim(), root);
				}
			}
		} else if (data && typeof data === 'object') {
			for (const [key, value] of Object.entries(data)) {
				await themeReferences(value, file, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
			}
		}
	};
	const checkTokens = (theme, file) => {
		const names = new Map();
		const token = (name, pointer) => {
			if (!/^[-_a-zA-Z][-_a-zA-Z0-9]*$/.test(name)) {
				add('error', file, pointer, `Preset generates an invalid Sass variable: $${name}`);
			}
			const normalized = name.replace(/_/g, '-');
			if (names.has(normalized)) {
				add('error', file, pointer, `Sass variable $${name} collides with ${names.get(normalized)} (hyphens and underscores are equivalent)`);
			}
			names.set(normalized, pointer);
		};
		const custom = theme.settings?.custom || {};
		for (const name of Object.keys(custom)) {
			if (!['breakpoints-rem', 'breakpoint-mobile'].includes(name)) {
				token(name === 'dirDist' ? 'themeDirDist' : name, `/settings/custom/${name}`);
			}
		}
		for (const [name, key] of [['global-content-size', 'contentSize'], ['global-wide-size', 'wideSize']]) {
			if (theme.settings?.layout?.[key]) { token(name, `/settings/layout/${key}`); }
		}
		if (theme.styles?.typography?.fontSize) { token('font-size-base', '/styles/typography/fontSize'); }
		if (theme.styles?.typography?.fontSize && custom['breakpoints-rem']) {
			for (const [key, value] of Object.entries(custom['breakpoints-rem'])) {
				token(`screen-${key}`, `/settings/custom/breakpoints-rem/${key}`);
				if (!String(value).includes('rem')) { token(`screen-${key}-px`, `/settings/custom/breakpoints-rem/${key}`); }
			}
			if (Object.keys(custom['breakpoints-rem']).length) { token('custom-breakpoints', '/settings/custom/breakpoints-rem'); }
			if (custom['breakpoint-mobile']) {
				token('mobile-breakpoint', '/settings/custom/breakpoint-mobile');
				token('mobile-breakpoint-px', '/settings/custom/breakpoint-mobile');
				if (!Object.hasOwn(custom['breakpoints-rem'], custom['breakpoint-mobile'])) {
					add('error', file, '/settings/custom/breakpoint-mobile', 'Mobile breakpoint does not name a configured breakpoint');
				}
			}
		}
		for (const [presets, pointer, prefix] of [
			[theme.settings?.typography?.fontFamilies, '/settings/typography/fontFamilies', ''],
			[theme.settings?.color?.palette, '/settings/color/palette', ''],
			[theme.settings?.color?.gradients, '/settings/color/gradients', 'gradient-']
		]) {
			for (const [index, preset] of (presets || []).entries()) { token(`${prefix}${preset.slug}`, `${pointer}/${index}/slug`); }
		}
		if (theme.settings?.color?.palette) { token('colors', '/settings/color/palette'); }
	};
	const themeFile = path.join(root, 'theme.json');
	if (!requested || requested === themeFile) {
		await validateFile(themeFile, 'theme', async theme => {
			await themeReferences(theme, themeFile);
			checkTokens(theme, themeFile);
			for (const [key, directory] of [['templateParts', 'parts'], ['customTemplates', 'templates']]) {
				for (const [index, entry] of (theme[key] || []).entries()) {
					if (!(await isFile(path.join(root, directory, `${entry.name}.html`)))) {
						add('warn', themeFile, `/${key}/${index}/name`, `No local ${directory}/${entry.name}.html; verify it is supplied by a parent theme or WordPress`);
					}
				}
			}
		}, !requested);
	}
	const variations = requested
		? (path.matchesGlob(relative(requested), 'styles/**/*.json') ? [requested] : [])
		: fs.glob(path.join(root, 'styles/**/*.json'));
	for await (const file of variations) {
		await validateFile(file, 'variation', variation => themeReferences(variation, file));
	}
	const blocks = requested
		? (path.matchesGlob(relative(requested), 'blocks/**/block.json') ? [requested] : [])
		: fs.glob(path.join(root, 'blocks/**/block.json'));
	for await (const file of blocks) {
		const segments = path.relative(path.join(root, 'blocks'), file).split(path.sep);
		if (segments.some(segment => ['node_modules', 'vendor', '.git'].includes(segment))) { continue; }
		if (segments.includes('build')) { continue; }
		context.blockNames.delete(file);
		await validateFile(file, 'block', async block => {
			context.blockNames.set(file, block.name);
			activeEntry.blockName = block.name;
			for (const field of assetFields) {
				for (const [index, value] of [block[field]].flat().entries()) {
					const deferred = !['render', 'variations'].includes(field);
					await reference(file, `/${field}${Array.isArray(block[field]) ? `/${index}` : ''}`, value, path.dirname(file), deferred);
				}
			}
		});
	}
	for (const [file, entry] of entries) {
		entry.diagnostics = diagnostics.filter(diagnostic => diagnostic.file === relative(file));
		context.validationDependencies.set(file, new Set(entry.dependencies.keys()));
		if (useCache && entry.cacheable !== false) { context.validationCache.set(file, entry); }
		else { context.validationCache.delete(file); }
	}
	for (const file of files) {
		const absolute = path.resolve(root, file);
		const name = context.blockNames.get(absolute);
		if (!name) { continue; }
		const duplicate = [...context.blockNames].find(([other, otherName]) => other !== absolute && otherName === name);
		if (duplicate) { add('error', absolute, '/name', `Duplicate block name ${name}; also declared in ${relative(duplicate[0])}`); }
	}
	if (files.length === 0 && !requested) { add('warn', root, '/', 'No theme, variation, or source block metadata found'); }
	return { diagnostics, files, context, cachedFiles, elapsedMs: performance.now() - timerStart, wordpressVersion: detected.version, schemaVersion: schemas.version, versionSource: detected.source };
}

export function logValidation(result, log, { singleFile = false } = {}) {
	for (const diagnostic of result.diagnostics) {
		log(diagnostic.severity, `${diagnostic.file || '.'} (${diagnostic.pointer}): ${diagnostic.message}`);
	}
	const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
	const warnings = result.diagnostics.filter(diagnostic => diagnostic.severity === 'warn').length;
	const severity = errors > 0 ? 'error' : warnings > 0 ? 'warn' : 'success';
	const label = singleFile && result.files.length === 1
		? `/${result.files[0]}`
		: `${result.files.length} ${result.files.length === 1 ? 'file' : 'files'}`;
	const cacheIndicator = result.cachedFiles > 0 ? (result.cachedFiles === result.files.length ? ' (cached)' : ` (${result.cachedFiles} cached)`) : '';
	const timing = `${cacheIndicator} in ${Math.round(result.elapsedMs || 0)}ms`;
	if (result.setupFailed) {
		log('error', `Failed starting validation${timing} - see above error.`);
		return errors;
	}
	if (errors) {
		const failedFiles = new Set(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.file));
		const failed = result.files.filter(file => failedFiles.has(file)).length;
		const succeeded = result.files.length - failed;
		if (!singleFile && failed > 0 && succeeded > 0) {
			log('error', `Validated ${succeeded} ${succeeded === 1 ? 'file' : 'files'}; failed validating ${failed} ${failed === 1 ? 'file' : 'files'}${timing} - see above error.`);
		} else {
			log('error', `Failed validating ${label}${timing} - see above error.`);
		}
	} else {
		log(severity, `Validated ${label}${warnings ? ` with ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''}${timing}`);
	}
	return errors;
}

export function watchWordPressValidation({ root, localProxyURL, wordpressVersionCommand, context, useCache = true, ignored = [], isRunning }, log) {
	let pending = Promise.resolve();
	let stopped = false;
	const timers = new Map();
	const dirty = new Set();
	let dependencies = new Set([...context?.validationDependencies?.values() || []].flatMap(files => [...files]));
	const relative = file => path.relative(root, file).split(path.sep).join('/');
	const isMetadata = file => {
		const name = relative(file);
		return name === 'theme.json' || path.matchesGlob(name, 'styles/**/*.json') ||
			(path.matchesGlob(name, 'blocks/**/block.json') && !name.split('/').includes('build'));
	};
	const refreshDependencies = async () => {
		const next = new Set([...context?.validationDependencies?.values() || []].flatMap(files => [...files]));
		const added = [...next].filter(file => !dependencies.has(file));
		dependencies = next;
		const parents = new Set();
		for (const file of added) {
			let parent = path.dirname(file);
			while (parent !== path.dirname(parent)) {
				try {
					await fs.stat(parent);
					parents.add(parent);
					break;
				} catch (error) {
					if (!['ENOENT', 'ENOTDIR'].includes(error.code)) { throw error; }
					parent = path.dirname(parent);
				}
			}
		}
		if (!stopped && parents.size) { watcher.add([...parents]); }
	};
	const enqueue = (file, removed = false) => {
		pending = pending.then(async () => {
			if (stopped) { return; }
			if (removed) {
				context?.blockNames.delete(file);
				context?.validationCache?.delete(file);
				context?.validationDependencies?.delete(file);
				dirty.delete(file);
				await refreshDependencies();
				return;
			}
			if (!isRunning()) {
				dirty.add(file);
				return;
			}
			dirty.delete(file);
			const result = await validateWordPress({ root, localProxyURL, wordpressVersionCommand, file, context, useCache });
			context = result.context || context;
			await refreshDependencies();
			logValidation(result, log, { singleFile: true });
		}).catch(error => log('error', `WordPress validation failed: ${error.message}`));
	};
	const watcher = chokidar.watch(root, {
		ignoreInitial: true,
		ignored: [
			...ignored,
			(file, stats) => {
				const name = relative(file);
				const segments = name.split('/');
				if (segments.some(segment => ['node_modules', 'vendor', '.git'].includes(segment))) { return true; }
				if (segments[0] === 'blocks' && segments.includes('build')) { return true; }
				if (stats?.isDirectory()) {
					return name !== '' && !['styles', 'blocks'].includes(segments[0]) &&
						![...dependencies].some(dependency => dependency.startsWith(`${file}${path.sep}`));
				}
				return stats?.isFile() ? !isMetadata(file) && !dependencies.has(file) : false;
			}
		]
	}).on('all', (event, file) => {
		if (!['add', 'change', 'unlink'].includes(event)) { return; }
		const affected = new Set(isMetadata(file) ? [file] : []);
		for (const [owner, references] of context?.validationDependencies || []) {
			if (references.has(file)) { affected.add(owner); }
		}
		for (const owner of affected) {
			clearTimeout(timers.get(owner));
			const removed = owner === file && event === 'unlink';
			if (removed) {
				timers.delete(owner);
				enqueue(owner, true);
				continue;
			}
			timers.set(owner, setTimeout(() => {
				timers.delete(owner);
				enqueue(owner);
			}, 100));
		}
	}).on('error', error => log('error', `WordPress validation watcher failed: ${error.message}`));
	return {
		async resume() {
			await pending;
			for (const file of dirty) { enqueue(file); }
			await pending;
		},
		async stopWatching() {
			stopped = true;
			for (const timer of timers.values()) { clearTimeout(timer); }
			timers.clear();
			await watcher.close();
			await pending;
		}
	};
}
