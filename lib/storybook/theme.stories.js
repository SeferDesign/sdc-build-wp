export default { title: 'WordPress/Theme' };

export const Colors = {
	render: (args, { loaded }) => {
		const container = document.createElement('div');
		for (const color of loaded.themeJSON.settings?.color?.palette || []) {
			const swatch = document.createElement('div');
			swatch.className = `has-${color.slug}-background-color has-background`;
			swatch.style.padding = '2rem';
			swatch.textContent = `${color.name || color.slug}: ${color.color}`;
			container.append(swatch);
		}
		return container;
	}
};

export const Typography = {
	render: (args, { loaded }) => {
		const container = document.createElement('div');
		for (const preset of loaded.themeJSON.settings?.typography?.fontSizes || []) {
			const paragraph = document.createElement('p');
			paragraph.className = `has-${preset.slug}-font-size`;
			paragraph.textContent = `${preset.name || preset.slug}: The quick brown fox jumps over the lazy dog.`;
			container.append(paragraph);
		}
		for (const preset of loaded.themeJSON.settings?.typography?.fontFamilies || []) {
			const paragraph = document.createElement('p');
			paragraph.style.fontFamily = `var(--wp--preset--font-family--${preset.slug})`;
			paragraph.textContent = `${preset.name || preset.slug}: The quick brown fox jumps over the lazy dog.`;
			container.append(paragraph);
		}
		return container;
	}
};

export const Elements = {
	render: () => '<main class="is-layout-constrained"><h1>Theme heading</h1><h2>Section heading</h2><p>Theme paragraph with <a href="#example">a link</a>, <strong>strong text</strong>, and <em>emphasis</em>.</p><div class="wp-block-buttons"><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="#example">Theme button</a></div></div><blockquote class="wp-block-quote"><p>A sample quotation.</p></blockquote></main>'
};
