import {loadEnv} from 'vite'
import {resolve} from 'node:path'
const env = {...loadEnv('production', resolve('hosting'), 'VITE_'), ...process.env}
const required = ['VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_APP_ID']
if (env.VITE_USE_EMULATORS !== 'false' || env.VITE_FIREBASE_PROJECT_ID?.startsWith('demo-') || required.some(key => !env[key])) {
  console.error('Deployment requires VITE_USE_EMULATORS=false and your own Firebase web app configuration in hosting/.env.production.local.')
  process.exit(1)
}
