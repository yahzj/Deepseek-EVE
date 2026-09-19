/**
 * 英文覆盖层用例（2026-09-19 船长令「希望对游戏进行英语本地化处理」· P2 机制）。
 *
 * 钉三件事：
 * ① **`zh` 缺省零行为变化**：`buildSimContext()` 的舰船名仍是中文，且与显式 `'zh'` 逐字一致；
 * ② **`en` 只改文案**：舰船名按译名表覆盖，而 **id / 数值一字不动**（拿血量 + 星级 + 槽位比）；
 * ③ **覆盖表的 id 必须真实存在**（写错的 id 悄悄无效 ⇒ 英文界面里冒中文，本用例点名）。
 */
import { buildSimContext } from '@whale/data'
import { EN_SHIPS } from '@whale/data'
import { describe, expect, it } from 'vitest'

const zh = buildSimContext()
const zhExplicit = buildSimContext('zh')
const en = buildSimContext('en')

describe('英文覆盖层（P2）', () => {
  it('zh 缺省 = 显式 zh：名称逐字相同（工具/测试/模拟读数不受影响）', () => {
    for (const id of Object.keys(EN_SHIPS)) {
      expect(zh.ships.get(id)?.name, `${id} 的中文名`).toBe(zhExplicit.ships.get(id)?.name)
    }
    expect(zh.ships.get('sh-thresher')?.name).toBe('长尾鲨级导弹巡洋舰')
  })

  it('en：舰船名按译名表覆盖（例：长尾鲨级 → Thresher-class Missile Cruiser）', () => {
    expect(en.ships.get('sh-thresher')?.name).toBe('Thresher-class Missile Cruiser')
    expect(en.ships.get('sh-xuanwu')?.name).toBe('Leatherback-class Heavy Flagship')
    expect(en.ships.get('sh-wh-a-cruiser')?.name).toBe('Raider Heavy Assault Cruiser')
  })

  it('en 只改文案：id 集合一致，且除 name/description 外**逐字段深比**一字不动', () => {
    expect([...en.ships.keys()].sort()).toEqual([...zh.ships.keys()].sort())
    /** 去掉 name / description 后整体序列化比对（比逐字段点名更严：新增字段也管） */
    const strip = (d: object): string => {
      const rest: Record<string, unknown> = { ...(d as Record<string, unknown>) }
      delete rest.name
      delete rest.description
      return JSON.stringify(rest)
    }
    let checked = 0
    for (const [id, def] of zh.ships) {
      const other = en.ships.get(id)!
      expect(strip(other), `${id} 的数值字段`).toBe(strip(def))
      if (id in EN_SHIPS) {
        expect(other.name, `${id} 的英文名`).not.toBe(def.name)
        checked += 1
      }
    }
    expect(checked, '被覆盖的舰船条数').toBe(Object.keys(EN_SHIPS).length)
  })

  it('覆盖表 id 必须都在内容表里（写错的 id 会让英文界面冒中文）', () => {
    const bad = Object.keys(EN_SHIPS).filter((id) => !zh.ships.has(id))
    expect(bad, `英文覆盖表里这些 id 在舰船表里找不到：${bad.join(', ')}`).toEqual([])
  })

  it('覆盖表只许写 name / description 两个字段（防止有人顺手改数值）', () => {
    for (const [id, text] of Object.entries(EN_SHIPS)) {
      const keys = Object.keys(text).sort()
      expect(keys.every((k) => k === 'name' || k === 'description'), `${id} 的覆盖字段：${keys.join(', ')}`).toBe(true)
    }
  })
})
