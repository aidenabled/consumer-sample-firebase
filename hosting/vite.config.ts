import {defineConfig, loadEnv} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '')
  // The Hosting emulator applies the same rewrites as the deployed site.
  const target = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:5002'
  return {
    plugins: [react()],
    server: {proxy: {'/api': {target}, '/authorize': {target}, '/aiden': {target}}},
    build: {target: 'es2018'},
  }
})
