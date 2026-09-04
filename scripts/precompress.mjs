import { readdir, readFile, writeFile } from 'node:fs/promises'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const br = promisify(brotliCompress)
const gz = promisify(gzip)
const root = resolve(process.argv[2] ?? 'dist')

async function compressDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) await compressDirectory(file)
    else if (/\.(?:html|css|js|json|svg|txt|xml|wasm|webmanifest)$/.test(entry.name)) {
      const bytes = await readFile(file)
      if (bytes.length < 1024) continue
      await Promise.all([
        br(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).then(result => writeFile(`${file}.br`, result)),
        gz(bytes, { level: 9 }).then(result => writeFile(`${file}.gz`, result)),
      ])
    }
  }
}
await compressDirectory(root)
