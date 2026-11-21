import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildInfoDefine } from '../build-info'
import { releaseRightsBannerPlugin, releaseRightsPlugin } from '../release-rights'

const repository = fileURLToPath(new URL('../..', import.meta.url))

/** 正式游戏本机验收入口；不修改公开网页或参赛构建的权限与发布配置。 */
export default defineConfig({
  root: resolve(repository, 'web'),
  base: '/',
  plugins: [react(), releaseRightsPlugin(resolve(repository, 'web'))],
  worker: { plugins: () => [releaseRightsBannerPlugin()] },
  resolve: {
    alias: {
      '@whale/core': resolve(repository, 'packages/core/src/index.ts'),
      '@whale/data': resolve(repository, 'packages/data/src/index.ts'),
      '@whale/ui': resolve(repository, 'packages/ui/src/index.tsx'),
    },
    dedupe: ['@carbon/icons-react', 'klinecharts', 'lucide-react', 'react', 'react-dom'],
  },
  define: buildInfoDefine(),
  server: { host: '127.0.0.1', strictPort: true, fs: { allow: [repository] } },
  build: {
    outDir: resolve(repository, 'tools/_ui-artifacts/player-station-game-dist'),
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
  },
})
