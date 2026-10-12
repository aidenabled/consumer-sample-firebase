import {initializeApp} from 'firebase/app'
import {connectAuthEmulator, getAuth} from 'firebase/auth'

const configuredProject = import.meta.env.VITE_FIREBASE_PROJECT_ID
export const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true' ||
  !configuredProject
const projectId = configuredProject || (useEmulators ? 'demo-consumer-sample' : '')
if (!projectId || (!useEmulators && projectId.startsWith('demo-'))) {
  throw new Error('Set your Firebase web app environment variables before building for deployment.')
}
const app = initializeApp({
  projectId,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (useEmulators ? 'demo-api-key' : ''),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || undefined,
})
export const auth = getAuth(app)
if (useEmulators) connectAuthEmulator(auth, `http://${window.location.hostname}:9099`, {disableWarnings: true})
