import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const chamberRoot = path.resolve(here, '..')
const latest = path.join(chamberRoot, 'data', 'm6-essentiality-latest.json')
const archiveDir = path.join(chamberRoot, 'data', 'archive')
const destinationDir = path.join(chamberRoot, 'public', 'data')
const destination = path.join(destinationDir, 'm6-essentiality-latest.json')

await mkdir(destinationDir, { recursive: true })

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function newestArchive() {
  try {
    const entries = await readdir(archiveDir)
    const candidates = entries
      .filter((name) => /^m6-essentiality-.*\.json$/.test(name))
      .sort()
      .reverse()
    return candidates.length ? path.join(archiveDir, candidates[0]) : null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

let source = null
if (await exists(latest)) source = latest
if (!source) source = await newestArchive()

if (source) {
  await copyFile(source, destination)
  console.log(`Chamber evidence synced: ${path.relative(chamberRoot, source)} -> ${path.relative(chamberRoot, destination)}`)
} else {
  await rm(destination, { force: true })
  console.log('Chamber evidence: no M6 result or archive found; development fixture will be used.')
}
