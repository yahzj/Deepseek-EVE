import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))
const repository = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  root,
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { fs: { allow: [repository] }, strictPort: true },
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: { input: { main: fileURLToPath(new URL('index.html', import.meta.url)), wheel: fileURLToPath(new URL('wheel-fixture.html', import.meta.url)) } },
  },
})
