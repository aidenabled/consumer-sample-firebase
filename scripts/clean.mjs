import {existsSync, readdirSync, rmSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generated = [
  'functions/lib',
  'hosting/dist',
  '.firebase',
  'hosting/node_modules/.tmp',
  'hosting/node_modules/.vite',
  'node_modules/.vite',
]
for (const directory of ['', 'functions', 'hosting']) {
  for (const name of readdirSync(join(root, directory))) {
    if (/^(firebase|firestore|database|pubsub|ui)-debug(?:\..+)?\.log$/.test(name) || name.endsWith('.tsbuildinfo')) {
      generated.push(join(directory, name))
    }
  }
}

let removed = 0
for (const relative of generated) {
  const path = join(root, relative)
  if (!existsSync(path)) continue
  rmSync(path, {recursive: true, force: true})
  console.log(`Removed ${relative}`)
  removed++
}
console.log(removed ? 'Generated files cleaned.' : 'No generated files to clean.')
