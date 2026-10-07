import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = new URL('../../../', import.meta.url)
let render: (kind: 'burst' | 'impact' | 'coating') => string

beforeAll(async () => {
  const result = await build({
    stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {AcidEffect} from './apps/desktop/src/renderer/src/panels/battleAcidFx';
      export const render=kind=>renderToStaticMarkup(React.createElement(AcidEffect,{effect:{key:1,tag:'foe-2',kind,x:400,y:100,size:110,born:0,delay:0}}));`,
      resolveDir: fileURLToPath(root), loader: 'tsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom/server'],
  })
  const output = { exports: {} }
  runInNewContext(result.outputFiles[0]!.text, { module: output, exports: output.exports, require: createRequire(import.meta.url) })
  render = (output.exports as { render: typeof render }).render
})

describe('爆虫专属SVG动画契约', () => {
  it.each(['burst', 'impact', 'coating'] as const)('%s有独立SVG形状，主题色可用，没有光束或炮弹', kind => {
    const html = render(kind)
    expect(html).toContain('<svg')
    expect(html).toContain('<path')
    expect(html).toContain(`data-acid-kind="${kind}"`)
    expect(html).toContain('data-acid-tag="foe-2"')
    expect(html).toContain('left:400px;top:100px')
    expect(html).toContain('rgb(var(--wui-tone-C')
    expect(html).not.toMatch(/NaN|undefined|app-bts-beamline|app-bts-bolt|filter=/)
  })

  it('专属事件在通用弹道之前独立消费，死亡爆炸不重复', () => {
    const text = readFileSync(new URL('apps/desktop/src/renderer/src/panels/BattleScreen.tsx', root), 'utf8')
    const special = text.slice(text.indexOf('if (fx.acidBurst)'), text.indexOf('if (fx.blink)'))
    expect(special).toContain('continue')
    expect(special).toContain('resolveBoltAnchors')
    expect(special).toContain("kind: 'burst'")
    expect(special).not.toContain('boltsRef.current.push')
    expect(special).not.toContain('flashRef.current.push')
    expect(text).toContain('boomLive && !acidDeath')
    expect(text).toContain('acidDeath && corpseOn ? { opacity: 0 }')
  })

  it('专属动画只动transform和透明度，减少动态时不扩散，不增加全屏效果', () => {
    const css = readFileSync(new URL('apps/desktop/src/renderer/src/styles.css', root), 'utf8')
    const animation = css.slice(css.indexOf('.app-bts-acid {'), css.indexOf('.app-bts-lane.is-defeat::after'))
    expect(animation).toContain('@media (prefers-reduced-motion: reduce)')
    expect(animation).toContain('animation-name: app-bts-acid-coat')
    expect(animation).toContain('pointer-events: none')
    expect(animation).not.toMatch(/filter:|box-shadow:|100vw|100vh/)
    for (const body of animation.matchAll(/@keyframes[^}]+(?:}\s*[^@]+)?/g)) {
      expect(body[0]).not.toMatch(/\b(?:width|height|left|top):/)
    }
    expect(css).toContain('contain: layout paint')
  })
})
