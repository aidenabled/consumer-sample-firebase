import {generateKeyPairSync} from 'node:crypto'
import {readFile, writeFile, unlink} from 'node:fs/promises'
import {spawn} from 'node:child_process'

const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048})
const files = ['functions/.env.local', 'functions/.secret.local']
const originals = await Promise.all(files.map(async path => {
  try {return await readFile(path)} catch (error) {if (error.code === 'ENOENT') return null; throw error}
}))
try {
  await writeFile(files[0], `AIDEN_PUBLIC_KEY=${publicKey.export({type: 'spki', format: 'der'}).toString('base64')}\n`)
  await writeFile(files[1], 'TRIGGER_SECRET=local-demo-trigger-secret\nAIDEN_PASSWORD=local-demo-password\n')
  const child = spawn('node_modules/.bin/firebase', [
    'emulators:exec', '--project', 'demo-consumer-sample', '--only', 'auth,firestore,functions,hosting',
    'node tests/integration.mjs',
  ], {stdio: 'inherit', env: {...process.env, TEST_SIGNING_PRIVATE_KEY: privateKey.export({type: 'pkcs8', format: 'pem'})}})
  // Let the CLI stop its emulators, then restore local files even on interruption.
  const interrupt = () => child.kill('SIGINT')
  const terminate = () => child.kill('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  process.exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', code => resolve(code ?? 1))
  })
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', terminate)
} finally {
  await Promise.all(files.map((path, index) => originals[index] === null ? unlink(path).catch(() => {}) : writeFile(path, originals[index])))
}
