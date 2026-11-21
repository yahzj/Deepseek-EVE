import type { Plugin } from 'vite'

/** 仅构建时适配两个现有 Worker，不修改引擎或另写一份推演规则。 */
export function inlineToyWorkers(code: string): string {
  const workers = ['signalAuto', 'bountyWin']
  let imports = ''
  for (const name of workers) {
    const original = `new Worker(new URL('./${name}.worker.ts', import.meta.url), { type: 'module' })`
    if (code.split(original).length !== 2) throw new Error(`参赛 Worker 接线发生变化，请复核：${name}`)
    const constructor = `Toy_${name}Worker`
    imports += `import ${constructor} from './${name}.worker.ts?worker&inline'\n`
    code = code.replace(original, `new ${constructor}()`)
  }
  return imports + code
}

/** Vite 处理完资源后，把入口变成 file:// 可加载的普通脚本。 */
export function localToyHtml(html: string): string {
  return html
    .replace(/content="(default-src[^"]*)"/, (_tag, policy: string) => `content="${policy}; font-src 'self' data:; worker-src blob: data:"`)
    .replace(/<script\b([^>]+)>/g, (_tag, attrs: string) => {
      if (!/\btype="module"/.test(attrs)) return `<script${attrs}>`
      if (!/\bsrc="\.\/assets\/game\.js"/.test(attrs)) throw new Error('参赛入口脚本路径不符')
      return `<script${attrs.replace(/\s+type="module"/, '').replace(/\s+crossorigin(?:="[^"]*")?/, '')} defer>`
    })
    .replace(/(<link\b[^>]*rel="stylesheet"[^>]*)\s+crossorigin(?:="[^"]*")?/g, '$1')
}

export function toyLocalPlugin(): Plugin {
  return {
    name: 'whale-toy-local',
    enforce: 'pre',
    transform(code, id) {
      if (id.replace(/\\/g, '/').endsWith('/renderer/src/game/engine.ts')) {
        return { code: inlineToyWorkers(code), map: null }
      }
    },
    transformIndexHtml: { order: 'post', handler: localToyHtml },
  }
}
