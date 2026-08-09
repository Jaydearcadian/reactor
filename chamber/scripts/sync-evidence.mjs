import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const chamberRoot = path.resolve(here, '..')
const source = path.join(chamberRoot, 'data', 'm6-essentiality-latest.json')
const destinationDir = path.join(chamberRoot, 'public', 'data')
const destination = path.join(destinationDir, 'm6-essentiality-latest.json')

await mkdir(destinationDir, { recursive: true })

try {
  await stat(source)
  await copyFile(source, destination)
  console.log(`Chamber evidence synced: ${path.relative(chamberRoot, source)} -> ${path.relative(chamberRoot, destination)}`)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
  await rm(destination, { force: true })
  console.log('Chamber evidence: no local M6 result found; development fixture will be used.')
}
