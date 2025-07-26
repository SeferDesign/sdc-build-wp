import BaseComponent from './base.js';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

export default class CacheComponent extends BaseComponent {

	constructor() {
		super();
		this.description = 'Build caching';
		this.cacheDir = `${this.project.path}/.sdc-build-wp/cache`;
		this.manifestPath = `${this.cacheDir}/manifest.json`;
		this.manifest = {};
		this.hashCache = new Map();
		this.dependencyGraph = new Map();
	}

	async init() {
		await fs.mkdir(this.cacheDir, { recursive: true });
		await this.loadManifest();
		await this.cleanStaleEntries();
		await this.ensureGitignore();
	}

	async loadManifest() {
		const packageVersion = await this.getPackageVersion();
		try {
			const manifestData = await fs.readFile(this.manifestPath, 'utf8');
			this.manifest = JSON.parse(manifestData);
			if (this.manifest.version !== packageVersion) {
				throw new Error(`Manifest version mismatch: expected ${packageVersion}, found ${this.manifest.version}`);
			}
		} catch (error) {
			this.manifest = {
				version: packageVersion,
				timestamp: Date.now(),
				entries: {},
				dependencies: {}
			};
		}
	}

	async saveManifest() {
		this.manifest.timestamp = Date.now();
		await fs.writeFile(this.manifestPath, JSON.stringify(this.manifest, null, 2));
	}

	async ensureGitignore() {
		const gitignorePath = path.join(this.project.path, '.gitignore');

		try {
			let gitignoreContent = '';
			let gitignoreExists = false;

			try {
				gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
				gitignoreExists = true;
			} catch (error) {
				// .gitignore doesn't exist, we'll create it
			}

			const lines = gitignoreContent.split('\n');
			let hasSDCBuild = lines.some(line => line.trim() === '.sdc-build-wp/cache');
			let needsUpdate = false;

			if (!hasSDCBuild) {
				if (gitignoreContent && !gitignoreContent.endsWith('\n')) {
					gitignoreContent += '\n';
				}
				gitignoreContent += '.sdc-build-wp/cache\n';
				needsUpdate = true;
				this.log('info', 'Added .sdc-build-wp/cache to .gitignore');
			}

			if (needsUpdate || !gitignoreExists) {
				await fs.writeFile(gitignorePath, gitignoreContent);
				if (!gitignoreExists) {
					this.log('info', 'Created .gitignore file');
				}
			}
		} catch (error) {
			this.log('warn', `Failed to update .gitignore: ${error.message}`);
		}
	}

	async getPackageVersion() {
		try {
			return await this.utils.getThisPackageVersion() || '1.0.0';
		} catch (error) {
			this.log('warn', `Failed to read package.json version: ${error.message}`);
			return '1.0.0';
		}
	}

	async getFileHash(filePath) {

		if (this.hashCache.has(filePath)) {
			return this.hashCache.get(filePath);
		}

		try {
			const content = await fs.readFile(filePath);
			const hash = createHash('sha256').update(content).digest('hex');
			this.hashCache.set(filePath, hash);
			return hash;
		} catch (error) {
			// File doesn't exist or can't be read
			return null;
		}
	}

	async getFileStatsHash(filePath) {
		try {
			const stats = await fs.stat(filePath);
			const hash = createHash('sha256')
				.update(`${stats.mtime.getTime()}-${stats.size}`)
				.digest('hex');
			return hash;
		} catch (error) {
			return null;
		}
	}

	async needsRebuild(inputFile, outputFile, dependencies = []) {
		const cacheKey = this.getCacheKey(inputFile, outputFile);
		const cachedEntry = this.manifest.entries[cacheKey];

		if (!cachedEntry) {
			return true;
		}

		try {
			await fs.access(outputFile);
		} catch (error) {
			return true;
		}

		const currentInputHash = await this.getFileHash(inputFile);
		if (currentInputHash !== cachedEntry.inputHash) {
			return true;
		}

		for (const dep of dependencies) {
			const currentDepHash = await this.getFileHash(dep);
			const cachedDepHash = cachedEntry.dependencies?.[dep];

			if (currentDepHash !== cachedDepHash) {
				return true;
			}
		}

		return false;
	}

	async updateCache(inputFile, outputFile, dependencies = []) {
		const cacheKey = this.getCacheKey(inputFile, outputFile);
		const inputHash = await this.getFileHash(inputFile);

		const dependencyHashes = {};
		for (const dep of dependencies) {
			dependencyHashes[dep] = await this.getFileHash(dep);
		}

		this.manifest.entries[cacheKey] = {
			inputFile,
			outputFile,
			inputHash,
			dependencies: dependencyHashes,
			timestamp: Date.now()
		};

		await this.saveManifest();
	}

	getCacheKey(inputFile, outputFile) {
		const relativePath = path.relative(this.project.path, inputFile);
		const relativeOutput = path.relative(this.project.path, outputFile);
		return createHash('md5').update(`${relativePath}:${relativeOutput}`).digest('hex');
	}

	async invalidateFile(filePath) {
		const toRemove = [];

		for (const [cacheKey, entry] of Object.entries(this.manifest.entries)) {
			if (entry.inputFile === filePath || entry.dependencies?.[filePath]) {
				toRemove.push(cacheKey);
			}
		}

		for (const key of toRemove) {
			delete this.manifest.entries[key];
		}

		if (toRemove.length > 0) {
			await this.saveManifest();
		}

		this.hashCache.delete(filePath);
	}

	async cleanStaleEntries() {
		const toRemove = [];
		const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
		const now = Date.now();

		for (const [cacheKey, entry] of Object.entries(this.manifest.entries)) {
			if (now - entry.timestamp > maxAge) {
				toRemove.push(cacheKey);
				continue;
			}
			try {
				await fs.access(entry.inputFile);
			} catch (error) {
				toRemove.push(cacheKey);
			}
		}

		for (const key of toRemove) {
			delete this.manifest.entries[key];
		}

		if (toRemove.length > 0) {
			this.log('info', `Cleaned ${toRemove.length} stale cache entries`);
			await this.saveManifest();
		}
	}

	async clearCache() {
		try {
			await fs.rm(this.cacheDir, { recursive: true, force: true });
			await fs.mkdir(this.cacheDir, { recursive: true });
			const packageVersion = await this.getPackageVersion();
			this.manifest = {
				version: packageVersion,
				timestamp: Date.now(),
				entries: {},
				dependencies: {}
			};
			this.hashCache.clear();
			this.log('info', 'Cache cleared');
		} catch (error) {
			this.log('error', `Failed to clear cache: ${error.message}`);
		}
	}

	getCacheInfo(inputFile, outputFile) {
		const cacheKey = this.getCacheKey(inputFile, outputFile);
		const entry = this.manifest.entries[cacheKey];
		return {
			cacheKey,
			exists: !!entry,
			entry: entry || null,
			inMemoryCache: this.hashCache.has(inputFile)
		};
	}

	clearHashCache(filePaths) {
		if (Array.isArray(filePaths)) {
			filePaths.forEach(filePath => this.hashCache.delete(filePath));
		} else {
			this.hashCache.delete(filePaths);
		}
	}

	async build() {
		//
	}

	async process() {
		//
	}

	async watch() {
		this.watcher = this.chokidar.watch([
			`${this.project.path}/**/*`,
			`!${this.project.path}/.sdc-build-wp/**/*`,
			`!${this.project.paths.nodeModules}/**/*`,
			`!${this.project.paths.composer.vendor}/**/*`,
			`!${this.project.path}/.git/**/*`
		], {
			...this.project.chokidarOpts,
			ignoreInitial: true
		}).on('unlink', async (filePath) => {
			await this.invalidateFile(filePath);
		}).on('change', async (filePath) => {
			this.hashCache.delete(filePath);
			await this.invalidateFile(filePath);
		});
	}
}
