// TypeScript keeps the source's ".ts" import specifiers in emitted declarations; point them at ".js"
// so consumers resolve the declarations without allowImportingTsExtensions.
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

async function* files(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name)
		if (entry.isDirectory()) {
			yield* files(path)
		} else if (path.endsWith(".d.ts")) {
			yield path
		}
	}
}

for await (const path of files(process.argv[2] ?? "dist/types")) {
	const source = await readFile(path, "utf8")
	const fixed = source.replace(/(["'])(\.{1,2}\/[^"']+)\.ts\1/g, "$1$2.js$1")
	if (fixed !== source) {
		await writeFile(path, fixed)
	}
}
