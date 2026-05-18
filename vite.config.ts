import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'development' ? '/' : '/ymnngis/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm']
  }
}))
