import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = new URL('../../../', import.meta.url)
let render: (props: { shipId: string; acceleration?: 'boost' | 'charge'; engine?: boolean; flip?: boolean }) => string

beforeAll(async () => {
  const result = await build({
    stdin: { contents: `import React from 'react';import{renderToStaticMarkup}from'react-dom/server';
      import{BattleShipSprite}from'./apps/desktop/src/renderer/src/panels/battleShipFx';
      export const render=props=>renderToStaticMarkup(React.createElement(BattleShipSprite,{size:170,...props}));`,
      resolveDir: fileURLToPath(root), loader: 'tsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom/server'],
    plugins: [{ name: 'test-locale', setup(api) { api.onLoad({ filter: /[\\/]i18n[\\/]locale\.tsx$/ }, () => ({ contents: 'export const tr=id=>id;export const isEn=()=>false;', loader: 'js' })) } }],
  })
  const output = { exports: {} }
  runInNewContext(result.outputFiles[0]!.text, { module: output, exports: output.exports, require: createRequire(import.meta.url) })
  render = (output.exports as { render: typeof render }).render
})

describe('战斗专用加速舰影', () => {
  it('未加速保留普通尾焰和舰形，不影响默认舰影', () => {
    const text = render({ shipId: 'sh-megalodon' })
    expect(text).toContain('app-sprite-exhaust')
    expect(text).not.toContain('app-bts-acceleration')
    expect(text).toContain('width:170px;height:78px')
  })

  it.each(['boost', 'charge'] as const)('%s使用真实喷口长尾焰，替代普通焰而非重复覆盖', acceleration => {
    const text = render({ shipId: 'sh-megalodon', acceleration })
    expect(text).toContain(`data-acceleration="${acceleration}"`)
    expect(text).toContain('accel-core')
    expect(text).toContain('accel-edge')
    expect(text).not.toContain('app-sprite-exhaust')
    expect(text).not.toMatch(/NaN|undefined|filter=/)
  })

  it('无喷口有机舰只画速度线，冲锋的舰艏尖线与我方不同', () => {
    const charge = render({ shipId: 'foe-alien-acid-burster', acceleration: 'charge' })
    expect(charge).toContain('accel-lines')
    expect(charge).toContain('accel-bow')
    expect(charge).not.toContain('accel-core')
    expect(charge).not.toContain('app-sprite-exhaust')
    const boost = render({ shipId: 'sh-wh-c-frigate', acceleration: 'boost' })
    expect(boost).toContain('accel-lines')
    expect(boost).not.toMatch(/accel-core|accel-bow/)
  })

  it('镜像跟随舰体，无引擎模式不出加速效果', () => {
    expect(render({ shipId: 'sh-megalodon', acceleration: 'boost', flip: true })).toContain('scale(-1, 1)')
    expect(render({ shipId: 'sh-megalodon', acceleration: 'boost', engine: false })).not.toContain('app-bts-acceleration')
  })

  it('三处战斗舰影都取视图单点，减少动态保留静态图形', () => {
    const screen = readFileSync(new URL('apps/desktop/src/renderer/src/panels/BattleScreen.tsx', root), 'utf8')
    expect(screen.match(/<BattleShipSprite\b/g)).toHaveLength(3)
    expect(screen).toContain("acceleration={u.boosting ? 'boost'")
    expect(screen).toContain('arcs.foeChargingTags.includes(tag)')
    const css = readFileSync(new URL('apps/desktop/src/renderer/src/styles.css', root), 'utf8')
    const start = css.indexOf('.app-bts-ship {')
    const rules = css.slice(start, css.indexOf('.app-battle-note {', start))
    expect(rules).toContain('prefers-reduced-motion: reduce')
    expect(rules).toContain('animation: none; opacity: .9')
    expect(rules).not.toMatch(/filter:|box-shadow:|animation-fill-mode:|100vw|100vh/)
  })
})
