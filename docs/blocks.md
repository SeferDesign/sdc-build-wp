# Blocks

Blocks live in `blocks/<name>/src/` (with a `block.json`) and compile to `blocks/<name>/build/`.

Every block build, whether the initial batch, a watch rebuild or a newly created block, runs through one pipeline: cache preflight, an in-process `@wordpress/scripts` webpack compile, then caching of successful builds. A failed or timed-out block is reported on its own and never fails the others.

Alongside the source files it scans, each build records the project files webpack actually read, so shared imports from `_src` trigger rebuilds of the blocks that use them. See [Caching](caching.md).

## Timeout

Each block's compile is limited to 60 seconds (waiting for a build slot does not count). Raise it for large blocks:

```json
{
	"blocks": {
		"timeout": 120
	}
}
```

## Watch mode

Edits to a block's source, or to a shared file it imports, rebuild that block. Changes saved while a block is building are rebuilt afterwards instead of being dropped. A new source file triggers one rescan of block dependencies (so a previously missing import is picked up); unrelated assets never do, and deleting a file only refreshes the blocks that used it.

## Creating blocks

Press `n` in watch mode to scaffold a block, pattern or style variation; see [Watch mode](watch.md).
