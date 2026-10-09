import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { StellarSystem } from '../src/stellarTypes'
import { stellarViewBox, STELLAR_MAP_CENTER } from '../../../apps/desktop/src/renderer/src/panels/stellarMapView'

const root = new URL('../../../', import.meta.url)
const scope = { exports: {} as { drawStellarScene: (...args: any[]) => void; stellarSceneProjection: (...args: any[]) => { scale: number; x: number; y: number } }, require: () => ({ stellarViewBox, STELLAR_MAP_CENTER }) }
runInNewContext(ts.transpileModule(readFileSync(new URL('apps/desktop/src/renderer/src/panels/stellarSceneDraw.ts', root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, scope)
const { drawStellarScene, stellarSceneProjection } = scope.exports
const world: StellarSystem = { id: 'scene', generationVersion: 1, seed: 7, kind: 'binary', starClass: 'yellow', routeMinutes: 10,
  stars: [{ x: 475, y: 350, radius: 15 }, { x: 525, y: 350, radius: 12 }],
  bodies: [{ planetId: 'a', ordinal: 1, kind: 'rocky', orbit: 170, x: 670, y: 350 }, { planetId: 'b', ordinal: 2, kind: 'gas', orbit: 240, x: 260, y: 350 }] }
const colors = { background: '#0c121b', star: '#ffd06e', orbit: '#708496', accent: '#4fd8c4', text: '#ffffff' }
function canvas() {
  return Object.assign(Object.fromEntries(['clearRect', 'fillRect', 'drawImage', 'save', 'restore', 'translate', 'scale', 'beginPath', 'arc', 'stroke', 'moveTo', 'lineTo', 'fill', 'rotate'].map(id => [id, vi.fn()])), { globalAlpha: 1 })
}
describe('静态星系场景与素材锚点', () => {
  it.each([{ zoom: 1, pan: { x: 0, y: 0 } }, { zoom: 4, pan: { x: 100, y: -50 } }])('Canvas投影与SVG meet世界视口同源 %j', view => {
    const box = stellarViewBox(view), transform = stellarSceneProjection(view, 815, 260)
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    expect(point.x * transform.scale + transform.x).toBeCloseTo(815 / 2)
    expect(point.y * transform.scale + transform.y).toBeCloseTo(260 / 2)
  })
  it('同公开输入产生同场景，不修改星系或消费全局随机数', () => {
    const a = canvas(), b = canvas(), before = structuredClone(world)
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('不得随机') })
    try {
      for (const ctx of [a, b]) drawStellarScene(ctx, world, { zoom: 1, pan: { x: 0, y: 0 } }, 'a', 978, 320, colors)
      expect((a.arc as any).mock.calls).toEqual((b.arc as any).mock.calls)
      expect((a.fillRect as any).mock.calls).toEqual((b.fillRect as any).mock.calls)
      expect(world).toEqual(before)
    } finally { random.mockRestore() }
  })
  it('流浪星系不画中心恒星/轨道，双星各读真实中心，PNG尚未加载也可渲染', () => {
    const a = canvas()
    drawStellarScene(a, { ...world, kind: 'rogue', stars: [], starClass: 'none' }, { zoom: 1, pan: { x: 0, y: 0 } }, undefined, 800, 300, colors)
    expect(a.arc).not.toHaveBeenCalled()
    const b = canvas()
    drawStellarScene(b, world, { zoom: 1, pan: { x: 0, y: 0 } }, undefined, 800, 300, colors)
    expect(b.translate).toHaveBeenCalledWith(475, 350)
    expect(b.translate).toHaveBeenCalledWith(525, 350)
  })
  it('中子星具有公开类型的束流，静态绘制结束恢复透明度', () => {
    const ctx = canvas()
    drawStellarScene(ctx, { ...world, kind: 'neutron', starClass: 'neutron' }, { zoom: 1, pan: { x: 0, y: 0 } }, undefined, 800, 300, colors)
    expect(ctx.rotate).toHaveBeenCalledWith(-.35)
    expect(ctx.globalAlpha).toBe(1)
  })
  it('七类天体与恒星PNG引用均落本地，指纹/尺寸/本体比例对应真实导出', () => {
    const manifest = JSON.parse(readFileSync(new URL('apps/desktop/src/renderer/src/assets/stellar/manifest.json', root), 'utf8'))
    expect(manifest.samples).toHaveLength(12)
    for (const row of manifest.samples) {
      const bytes = readFileSync(new URL(`apps/desktop/src/renderer/src/assets/stellar/${row.id}.png`, root))
      expect(bytes.readUInt32BE(16)).toBe(row.width)
      expect(bytes.readUInt32BE(20)).toBe(row.height)
      expect(bytes[25]).toBe(6)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256)
    }
    const scene = readFileSync(new URL('apps/desktop/src/renderer/src/panels/StellarScene.tsx', root), 'utf8')
    expect(scene).not.toMatch(/setInterval|\.traits|\.deposits|\.hazard|\.habitability/)
    const assets = readFileSync(new URL('apps/desktop/src/renderer/src/ui/stellarAssets.ts', root), 'utf8')
    expect(assets).toContain('gas: { url: gas, span: 800 / 256 }')
    expect(assets).not.toContain('https://')
  })
})
