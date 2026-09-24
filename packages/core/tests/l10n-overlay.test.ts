/**
 * 英文覆盖层用例（2026-09-19 船长令「希望对游戏进行英语本地化处理」· P2 机制）。
 *
 * 钉三件事：
 * ① **`zh` 缺省零行为变化**：`buildSimContext()` 的舰船名仍是中文，且与显式 `'zh'` 逐字一致；
 * ② **`en` 只改文案**：舰船名按译名表覆盖，而 **id / 数值一字不动**（拿血量 + 星级 + 槽位比）；
 * ③ **覆盖表的 id 必须真实存在**（写错的 id 悄悄无效 ⇒ 英文界面里冒中文，本用例点名）。
 */
import { buildSimContext } from '@whale/data'
import { EN_ANOMALIES, EN_BELTS, EN_COMMS_FACTIONS, EN_FOE_SHIPS, EN_GALAXIES, EN_ITEMS, EN_MATTER_TECH, EN_MODULES, EN_SHIPS, EN_SKILLS, EN_STATIONS, EN_TRAVEL_EVENTS, EN_WRECKS, ITEMS, MODULES, SHIPS, SKILLS, overlayList } from '@whale/data'
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
    expect(en.ships.get('sh-xuanwu')?.name).toBe('Leatherback-class Heavy Battleship')
    expect(en.ships.get('sh-wh-a-cruiser')?.name).toBe('Raider Heavy Assault Cruiser')
  })

  /**
   * **卡片条目上的「敌方挂载件」双语名对**（2026-09-24 船长两件新挂载件批）：
   * 挂载件名的目录表在 core（拿不到 data 包的译名表）⇒ 由 `overlayCardFoeMounts` 往卡条目上
   * 附一份 `foeMountNamePairs`（与 `mounts` 下标对齐），显示层按语言挑一列。
   *
   * 钉三件事：① en 卡上**有**这份名对、且英文列是真英文；② **`mounts`（引擎读的 id）一字不动**；
   * ③ zh 卡上**没有**这个字段（缺省 = 老行为，显示层回落中文名数组）。
   */
  it('en：卡条目带「挂载件双语名对」，且 mounts 的 id 一个不动（zh 侧不写该字段）', () => {
    const zhCard = zh.anomalies.get('wh-pirate-scout')!
    const enCard = en.anomalies.get('wh-pirate-scout')!
    const zhSlot = zhCard.ships![0]!
    const enSlot = enCard.ships![0]!
    // ① en 有名对、英文列 = 目录里的 en（本次两件都填了；旧八件缺 en ⇒ 退化成中文）
    expect(zhSlot.foeMountNamePairs, 'zh 侧不写该派生字段').toBeUndefined()
    const pairs = enSlot.foeMountNamePairs!
    expect(pairs.map((p) => p[1]), '英文列').toContain('Attitude Gyro')
    // ② 引擎读的 mounts 逐字不变（语言只影响显示）
    expect(enSlot.mounts).toEqual(zhSlot.mounts)
    expect(enSlot.mounts).toEqual(['foe-mount-charge-pirate', 'foe-mount-gyro-stabilizer'])
    // ③ 下标对齐：名对第 i 项 = 该 id 的那一件
    expect(pairs.length).toBe(enSlot.mounts!.length)
    expect(pairs[1]![0], '第 2 件的中文名').toBe('姿态陀螺仪')
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
    expect(zh.anomalies.size, '异常点/敌卡总数').toBe(46) // ⚠ 2026-09-24：42 → 44（H 族墨潮帮两张入侵卡）
    const missing = [...zh.anomalies.keys()].filter((id) => !(id in EN_ANOMALIES))
    expect(missing, `这些异常点还没有英文名：${missing.slice(0, 8).join(', ')}`).toEqual([])
    expect(en.anomalies.get('ano-maw-hunt')?.name).toBe('Maw Hunt Order')
    expect(en.anomalies.get('enc-pirate-4')?.name).toBe('Deepspace Butcher Fleet')
    // 深比时**排除 ships**——卡片内嵌敌舰名本就该换（由上面那条"嵌套覆盖"用例单独逐字段核对）
    const strip = (d: object): string => {
      const rest: Record<string, unknown> = { ...(d as Record<string, unknown>) }
      delete rest.name
      delete rest.description
      delete rest.ships
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

  it('蓝图（派生）：装备/物品蓝图与舰船蓝图全覆盖，且英文名由产物名拼出', () => {
    const missBp = [...zh.blueprints.keys()].filter((id) => !en.blueprints.has(id))
    expect(missBp, '蓝图 id 集合应一致').toEqual([])
    const missSbp = [...zh.shipBlueprints.keys()].filter((id) => !en.shipBlueprints.has(id))
    expect(missSbp, '舰船蓝图 id 集合应一致').toEqual([])
    // 装备蓝图：<产物英文名> Blueprint
    expect(en.blueprints.get('bp-miner-1')?.name).toBe('Reinforced Mining Laser MK1 Blueprint')
    // 舰船蓝图：<舰级段> Blueprint
    expect(en.shipBlueprints.get('sbp-pioneer')?.name).toBe('Pioneer-class Blueprint')
    // 派生覆盖率：能反查到产物的蓝图都必须有英文名（否则说明产物表缺名）
    const noEn = [...zh.blueprints.values()].filter((bp) => !en.blueprints.get(bp.id)?.name.includes('Blueprint'))
    expect(noEn.slice(0, 5).map((bp) => bp.id), '这些蓝图没派生到英文名').toEqual([])
    const strip = (d: object): string => {
      const rest: Record<string, unknown> = { ...(d as Record<string, unknown>) }
      delete rest.name
      delete rest.description
      return JSON.stringify(rest)
    }
    for (const [id, def] of zh.blueprints) expect(strip(en.blueprints.get(id)!), `蓝图 ${id} 的数值字段`).toBe(strip(def))
    for (const [id, def] of zh.shipBlueprints) expect(strip(en.shipBlueprints.get(id)!), `舰船蓝图 ${id} 的数值字段`).toBe(strip(def))
  })

  it('卡片内嵌敌舰（嵌套覆盖）：24 种被引用的敌舰全部英文化，且编成/倍率一字不动', () => {
    const zhFoes = new Map<string, string>()
    for (const def of zh.anomalies.values()) for (const slot of def.ships ?? []) zhFoes.set(slot.ship.id, slot.ship.name)
    expect(zhFoes.size, '卡片引用的 distinct 敌舰数').toBeGreaterThan(20)
    const missing = [...zhFoes.keys()].filter((id) => !(id in EN_FOE_SHIPS))
    expect(missing, `这些敌舰还没有英文名：${missing.join(', ')}`).toEqual([])
    // 名字换掉了，而"编成"（每张卡的 ships 长度与倍率）一字不动
    for (const [id, def] of zh.anomalies) {
      const other = en.anomalies.get(id)!
      expect((other.ships ?? []).length, `${id} 的编成长度`).toBe((def.ships ?? []).length)
      for (let i = 0; i < (def.ships ?? []).length; i++) {
        const a = def.ships![i]!
        const b = other.ships![i]!
        expect(b.ship.id, `${id} 第 ${i} 位敌舰 id`).toBe(a.ship.id)
        expect(b.hpMul, `${id} 第 ${i} 位血量倍率`).toBe(a.hpMul)
        expect(b.dmgMul, `${id} 第 ${i} 位伤害倍率`).toBe(a.dmgMul)
        expect(b.wave, `${id} 第 ${i} 位波次`).toBe(a.wave)
        expect(b.ship.name, `${id} 第 ${i} 位敌舰名`).not.toBe(a.ship.name)
      }
    }
  })

  it('星图 / 矿带 / 站点 / 势力：全覆盖 + 英文名生效 + 数值深比一字不动', () => {
    const missing: string[] = []
    for (const id of zh.galaxies.keys()) if (!(id in EN_GALAXIES)) missing.push(`星系 ${id}`)
    for (const id of zh.belts.keys()) if (!(id in EN_BELTS)) missing.push(`矿带 ${id}`)
    for (const id of zh.stations.keys()) if (!(id in EN_STATIONS)) missing.push(`站点 ${id}`)
    for (const id of zh.commsFactions.keys()) if (!(id in EN_COMMS_FACTIONS)) missing.push(`势力 ${id}`)
    expect(missing, `这些还没英文名：${missing.slice(0, 10).join(', ')}`).toEqual([])
    expect(en.galaxies.get('galaxy-hub')?.name).toBe('Leviathan IV')
    expect(en.belts.get('belt-fortune')?.name).toBe('Ring of Plenty')
    expect(en.stations.get('site-redring')?.name).toBe('Redring Outpost')
    expect(en.commsFactions.get('dshi')?.name).toBe('Deep Space Industry Association')
    const strip = (d: object): string => {
      const rest: Record<string, unknown> = { ...(d as Record<string, unknown>) }
      delete rest.name
      delete rest.description
      return JSON.stringify(rest)
    }
    for (const [id, def] of zh.galaxies) expect(strip(en.galaxies.get(id)!), `星系 ${id}`).toBe(strip(def))
    for (const [id, def] of zh.belts) expect(strip(en.belts.get(id)!), `矿带 ${id}`).toBe(strip(def))
    for (const [id, def] of zh.commsFactions) expect(strip(en.commsFactions.get(id)!), `势力 ${id}`).toBe(strip(def))
  })

  it('旅行事件 + 谜质科技：全覆盖 + 英文名生效 + 数值深比一字不动', () => {
    const missEv = zh.travelEvents.filter((e) => !(e.id in EN_TRAVEL_EVENTS)).map((e) => e.id)
    expect(missEv, `这些旅行事件还没英文名：${missEv.join(', ')}`).toEqual([])
    const missMt = [...(zh.matterTech ?? new Map()).keys()].filter((id) => !(id in EN_MATTER_TECH))
    expect(missMt, `这些谜质科技还没英文名：${missMt.join(', ')}`).toEqual([])
    expect(en.travelEvents.find((e) => e.id === 'ev-aurora')?.name).toBe('Warp Aurora')
    expect(en.matterTech?.get('mt-industry-unbox')?.name).toBe('Container Unboxing')
    expect(en.matterTech?.get('mt-battle-threat-boss')?.name).toBe('Guardian Analysis')
    const strip = (d: object): string => {
      const rest: Record<string, unknown> = { ...(d as Record<string, unknown>) }
      delete rest.name
      delete rest.description
      return JSON.stringify(rest)
    }
    for (const e of zh.travelEvents) {
      const other = en.travelEvents.find((x) => x.id === e.id)!
      expect(strip(other), `旅行事件 ${e.id}`).toBe(strip(e))
    }
    for (const [id, def] of zh.matterTech ?? new Map()) expect(strip(en.matterTech!.get(id)!), `谜质科技 ${id}`).toBe(strip(def))
  })

  it('舰船说明：43 条全部有英文说明，且不残留中日韩字符', () => {
    const noDesc = [...zh.ships.keys()].filter((id) => !en.ships.get(id)?.description)
    expect(noDesc, `这些舰船还没有英文说明：${noDesc.slice(0, 8).join(', ')}`).toEqual([])
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
    for (const [id, def] of zh.ships) {
      const other = en.ships.get(id)!
      expect(other.description, `${id} 的说明应来自原文且有内容`).not.toBe(def.description)
      expect(cjk.test(other.description ?? ''), `${id} 的英文说明残留中日韩字符：${other.description}`).toBe(false)
    }
  })

  it('物品说明：86 条静态物品全部有英文说明，且不残留中日韩字符', () => {
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
    const noDesc: string[] = []
    for (const it of ITEMS) {
      const other = en.items.get(it.id)!
      if (!other.description) {
        noDesc.push(it.id)
        continue
      }
      expect(cjk.test(other.description), `${it.id} 的英文说明残留中日韩字符：${other.description}`).toBe(false)
    }
    expect(noDesc, `这些物品还没有英文说明：${noDesc.slice(0, 8).join(', ')}`).toEqual([])
    expect(en.items.get('min-tritanium')?.description).toBe('The basic material of ship armor: plentiful and price-stable.')
    expect(en.items.get('box-relic-a')?.description).toContain('Takes 2×2 cargo slots')
  })

  it('装备说明：142 条全部有英文说明，且不残留中日韩字符', () => {
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
    const noDesc: string[] = []
    for (const [id] of zh.modules) {
      const other = en.modules.get(id)!
      if (!other.description) {
        noDesc.push(id)
        continue
      }
      expect(cjk.test(other.description), `${id} 的英文说明残留中日韩字符：${other.description}`).toBe(false)
    }
    expect(noDesc, `这些装备还没有英文说明：${noDesc.slice(0, 8).join(', ')}`).toEqual([])
    expect(en.modules.get('mod-turret-kin-1')?.description).toBe('Light rapid-fire kinetic gun: ×1.5 vs shields, ×0.75 vs armor.')
    expect(en.modules.get('mod-shield-kin-1')?.description).toContain('cap 90%')
  })

  it('技能说明：79 条全部有英文说明，且不残留中日韩字符、`⟦⟧` 高亮标记保留', () => {
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
    const noDesc: string[] = []
    for (const [id] of zh.skills) {
      const other = en.skills.get(id)!
      if (!other.description) {
        noDesc.push(id)
        continue
      }
      expect(cjk.test(other.description), `${id} 的英文说明残留中日韩字符：${other.description}`).toBe(false)
      // 高亮标记数量应与中文一致（译文里数字位置照旧）
      const want = (zh.skills.get(id)?.description.match(/⟦/g) ?? []).length
      const got = (other.description.match(/⟦/g) ?? []).length
      expect(got, `${id} 的 ⟦⟧ 数量（中 ${want} / 英 ${got}）`).toBe(want)
    }
    expect(noDesc, `这些技能还没有英文说明：${noDesc.slice(0, 8).join(', ')}`).toEqual([])
    expect(en.skills.get('gunnery')?.description).toContain('+⟦5%⟧')
  })

  it('异常点说明：42 条全部有英文说明，且不残留中日韩字符', () => {
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
    const noDesc: string[] = []
    for (const [id] of zh.anomalies) {
      const other = en.anomalies.get(id)!
      if (!other.description) {
        noDesc.push(id)
        continue
      }
      expect(cjk.test(other.description), `${id} 的英文说明残留中日韩字符：${other.description}`).toBe(false)
    }
    expect(noDesc, `这些异常点还没有英文说明：${noDesc.slice(0, 8).join(', ')}`).toEqual([])
    expect(en.anomalies.get('ano-maw-hunt')?.description).toContain('Star Maw')
    expect(en.anomalies.get('wh-pirate-scout')?.description).toContain('spawned by the wormhole only')
  })

  it('星系 / 矿带 / 站点 / 残骸说明：全部有英文说明且不残留中日韩字符', () => {
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
    const groups: ReadonlyArray<readonly [string, Iterable<[string, { description?: string }]>]> = [
      ['星系', zh.galaxies],
      ['矿带', zh.belts],
      ['站点', zh.stations],
      ['残骸', [...zh.items].filter(([id]) => id.startsWith('wreck-'))],
    ]
    for (const [label, entries] of groups) {
      const noDesc: string[] = []
      for (const [id] of entries) {
        const other = en.galaxies.has(id) ? en.galaxies.get(id) : en.belts.has(id) ? en.belts.get(id) : en.stations.has(id) ? en.stations.get(id) : en.items.get(id)
        if (!other?.description) {
          noDesc.push(id)
          continue
        }
        expect(cjk.test(other.description), `${label} ${id} 的英文说明残留中日韩字符：${other.description}`).toBe(false)
      }
      expect(noDesc, `${label} 里这些还没有英文说明：${noDesc.slice(0, 6).join(', ')}`).toEqual([])
    }
    expect(en.galaxies.get('galaxy-hub')?.description).toContain('Deep Space Industry Association')
    expect(en.belts.get('belt-fortune')?.description).toContain('never exhausted')
    expect(en.stations.get('site-cinder')?.description).toContain('Tritanium Alloy')
    expect(en.items.get('wreck-a-hi')?.description).toContain('Wreck Recycling')
    expect(en.items.get('wreck-rare-g-wh')?.description).toContain('Deadarmy (Wormhole)')
  })

  it('蓝图说明：135 条装备/物品蓝图全部有英文说明，且不残留中日韩字符', () => {
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
    const noDesc: string[] = []
    for (const [id] of zh.blueprints) {
      const other = en.blueprints.get(id)!
      if (!other.description) {
        noDesc.push(id)
        continue
      }
      expect(cjk.test(other.description), `${id} 的英文说明残留中日韩字符：${other.description}`).toBe(false)
    }
    expect(noDesc, `这些蓝图还没有英文说明：${noDesc.slice(0, 8).join(', ')}`).toEqual([])
    expect(en.blueprints.get('bp-miner-1')?.description).toContain('Tritanium Alloy')
    expect(en.blueprints.get('bp-wh-e-pd')?.description).toContain('intercept swarms')
  })

  it('舰船蓝图说明：57 条全部有英文说明（含 sbp-once-* 按本体派生）且不残留中日韩字符', () => {
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
    const noDesc: string[] = []
    for (const [id] of zh.shipBlueprints) {
      const other = en.shipBlueprints.get(id)!
      if (!other.description) {
        noDesc.push(id)
        continue
      }
      expect(cjk.test(other.description), `${id} 的英文说明残留中日韩字符：${other.description}`).toBe(false)
    }
    expect(noDesc, `这些舰船蓝图还没有英文说明：${noDesc.slice(0, 8).join(', ')}`).toEqual([])
    expect(en.shipBlueprints.get('sbp-pioneer')?.description).toContain('5,200 m³')
    // 一次性图纸与本体同说明（中文侧逐字相同 ⇒ 英文也照同一条派生）
    expect(en.shipBlueprints.get('sbp-once-sailfish')?.description).toBe(en.shipBlueprints.get('sbp-sailfish')?.description)
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
