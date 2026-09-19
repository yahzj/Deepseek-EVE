/**
 * 英文覆盖层用例（2026-09-19 船长令「希望对游戏进行英语本地化处理」· P2 机制）。
 *
 * 钉三件事：
 * ① **`zh` 缺省零行为变化**：`buildSimContext()` 的舰船名仍是中文，且与显式 `'zh'` 逐字一致；
 * ② **`en` 只改文案**：舰船名按译名表覆盖，而 **id / 数值一字不动**（拿血量 + 星级 + 槽位比）；
 * ③ **覆盖表的 id 必须真实存在**（写错的 id 悄悄无效 ⇒ 英文界面里冒中文，本用例点名）。
 */
import { buildSimContext } from '@whale/data'
import { EN_ANOMALIES, EN_ITEMS, EN_MODULES, EN_SHIPS, EN_SKILLS, EN_WRECKS, ITEMS, MODULES, SHIPS, SKILLS, overlayList } from '@whale/data'
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
    const badShip = Object.keys(EN_SHIPS).filter((id) => !zh.ships.has(id))
    expect(badShip, `舰船覆盖表里这些 id 找不到：${badShip.join(', ')}`).toEqual([])
    const badMod = Object.keys(EN_MODULES).filter((id) => !zh.modules.has(id))
    expect(badMod, `装备覆盖表里这些 id 找不到：${badMod.join(', ')}`).toEqual([])
  })

  it('装备覆盖完整且生效：142 条全覆盖；英文名生效；碎片名跟着装备名走', () => {
    const missing = [...zh.modules.keys()].filter((id) => !(id in EN_MODULES))
    expect(missing, `这些装备还没有英文名：${missing.slice(0, 8).join(', ')}`).toEqual([])
    expect(en.modules.get('mod-turret-kin-1')?.name).toBe('Light Turret MK1 · Kinetic')
    expect(en.modules.get('mod-wh-e-dc')?.name).toBe('Megastructure Damage Control Array')
    // 碎片名派生自装备名 ⇒ 英文下也应是英文（context.ts 里"先覆盖再派生"）
    const zhFrag = [...zh.items.entries()].find(([, d]) => d.name.includes('轻型炮台 MK1'))
    const enFrag = zhFrag ? en.items.get(zhFrag[0]) : undefined
    if (zhFrag && enFrag) expect(enFrag.name).not.toContain('轻型炮台')
  })

  it('en 的装备表：id 集合一致，除 name/description 外逐字段深比一字不动', () => {
    expect([...en.modules.keys()].sort()).toEqual([...zh.modules.keys()].sort())
    const strip = (d: object): string => {
      const rest: Record<string, unknown> = { ...(d as Record<string, unknown>) }
      delete rest.name
      delete rest.description
      return JSON.stringify(rest)
    }
    for (const [id, def] of zh.modules) expect(strip(en.modules.get(id)!), `${id} 的数值字段`).toBe(strip(def))
  })

  it('物品 / 技能覆盖：静态表全覆盖（86 / 79）+ 英文名生效（含派生件走中文的例外）', () => {
    const missItem = ITEMS.filter((d) => !(d.id in EN_ITEMS)).map((d) => d.id)
    expect(missItem, `这些物品还没有英文名：${missItem.slice(0, 8).join(', ')}`).toEqual([])
    const missSkill = SKILLS.filter((d) => !(d.id in EN_SKILLS)).map((d) => d.id)
    expect(missSkill, `这些技能还没有英文名：${missSkill.slice(0, 8).join(', ')}`).toEqual([])
    expect(en.items.get('min-tritanium')?.name).toBe('Tritanium Alloy')
    expect(en.items.get('box-bp-shallow')?.name).toBe('Blueprint Container (Shallow)')
    expect(en.skills.get('gunnery')?.name).toBe('Gunnery')
    expect(en.skills.get('targeting-integration')?.name).toBe('Targeting Integration')
    // ctx 里含**派生件**：碎片（跟着装备名走 ⇒ 已英文化）与残骸（EN_WRECKS 已覆盖）
    const derived = [...zh.items.keys()].filter((id) => !ITEMS.some((d) => d.id === id))
    expect(derived.length, 'ctx 里应有派生物品（残骸/碎片）').toBeGreaterThan(0)
    const frags = derived.filter((id) => id.startsWith('frag-'))
    const wrecks = derived.filter((id) => id.startsWith('wreck-'))
    expect(frags.length, '应有碎片派生件').toBeGreaterThan(0)
    expect(wrecks.length, '应有残骸派生件').toBeGreaterThan(0)
    for (const id of frags) expect(en.items.get(id)?.name, `${id}（碎片应随装备名英文化）`).not.toBe(zh.items.get(id)?.name)
    // 残骸（26 条）本批已覆盖 ⇒ 英文名生效（覆盖表见 EN_WRECKS）
    for (const id of wrecks) expect(en.items.get(id)?.name, `${id}（残骸应有英文名）`).not.toBe(zh.items.get(id)?.name)
  })

  it('异常点覆盖：42 张全覆盖（23 悬赏 + 4 遭遇模板 + 15 虫洞敌卡）+ 英文名生效', () => {
    expect(zh.anomalies.size, '异常点/敌卡总数').toBe(42)
    const missing = [...zh.anomalies.keys()].filter((id) => !(id in EN_ANOMALIES))
    expect(missing, `这些异常点还没有英文名：${missing.slice(0, 8).join(', ')}`).toEqual([])
    expect(en.anomalies.get('ano-maw-hunt')?.name).toBe('Maw Hunt Order')
    expect(en.anomalies.get('enc-pirate-4')?.name).toBe('Deepspace Butcher Fleet')
    const strip = (d: object): string => {
      const rest: Record<string, unknown> = { ...(d as Record<string, unknown>) }
      delete rest.name
      delete rest.description
      return JSON.stringify(rest)
    }
    for (const [id, def] of zh.anomalies) expect(strip(en.anomalies.get(id)!), `异常点 ${id} 的数值字段`).toBe(strip(def))
  })

  it('物品 / 技能：id 集合一致，除 name/description 外逐字段深比一字不动', () => {
    expect([...en.items.keys()].sort()).toEqual([...zh.items.keys()].sort())
    expect([...en.skills.keys()].sort()).toEqual([...zh.skills.keys()].sort())
    const strip = (d: object): string => {
      const rest: Record<string, unknown> = { ...(d as Record<string, unknown>) }
      delete rest.name
      delete rest.description
      return JSON.stringify(rest)
    }
    for (const [id, def] of zh.items) expect(strip(en.items.get(id)!), `物品 ${id} 的数值字段`).toBe(strip(def))
    for (const [id, def] of zh.skills) expect(strip(en.skills.get(id)!), `技能 ${id} 的数值字段`).toBe(strip(def))
  })

  it('覆盖表只许写 name / description 两个字段（防止有人顺手改数值）', () => {
    for (const [id, text] of Object.entries(EN_SHIPS)) {
      const keys = Object.keys(text).sort()
      expect(keys.every((k) => k === 'name' || k === 'description'), `${id} 的覆盖字段：${keys.join(', ')}`).toBe(true)
    }
  })

  it('数组版覆盖（引擎 `ships` 走这条）：zh 原样返回同一数组，en 只改文案、未登记项回退中文', () => {
    expect(overlayList(SHIPS, EN_SHIPS, 'zh'), 'zh 应原样返回同一个数组').toBe(SHIPS)
    const list = overlayList(SHIPS, EN_SHIPS, 'en')
    expect(list, 'en 应产出新数组').not.toBe(SHIPS)
    expect(list.length, '长度不变').toBe(SHIPS.length)
    expect(list.find((d) => d.id === 'sh-thresher')?.name).toBe('Thresher-class Missile Cruiser')
    const before = SHIPS.find((d) => d.id === 'sh-thresher')!
    const after = list.find((d) => d.id === 'sh-thresher')!
    const strip = (d: object): string => {
      const rest: Record<string, unknown> = { ...(d as Record<string, unknown>) }
      delete rest.name
      delete rest.description
      return JSON.stringify(rest)
    }
    expect(strip(after), '除文案外一字不动').toBe(strip(before))
    // 未登记的 id ⇒ 原样回退中文（舰船 43 条已全覆盖，这里用合成表验这条分支）
    const synthetic = [
      { id: 'sh-thresher', name: '长尾鲨级导弹巡洋舰' },
      { id: 'not-registered', name: '未登记项' },
    ]
    const out = overlayList(synthetic, EN_SHIPS, 'en')
    expect(out[0]!.name).toBe('Thresher-class Missile Cruiser')
    expect(out[1]!.name, '未登记项应原样保留').toBe('未登记项')
  })
})
