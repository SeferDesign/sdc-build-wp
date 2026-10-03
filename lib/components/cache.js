import BaseComponent from './base.js';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

export default class CacheComponent extends BaseComponent {

	constructor() {
		super();
		this.description = 'Build caching';
		this.cacheDir = this.project.cacheDir;
		this.manifestPath = `${this.cacheDir}/manifest.json`;
		this.manifest = {};
		this.hashCache = new Map();
		this.hashRequests = new Map();
		this.dependencyGraph = new Map();
		this.batchDepth = 0;
		this.manifestDirty = false;
		this.flushTimer = null;
		this.flushPromise = null;
	}

	async init() {
		await this.flushManifest();
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
		this.manifestDirty = true;
		if (this.batchDepth > 0 || this.flushTimer) {
			return;
		}

		this.flushTimer = setTimeout(() => {
			this.flushManifest().catch(error => {
				this.log('error', `Failed to save cache manifest: ${error.message}`);
			});
		}, 100);
	}

	beginBatch() {
		this.batchDepth++;
	}

	async endBatch() {
		this.batchDepth--;
		if (this.batchDepth === 0) {
			await this.flushManifest();
		}
	}

	async flushManifest() {
		clearTimeout(this.flushTimer);
		this.flushTimer = null;
		if (this.flushPromise) {
			return this.flushPromise;
		}

		this.flushPromise = this.writeManifest();
		try {
			await this.flushPromise;
		} finally {
			this.flushPromise = null;
		}
	}

	async writeManifest() {
		while (this.manifestDirty) {
			this.manifestDirty = false;
			this.manifest.timestamp = Date.now();
			const temporaryPath = `${this.manifestPath}.${process.pid}.tmp`;
			try {
				await fs.writeFile(temporaryPath, JSON.stringify(this.manifest, null, 2));
				await fs.rename(temporaryPath, this.manifestPath);
			} catch (error) {
				this.manifestDirty = true;
				throw error;
			} finally {
				await fs.rm(temporaryPath, { force: true });
			}
		}
	}

	async ensureGitignore() {
		const gitignorePath = path.join(this.project.path, '.gitignore');
		const cacheIgnoreEntry = `${path.basename(this.project.sdcDir)}/${path.basename(this.cacheDir)}`;

		try {
			let gitignoreContent = '';
			let gitignoreExists = false;

			try {
				gitignoreContent = await fs.readFile(gitignorePath, 'utf8'); // without trailing slash
				gitignoreExists = true;
			} catch (error) {
				try {
					gitignoreContent = await fs.readFile(`${gitignorePath}/`, 'utf8'); // with trailing slash
					gitignoreExists = true;
				} catch (error) {
					// .gitignore doesn't exist, we'll create it
				}
			}

			const lines = gitignoreContent.split('\n');
			let hasSDCBuild = lines.some(line => line.trim() === cacheIgnoreEntry);
			let needsUpdate = false;

			if (!hasSDCBuild) {
				if (gitignoreContent && !gitignoreContent.endsWith('\n')) {
					gitignoreContent += '\n';
				}
				gitignoreContent += `${cacheIgnoreEntry}\n`;
				needsUpdate = true;
				this.log('info', `Added ${cacheIgnoreEntry} to .gitignore`);
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

		if (this.hashRequests.has(filePath)) {
			return this.hashRequests.get(filePath);
		}

		const request = this.readFileHash(filePath);
		this.hashRequests.set(filePath, request);
		try {
			const hash = await request;
			if (this.hashRequests.get(filePath) === request) {
				this.hashCache.set(filePath, hash);
			}
			return hash;
		} finally {
			if (this.hashRequests.get(filePath) === request) {
				this.hashRequests.delete(filePath);
			}
		}
	}

	async readFileHash(filePath) {
		try {
			const content = await fs.readFile(filePath);
			return createHash('sha256').update(content).digest('hex');
		} catch (error) {
			if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) {
				return null;
			}
			throw error;
		}
	}

	async getFileHashes(filePaths) {
		const files = [...new Set(filePaths)];
		const hashes = await this.utils.runWithConcurrency(
			files,
			this.utils.getComponentConcurrency('cache', 8),
			file => this.getFileHash(file)
		);
		return Object.fromEntries(files.map((file, index) => [file, hashes[index]]));
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

		const uniqueDependencies = [...new Set(dependencies)];
		if (Object.keys(cachedEntry.dependencies || {}).length !== uniqueDependencies.length) {
			return true;
		}

		const dependencyHashes = await this.getFileHashes(uniqueDependencies);
		return uniqueDependencies.some(dep => dependencyHashes[dep] !== cachedEntry.dependencies?.[dep]);
	}

	async updateCache(inputFile, outputFile, dependencies = []) {
		const cacheKey = this.getCacheKey(inputFile, outputFile);
		const inputHash = await this.getFileHash(inputFile);

		const dependencyHashes = await this.getFileHashes(dependencies);

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
		const filesToClearFromHashCache = new Set([filePath]);

		for (const [cacheKey, entry] of Object.entries(this.manifest.entries)) {
			if (entry.inputFile === filePath || entry.dependencies?.[filePath]) {
				toRemove.push(cacheKey);
				filesToClearFromHashCache.add(entry.inputFile);
				if (entry.dependencies) {
					Object.keys(entry.dependencies).forEach(dep => filesToClearFromHashCache.add(dep));
				}
			}
		}

		for (const key of toRemove) {
			delete this.manifest.entries[key];
		}

		if (toRemove.length > 0) {
			await this.saveManifest();
		}

		this.clearHashCache([...filesToClearFromHashCache]);
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
			await this.flushManifest();
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
			this.hashRequests.clear();
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
		for (const filePath of Array.isArray(filePaths) ? filePaths : [filePaths]) {
			this.hashCache.delete(filePath);
			this.hashRequests.delete(filePath);
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
			`!${this.project.sdcDir}/**/*`,
			`!${this.project.paths.nodeModules}/**/*`,
			`!${this.project.paths.composer.vendor}/**/*`,
			`!${this.project.path}/.git/**/*`
		], {
			...this.project.chokidarOpts,
			ignoreInitial: true
		}).on('unlink', async (filePath) => {
			await this.invalidateFile(filePath);
		}).on('change', async (filePath) => {
			await this.invalidateFile(filePath);
		});
	}
}
