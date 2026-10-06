import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
const root = resolve(__dirname, '../..')
const alias = {
  '@whale/core': resolve(root, 'packages/core/src/index.ts'),
  '@whale/data': resolve(root, 'packages/data/src/index.ts'),
}
export default defineConfig({
  main: { resolve: { alias }, build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } } },
  renderer: { root: resolve(__dirname, 'src/renderer'), plugins: [react()], build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } } },
})
