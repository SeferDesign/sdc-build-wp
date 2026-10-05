import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

function absoluteURL(value, baseURL) {
	const url = new URL(value, baseURL);
	if (!['http:', 'https:', 'data:'].includes(url.protocol)) {
		throw new Error(`Unsupported stylesheet URL protocol: ${url.protocol}`);
	}
	return url.href;
}

export function rewriteCSS(css, baseURL) {
	const root = postcss.parse(css);
	const rewrite = value => {
		const parsed = valueParser(value);
		parsed.walk(node => {
			if (node.type === 'function' && node.value.toLowerCase() === 'url') {
				const value = valueParser.stringify(node.nodes).replace(/^(['"])(.*)\1$/, '$2');
				if (value && !value.startsWith('#')) {
					node.nodes = [{ type: 'string', quote: '"', value: absoluteURL(value, baseURL) }];
				}
				return false;
			}
		});
		return parsed.toString();
	};
	root.walkDecls(declaration => { declaration.value = rewrite(declaration.value); });
	root.walkAtRules(rule => {
		rule.params = rewrite(rule.params);
		if (rule.name.toLowerCase() === 'import') {
			const parsed = valueParser(rule.params);
			const first = parsed.nodes[0];
			if (first?.type === 'string') {
				first.value = absoluteURL(first.value, baseURL);
				rule.params = parsed.toString();
			}
		}
	});
	return root.toString();
}

export function extractWordPressStyles(html, pageURL) {
	const document = parse(html);
	const styles = [];
	let baseURL = pageURL;
	let bodyClasses = '';
	const visit = (node, callback) => {
		callback(node);
		for (const child of node.childNodes || []) { visit(child, callback); }
	};
	let foundBase = false;
	visit(document, node => {
		const attrs = Object.fromEntries((node.attrs || []).map(attr => [attr.name, attr.value]));
		if (node.tagName === 'base' && attrs.href && !foundBase) {
			baseURL = absoluteURL(attrs.href, pageURL);
			foundBase = true;
		}
	});
	visit(document, node => {
		const attrs = Object.fromEntries((node.attrs || []).map(attr => [attr.name, attr.value]));
		if (node.tagName === 'body') { bodyClasses = attrs.class || ''; }
		if (node.tagName === 'link' && attrs.rel?.toLowerCase().split(/\s+/).includes('stylesheet') && attrs.href) {
			styles.push({ tag: 'link', href: absoluteURL(attrs.href, baseURL), media: attrs.media || '', id: attrs.id || '' });
		} else if (node.tagName === 'style' && (!attrs.type || attrs.type.toLowerCase() === 'text/css')) {
			const css = (node.childNodes || []).map(child => child.value || '').join('');
			styles.push({ tag: 'style', css: rewriteCSS(css, baseURL), media: attrs.media || '', id: attrs.id || '' });
		}
	});
	if (styles.length === 0) {
		throw new Error('The WordPress source page did not contain any stylesheets or inline styles');
	}
	return { styles, bodyClasses };
}

export async function loadWordPressTheme(themePath, sourceURL) {
	const url = new URL(sourceURL);
	if (!['http:', 'https:'].includes(url.protocol)) {
		throw new Error('Storybook sourceURL must be an HTTP or HTTPS WordPress page');
	}
	const [themeJSON, response] = await Promise.all([
		readFile(path.join(themePath, 'theme.json'), 'utf8').then(JSON.parse),
		fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' } })
	]);
	if (!response.ok) {
		throw new Error(`WordPress source returned HTTP ${response.status}`);
	}
	if (!response.headers.get('content-type')?.includes('text/html')) {
		throw new Error('WordPress source must return an HTML page');
	}
	return { themeJSON, ...extractWordPressStyles(await response.text(), response.url) };
}
