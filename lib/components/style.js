import BaseComponent from './base.js';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import * as sass from 'sass';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import sortMQ from 'postcss-sort-media-queries';
import stylelint from 'stylelint';

export default class StyleComponent extends BaseComponent {

	constructor() {
		super();
		this.description = `Lint and process style files`;
	}

	async init() {
		this.files = this.utils.addEntriesByFiletypes(['.scss']);
		this.globs = await Array.fromAsync(
			this.glob(this.project.package?.sdc?.sassGlobPath ||
			`${this.project.path}{/${this.project.paths.src.src}/${this.project.paths.src.style},/blocks}/**/*.scss`)
		);
		await this.process();
	}

	async buildTheme() {
		try {
			let theme = JSON.parse(await fs.readFile(this.project.paths.theme.json));
			let themeFileData = `// This file is automatically generated from theme.json. Do not edit.\n`;
			if (theme.settings?.custom) {
				for (var customAttribute in theme.settings.custom) {
					if (customAttribute == 'dirDist') {
						themeFileData += `$themeDirDist: "${theme.settings.custom[customAttribute]}"; // --wp--custom--${this.utils.camelToDash(customAttribute)}\n`;
					} else if (['breakpoints-rem', 'breakpoint-mobile'].includes(customAttribute)) {
						// handled later in file - see 'fontSizeBase'
					} else {
						themeFileData += `$${customAttribute}: "${theme.settings.custom[customAttribute]}"; // --wp--custom--${this.utils.camelToDash(customAttribute)}\n`;
					}
				}
			}
			if (theme.styles?.typography) {
				if (theme.styles.typography.fontSize) {
					let fontSizeBase = theme.styles.typography.fontSize;
					themeFileData += `$font-size-base: ${theme.styles.typography.fontSize}; // --wp--preset--font-size\n`;
					if (theme.settings.custom && theme.settings.custom['breakpoints-rem']) {
						let customBreakpoints = {};
						for (var breakpoint in theme.settings.custom['breakpoints-rem']) {
							if (theme.settings.custom['breakpoints-rem'][breakpoint].toString().includes('rem')) {
								themeFileData += `$screen-${breakpoint}: ${theme.settings.custom['breakpoints-rem'][breakpoint]}; // --wp--custom--breakpoints-rem--${breakpoint}\n`;
							} else {
								themeFileData += `$screen-${breakpoint}: ${theme.settings.custom['breakpoints-rem'][breakpoint]}rem; // --wp--custom--breakpoints-rem--${breakpoint} (without 'rem')\n`;
							}
							themeFileData += `$screen-${breakpoint}-px: ${theme.settings.custom['breakpoints-rem'][breakpoint].toString().replace('rem', '') * fontSizeBase.replace('px', '')}px;\n`;
							customBreakpoints[`screen-${breakpoint}`] = `$screen-${breakpoint}`;
						}
						if (theme.settings.custom['breakpoint-mobile']) {
							themeFileData += `$mobile-breakpoint: $screen-${theme.settings.custom['breakpoint-mobile']}; // --wp--custom--breakpoint-mobile \n`;
							themeFileData += `$mobile-breakpoint-px: $screen-${theme.settings.custom['breakpoint-mobile']}-px;\n`;
							customBreakpoints[`desktop`] = `$mobile-breakpoint`;
							customBreakpoints[`mobile`] = `$mobile-breakpoint-px - 1`;
						}
						if (Object.keys(customBreakpoints).length) {
							themeFileData += `$custom-breakpoints: (\n${Object.entries(customBreakpoints).map(([key, value]) => {
								return `\t'${key}': ${value}`;
							}).join(',\n')}\n); // --wp--custom--breakpoints\n`;
						}
					}
				}
			}
			if (theme.settings?.typography?.fontFamilies) {
				for (var fontFamily of theme.settings.typography.fontFamilies) {
					themeFileData += `$${fontFamily['slug']}: ${fontFamily['fontFamily']}; // --wp--preset--font-family--${fontFamily['slug']}\n`;
				}
			}
			if (theme.settings?.color?.palette) {
				for (var color of theme.settings.color.palette) {
					themeFileData += `$${color['slug']}: ${color['color']}; // --wp--preset--color--${color['slug']}\n`;
				}
			}
			if (theme.settings?.color?.gradients) {
				for (var color of theme.settings.color.gradients) {
					themeFileData += `$gradient-${color['slug']}: ${color['gradient']};\ // --wp--preset--gradient--${color['slug']}\n`;
				}
			}
			try {
				await fs.writeFile(this.project.paths.theme.scss, themeFileData);
			} catch(error) {
				console.error(error);
				this.log('error', `Failed to write auto-generated _theme.scss - See above error.`);
			}
		} catch(error) {
			console.error(error);
			this.log('error', `Failed to read theme.json - See above error.`);
		}
	}

	async build(entry, options) {
		options = Object.assign({}, {
			name: '',
			entriesToLint: []
		}, options);
		let thisClass = this;
		let outFile = `${this.project.path}/${this.project.paths.dist}/${options.name}.min.css`;
		if (options.name.startsWith('blocks/')) {
			outFile = this.project.path + '/' + options.name + '.min.css';
		}
		let entryLabel = outFile.replace(this.project.path, '');
		this.start();

		try {
			await fs.access(`${this.project.path}/${this.project.paths.dist}/${this.project.paths.src.style}`);
		} catch(error) {
			await fs.mkdir(`${this.project.path}/${this.project.paths.dist}/${this.project.paths.src.style}`, { recursive: true });
		}
		try {
			const stylelinted = await stylelint.lint({
				configFile: this.path.resolve(this.path.dirname(fileURLToPath(import.meta.url)), '../../.stylelintrc.json'),
				formatter: 'string',
				files: options.entriesToLint || [entry],
				customSyntax: 'postcss-scss',
				fix: true
			});
			if (stylelinted.errored) {
				console.error(stylelinted.report);
				throw Error('Linting error');
			}
			const compileResult = await sass.compileAsync(entry, {
				style: 'compressed',
				sourceMap: true
			});
			const postcssResult = await postcss([
				autoprefixer(),
				sortMQ()
			]).process(compileResult.css, {
				from: undefined,
				to: outFile,
				map: {
					inline: false
				}
			});
			await fs.writeFile(outFile, postcssResult.css);
			if (process.env.NODE_ENV != 'production') {
				await fs.writeFile(`${outFile}.map`, postcssResult.map.toString());
			}
			thisClass.end({
				itemLabel: entryLabel
			});
		} catch(error) {
			console.error(error);
			this.log('error', `Failed building ${entryLabel} - See above error.`);
			return false;
		}
	}

	async process(entry, options) {
		options = Object.assign({}, {
			buildTheme: true
		}, options);
		if (options.buildTheme) {
			await this.buildTheme();
		}
		let i = 0;
		for (var block of this.files) {
			if (!entry || entry == block.file) {
				await this.build(block.file, {
					name: block.name,
					entriesToLint: i == 0 ? this.globs : null
				});
				if (entry == block.file) {
					break;
				}
				i++;
			}
		}
	}

	watch() {
		this.chokidar.watch([
			...[this.project.paths.theme.json],
			this.globs
		], {
			...this.project.chokidarOpts
		}).on('all', (event, path) => {
			let hasRanSingle = false;
			for (var block of this.files) {
				if (path == block.file || this.utils.getImportedSASSFiles(block.file).includes(path)) {
					this.process(block.file, { buildTheme: path == this.project.paths.theme.json });
					hasRanSingle = true;
				}
			}
			if (!hasRanSingle) {
				this.process(null, { buildTheme: path == this.project.paths.theme.json });
			}
		});
	}

}
