import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { FOE_SHIPS, FOE_DRONES, ANOMALIES } from '@whale/data'
import { FOE_MOUNTS, enemyParameterOf } from '../src/index'
import { ENEMY_FILES, ENEMY_TABLES, ENEMY_FIELDS } from '../../../tools/data-editor-enemy-schema'
import { planDocuments, rowsOf, validateDocument } from '../../../tools/data-editor-schema'
import { enemyEnginePreview } from '../../../tools/data-editor-enemy-preview'
import type { DataDocument, DataTable, EnemyPreviewRequest } from '../../../tools/data-editor-contract'

const docs = Object.fromEntries(ENEMY_TABLES.map(table => [table, JSON.parse(readFileSync(new URL(`../../../${ENEMY_FILES[table]}`, import.meta.url), 'utf8'))])) as Record<DataTable, DataDocument>
const request = (table: EnemyPreviewRequest['table'], id: string, mode: EnemyPreviewRequest['mode'] = 'base'): EnemyPreviewRequest => ({ table, id, mode, depth: 1, role: 'ordinary' })
describe('敌人编辑契约与真实引擎', () => {
  it('全部六表、字段与来源匹配，已有数值不因合法值域误报', () => {
    for (const table of ENEMY_TABLES) expect(validateDocument(docs[table], table), table).toEqual([])
    expect(rowsOf('foeShips', docs.foeShips).length).toBe(ENEMY_FIELDS.foeShips.length)
    expect(rowsOf('bounties', docs.bounties).some(row => row.fields.some(field => field.path.endsWith('_input0')))).toBe(true)
  })
  it('有限值、未知主键/字段、整数、三层占比和射程均严格拒绝', () => {
    for (const patch of [ { hp: NaN }, { id: 'missing' }, { unknown: 1 }, { split_s: 0.9 }, { rangeMinM: 100000 }, { gunCount: 1.5 } ]) {
      const changed = structuredClone(docs.foeShips)
      Object.assign(changed.groups.parameters[0], patch)
      expect(validateDocument(changed, 'foeShips').length).toBeGreaterThan(0)
    }
    expect(() => enemyParameterOf({ format: 'invalid' }, 'x', 'a')).toThrow()
  })
  it('数字草稿不改原文且不会改写结构/等级/公式', () => {
    const row = rowsOf('foeShips', docs.foeShips).find(row => row.values.hp !== undefined)!
    const before = JSON.stringify(docs)
    expect(planDocuments(docs, [{ table: 'foeShips', id: row.id, path: 'hp', value: Number(row.values.hp) + 1 }]).issues).toEqual([])
    expect(JSON.stringify(docs)).toBe(before)
    for (const path of ['hullClassTier', 'ship', '__proto__.hp']) expect(planDocuments(docs, [{ table: 'foeShips', id: row.id, path, value: 1 }]).issues.length).toBeGreaterThan(0)
  })
  it('入侵遇袭与旗舰血池读数使用当前引擎覆写', () => {
    const base = enemyEnginePreview(request('invasionFleets', 'corona-nexus'))
    const ambush = enemyEnginePreview(request('invasionFleets', 'corona-nexus', 'ambush'))
    expect(ambush.rows.reduce((n, row) => n + row.hp, 0)).toBeCloseTo(base.rows.reduce((n, row) => n + row.hp, 0) * 0.75)
    const flagship = enemyEnginePreview(request('invasionFleets', 'corona-nexus', 'flagship'))
    expect(flagship.rows.some(row => row.hp === 150000)).toBe(true)
    expect(flagship.rows.some(row => row.wave === 4)).toBe(true)
  })
  it('三族十二张入侵卡全覆盖，异形工厂卡与共用数字可编辑', () => {
    expect(ANOMALIES.filter(card => card.region === 'inv').map(card => card.id).sort()).toEqual(ENEMY_FIELDS.invasionFleets.filter(row => row.id !== 'alien-common').map(row => row.id).sort())
    const alien = rowsOf('invasionFleets', docs.invasionFleets).find(row => row.id === 'alien-broodmother')!
    expect(alien.fields.find(field => field.path === 'scale')?.writable).toBe(true)
    expect(alien.fields.find(field => field.path === 'ships_0_count')?.group).toContain('酸液爆虫')
    expect(enemyEnginePreview(request('invasionFleets', 'alien-broodmother', 'flagship')).rows.some(row => row.hp === 150000)).toBe(true)
  })
  it('全部舰级、机群和挂载件均有可追溯参数；共用数值不重复复制', () => {
    expect(FOE_SHIPS.filter(ship => !ENEMY_FIELDS.foeShips.some(row => row.id === ship.id))).toEqual([])
    expect(FOE_DRONES.filter(drone => !drone.id.startsWith('foe-drone-g-bee-') && !ENEMY_FIELDS.foeDrones.some(row => row.id === drone.id))).toEqual([])
    expect(Object.keys(FOE_MOUNTS).filter(id => !ENEMY_FIELDS.foeMounts.some(row => row.id === id))).toEqual([])
    expect(ENEMY_FIELDS.foeShips.some(row => row.id === 'c-family-resists')).toBe(true)
    expect(ENEMY_FIELDS.foeDrones.some(row => row.id === 'g-bee-shared')).toBe(true)
  })
  it('信号空间与未来虫洞不同派生，第一至第十层可读', () => {
    for (const mode of ['signal', 'wormhole'] as const) for (const depth of [1, 5, 10]) {
      const result = enemyEnginePreview({ ...request('wormholeFleets', 'wh-pirate-scout', mode), depth })
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows.every(row => row.hp > 0 && Number.isFinite(row.dps))).toBe(true)
    }
  })
})
describe.skipIf(process.env.ENEMY_MIGRATION_VERIFY !== '1')('敌人迁移全值验收，仅显式运行', () => {
  it('舰级、机群、挂载件、完整卡目录与迁移前逐值一致', () => {
    const old = JSON.parse(readFileSync(new URL('./fixtures/enemy-parameters-20261006.json', import.meta.url), 'utf8'))
    expect(JSON.parse(JSON.stringify({ ships: FOE_SHIPS, drones: FOE_DRONES, cards: ANOMALIES, mounts: FOE_MOUNTS }))).toEqual(old)
  })
})
