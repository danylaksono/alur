import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Netlify serves the app at the domain root. GitHub Pages needs the
  // repository subpath and opts into it through the deployment workflow.
  base: mode === 'github-pages' ? '/ymnngis/' : '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm']
  }
}))
