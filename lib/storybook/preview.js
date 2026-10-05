let themeRequest;

async function loadTheme() {
	const response = await fetch('/sdc-wordpress-theme', { cache: 'no-store' });
	const data = await response.json();
	if (!response.ok) { throw new Error(data.error || `WordPress styles failed: HTTP ${response.status}`); }
	document.body.className = [document.body.className, data.bodyClasses].filter(Boolean).join(' ');
	const pending = [];
	for (const style of data.styles) {
		const element = document.createElement(style.tag);
		if (style.id) { element.id = style.id; }
		if (style.media) { element.media = style.media; }
		if (style.tag === 'link') {
			element.rel = 'stylesheet';
			element.href = style.href;
			pending.push(new Promise((resolve, reject) => {
				element.onload = resolve;
				element.onerror = () => reject(new Error(`Failed to load WordPress stylesheet: ${style.href}`));
			}));
		} else {
			element.textContent = style.css;
		}
		document.head.append(element);
	}
	await Promise.all(pending);
	return data.themeJSON;
}

export default {
	loaders: [async () => {
		themeRequest ??= loadTheme();
		return { themeJSON: await themeRequest };
	}],
	decorators: [story => {
		const wrapper = document.createElement('div');
		wrapper.className = 'wp-site-blocks';
		const content = story();
		if (typeof content === 'string') { wrapper.innerHTML = content; } else { wrapper.append(content); }
		return wrapper;
	}],
	parameters: { layout: 'fullscreen' }
};
