/**
 * 测试门槛存档生成器（船长 2026-09-04 约定：B 批次 / 新玩法数值交付时配可测存档）。
 *
 * 用法：npx tsx tools/make-test-save.ts <feature>
 *  - 基于船长当前真档（%APPDATA%\whale-idle\save.json）复制注入（先自动备份原档到输出目录）；
 *  - 只补"难达成的门槛"（资金/声望/星系点亮/舰船/核心/装配弹药等），可达成的操作不代做；
 *  - 产物落 docs/test-saves/test-save-<feature>-<stamp>.json，加载方法见 docs/test-saves/README.md。
 *
 * 功能 case 注册制（扩展在此追加）：
 *  - b1   低安遭遇：+2000 万 ISK、协会声望 10、点亮全部低安星系、驾驶船配炮台+三型通用弹、
 *         AI 基础核心 +4 且 ai-expert Lv3（3 个副船名额）、全舰回满耐久、重置首次低安提示。
 *  - standby 星图待命：门槛同 b1 + 预置一艘副船已在低安驻留待命（看状态/取消/区域遭遇）；
 *  - refine 精炼炉运转周期：全品级矿石/气体/冰矿库存（货仓+仓库）+ 基础 AI 核心 ×1
 *    （测手动运转/核心驱动/停炉退料/忙碌互斥）。
 *  - v18  V18 槽位制 + V18.1 支援件 + V18B 武器形态：资金 +5000 万 + 满槽高配演示船
 *         （2×动能 MK2 + 激光 MK2 + 导弹 MK2 三形态混装）+ 三族/支援件备件 + 弹药与无人机补给
 *         （测 FitPage 复数安装/叠加标签/合成预览、per-gun 弹型、装配页与战斗数值）。
 *  - v18b 三族武器战斗验证门槛（船长 2026-09-05：三族武器 + 星图进度）：全部星系点亮 +
 *         协会声望 10 + 三族武器 MK1-3 全套入库 + 三形态演示船设为驾驶（开箱即可验证战斗）。
 *  - b3   残骸打捞-回收全链门槛（2026-09-05）：全部星系点亮 + 资金/声望 + 打捞演示船
 *         （白鲨级高槽 4×打捞器 MK2）+ 打捞器 MK1-3 入库 + 坟场/深渊/穹顶高残骸密度
 *         + 仓库预置 2 种残骸各 100 m³（回收开箱立即可测）+ AI 基础核心 ×1 且 ai-expert Lv1。
 *  - repair 修理系统验收门槛（2026-09-05）：驾驶船带伤 + 两档修理组件/蓝图书备件 + 钱包。
 *  - redtide 赤潮劫掠队手感试验（2026-09-08，玩家反馈"MK1 满配灰鲭鲨三发被打成破烂"）：
 *         点亮红环 + 声望 6 + 两艘灰鲭鲨级演示船——MK1 满配（设为驾驶，复现反馈场景）与
 *         MK2 满配参考船 + MK1/MK2 全套备件 + 弹药（换装对比三连发毁伤体感）。
 *  - drone 无人机舱大改实测（2026-09-08，新船清单装载制）：钱包 +5000 万 + 声望 10（可买
 *         王鲭级奇货）+ 全星系点亮 + 三艘对照船——梭鱼级·无人机中装（calibrate D2，droneLoad
 *         清单注入，设为驾驶）/ 王鲭级·无人机重装（D3）/ 灰鲭鲨·炮流参考（S2）+ rack/tac 全套
 *          备件 + 4 型无人机仓库足量（战斗只放飞清单）。
 *  - cruiser 巡洋舰线实测（2026-09-09，尺寸分级新增 T3 巡洋四艘）：钱包 +6000 万 + 声望 13
 *         + 全星系点亮 + 锤头鲨炮巡（驾驶）/电鳐激光巡/长尾鲨导弹巡/牛鲨突击巡 ×4，MK3 满配
 *         + 支援 + 三族武器/支援备件 + 弹药（实测巡洋对 D~E 段手感与三族差异，定数值方向）。
 *
 * 命名规则（2026-09-08 船长定）：测试存档命名必须符合用途——文件名 <feature> 段 = 注册
 * case 名（即该档服务的唯一测试用途），禁止随意命名；新 case 先注册（本注释 + INJECTORS +
 * docs/test-saves/README.md 档案清单）再生成。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadSaveFile, serializeSaveFile, addShipToFleet } from '@whale/core'
import type { GameState } from '@whale/core'
import { GALAXIES } from '@whale/data'

const SAVE_PATH = join(process.env.APPDATA ?? '', 'whale-idle', 'save.json')
const OUT_DIR = join(process.cwd(), 'docs', 'test-saves')

/** 低安星系（sec<0）——B1 实测需要点亮的星域 */
const LOWSEC_GALAXIES = [
  'galaxy-grave',
  'galaxy-abyss',
  'galaxy-auro',
  'galaxy-starcore',
  'galaxy-cinder',
  'galaxy-chasm',
  'galaxy-maw',
  'galaxy-nadir',
  'galaxy-voidedge',
]

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 通用门槛注入（避免测试档带着半截现场） */
function genericPrep(state: GameState): void {
  // 清掉未了结的遭遇与区域冷却（保持起点干净）
  state.encounter = {
    active: false,
    shipId: null,
    galaxyId: null,
    name: '',
    threat: 0,
    origin: '',
    invitedAtGameMs: 0,
    deadlineGameMs: 0,
    battle: null,
  }
  state.encounterZoneCooldown = {}
}

/** B1：低安遭遇测试门槛 */
function injectB1(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 20_000_000
  notes.push('钱包 +20,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 10)
  notes.push('协会声望升至 10（可接全部低安悬赏）')
  for (const g of LOWSEC_GALAXIES) {
    if (!state.exploredGalaxies.includes(g)) state.exploredGalaxies.push(g)
  }
  notes.push(`点亮低安星域 ${LOWSEC_GALAXIES.length} 个星系（含红环旁 cinder 等）`)
  // 驾驶船炮台 + 三型通用弹补给（没有就补；V18 位数组：炮占高槽首位）
  const pilot = state.fleet[state.shipId]
  if (pilot) {
    if (pilot.fitted.high.length === 0) pilot.fitted.high.push(null)
    if (pilot.fitted.high[0] === null) {
      const inBay = state.moduleBay['mod-turret-kin-1'] ?? 0
      if (inBay <= 0) state.moduleBay['mod-turret-kin-1'] = 1
      state.moduleBay['mod-turret-kin-1']! -= 1
      if (state.moduleBay['mod-turret-kin-1'] === 0) delete state.moduleBay['mod-turret-kin-1']
      pilot.fitted.high[0] = 'mod-turret-kin-1'
      notes.push('驾驶船已装轻型炮台 MK1（高槽第 1 位）')
    }
    for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
      state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 100
    }
    notes.push('仓库补三型通用弹 ×100')
  }
  // AI 副船名额与核心（实测"副船同遇"门槛）
  state.skills.trained['ai-expert'] = Math.max(state.skills.trained['ai-expert'] ?? 0, 3)
  state.aiCores['basic'] = (state.aiCores['basic'] ?? 0) + 4
  notes.push('AI 核心操作学 Lv3 + 基础核心 ×4（AI 核心启用上限 3 枚——AI 副船任务与站内设施共用）')
  // 全舰回满耐久（遭遇伤害测试以干净耐久起步）
  for (const s of Object.values(state.fleet)) s.durability = 1
  notes.push('全舰耐久回满')
  // 首次低安提示重置（便于复现"首次提示 + 手册须知"）
  state.lowSecNotified = false
  notes.push('重置首次低安提示标记（进低安会再弹一次引导）')
  return notes
}

/** standby（B1.5 星图前往星系待命）：门槛同 b1 + 预置一艘副船已在低安驻留待命（看状态/取消/遭遇） */
function injectStandby(state: GameState): string[] {
  const notes = injectB1(state)
  // 预置：找一艘空闲副船（非驾驶且无 AI 任务），已驻留低安（gravemaw 星系）验证状态/取消/区域机制
  const idleShip = Object.keys(state.fleet).find((id) => id !== state.shipId && !state.aiAssignments[id])
  const coreType = 'basic'
  if (idleShip && (state.aiCores[coreType] ?? 0) > 0) {
    state.aiCores[coreType]! -= 1
    state.aiAssignments[idleShip] = {
      coreType,
      startedAtGameMs: state.gameMs,
      task: { kind: 'standby', galaxyId: 'galaxy-maw', finishAtGameMs: state.gameMs, outMs: 1, phase: 'stand' },
    }
    notes.push(`预置副船 ${idleShip} 已驻留待命于低安「深渊之口」(galaxy-maw)——可直接看活动栏状态/取消/区域遭遇`)
  }
  return notes
}

/** refine（精炼炉运转周期）：各品级矿石/气体/冰矿补库存 + 一枚 AI 核心（测主控与核心驱动两条线） */
function injectRefine(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  // 全品级库存（浅→渊）：货仓放一份、仓库放一份，验证"货仓优先锁定 + 仓库补位"
  const stock: Array<[string, string, number]> = [
    ['ore-veldspar', '富凡晶石', 900],
    ['ore-glowstone', '辉云岩', 300],
    ['ore-voidshard', '玄晶', 120],
    ['gas-neon', '氖云气', 200],
    ['ice-frost', '蓝霜冰', 160],
  ]
  for (const [id, name, n] of stock) {
    state.fleet[state.shipId].cargo[id] = (state.fleet[state.shipId].cargo[id] ?? 0) + Math.min(80, n)
    state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + Math.max(0, n - 80)
    notes.push(`${name} ×${n}（货仓 80 + 仓库 ${n - 80}）`)
  }
  // 一枚 AI 核心（测核心驱动的自动运转与归还）
  state.aiCores['basic'] = (state.aiCores['basic'] ?? 0) + 1
  notes.push('基础 AI 核心 ×1（可在精炼炉选「AI 运转」，驱动期间核心被占用）')
  notes.push('测试路径：工业页精炼炉 —— 手动运转任意资源（看批进度/活动栏/停炉退料）；换 AI 运转（核心占用与归还）；离港操作应被拒绝')
  return notes
}

/**
 * v18/v18.1（槽位制 + 支援件门槛）：资金 + 一艘满槽高配武装演示船（虎鲨：多炮同 id ×2
 * 齐射、异弹型炮、中槽 索敌+陀螺、低槽 双动能稳定器 = 全额叠加演示，CPU 165 内）+
 * 复数矿枪/支援件备件 + 弹药与无人机补给。
 * 测装配页复数安装与两类叠加标签、收敛提示（第 N 件递减）、战斗 ×N 齐射与 per-gun 弹型。
 */
function injectV18(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  // 1) 资金：买得起顶配船与替换件
  state.wallet.isk += 50_000_000
  notes.push('钱包 +50,000,000 ISK')
  // 2) 一艘满槽高配武装演示船（CPU 144/165；V18.1 支援件布局）
  const uid = addShipToFleet(state, 'sh-tigershark')
  const demo = state.fleet[uid]!
  demo.customName = '复数装配演示'
  demo.fitted = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-laser-2', 'mod-missile-2'],
    mid: ['mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', null],
  }
  demo.cargo['drone-scout'] = 20
  demo.cargo['drone-assault'] = 10
  notes.push(`新增满槽演示船「${uid}（复数装配演示）」——虎鲨级：高槽 2×动能 MK2 + 激光炮 MK2 + 导弹架 MK2（×2 齐射 + 必中光束 + 爆破轰炸三形态）、中槽 索敌阵列 MK2 + 姿态陀螺 MK2、低槽 动能稳定器 MK2（低槽留 1 位试射速计算机/其它稳定器）`)
  notes.push('演示船货仓预置蜂鸟侦察机 ×20 + 赤鸢攻击机 ×10（需自装无人机挂架/战术导控）')
  // 3) 备件：复数矿枪（再装一艘采矿船试复数产量）+ 支援件替换/升级件 + 激光备件
  state.moduleBay['mod-miner-2'] = (state.moduleBay['mod-miner-2'] ?? 0) + 2
  state.moduleBay['mod-turret-kin-2'] = (state.moduleBay['mod-turret-kin-2'] ?? 0) + 1
  state.moduleBay['mod-laser-2'] = (state.moduleBay['mod-laser-2'] ?? 0) + 1
  state.moduleBay['mod-missile-2'] = (state.moduleBay['mod-missile-2'] ?? 0) + 1
  state.moduleBay['mod-stab-kin-2'] = (state.moduleBay['mod-stab-kin-2'] ?? 0) + 1
  state.moduleBay['mod-stab-exp-2'] = (state.moduleBay['mod-stab-exp-2'] ?? 0) + 1
  state.moduleBay['mod-stab-pla-2'] = (state.moduleBay['mod-stab-pla-2'] ?? 0) + 1
  state.moduleBay['mod-rof-2'] = (state.moduleBay['mod-rof-2'] ?? 0) + 1
  state.moduleBay['mod-track-2'] = (state.moduleBay['mod-track-2'] ?? 0) + 1
  state.moduleBay['mod-gyro-2'] = (state.moduleBay['mod-gyro-2'] ?? 0) + 1
  state.moduleBay['mod-drone-rack-2'] = (state.moduleBay['mod-drone-rack-2'] ?? 0) + 1
  notes.push('装备库补：矿枪 MK2 ×2（复数采矿）、动能炮/激光/导弹 MK2 各 1（试第 2 件 ×N 齐射/光束/爆破）、三系稳定器 MK2 + 射速/索敌/陀螺 MK2 各 1（试替换与第 N 件递减提示）、无人机挂架 MK2 ×1')
  // 4) 弹药 + 耐久
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 500
  }
  for (const s of Object.values(state.fleet)) s.durability = 1
  notes.push('仓库补三型通用弹 ×500 各；全舰耐久回满')
  notes.push('测试路径：舰船页换驾驶到演示船 → 装配页看高/中/低三组位与合成预览（回避含陀螺、命中含索敌、速度含加力）；开战观察三形态：动能 ×2 齐射（距离衰减命中）、激光光束必中（距离只削威力、耗能量弹药）、爆破导弹（带近盲安全射距、命中不随距离衰减、耗爆破导弹）；低槽再装第 3 件稳定器观察按系加成与「第 N 件衰减」提示')
  return notes
}

/**
 * v18b（三族武器战斗验证门槛）：船长 2026-09-05 要求"三族武器存档 + 一定星图进度"——
 * 全部星系点亮 + 协会声望 10（悬赏全可接）；三族武器 MK1-3 全套入库（自由换装对比
 * 动能炮/导弹架/激光炮手感）；三形态混装演示船直接设为驾驶（开箱即可出击验证战斗）。
 */
function injectV18b(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  // 1) 资金 + 声望 + 星图进度（全点亮：远征/悬赏/低安任意挑）
  state.wallet.isk += 50_000_000
  notes.push('钱包 +50,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 10)
  notes.push('协会声望升至 10（可接全部悬赏）')
  let lit = 0
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) {
      state.exploredGalaxies.push(g.id)
      lit++
    }
  }
  notes.push(`星图全部点亮（本次新增 ${lit} 个星系）——远征/悬赏/矿带任意出发`)
  // 2) 三形态混装演示船（同 v18 配置）并直接设为驾驶
  const uid = addShipToFleet(state, 'sh-tigershark')
  const demo = state.fleet[uid]!
  demo.customName = '三族战斗演示'
  demo.fitted = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-laser-2', 'mod-missile-2'],
    mid: ['mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', null],
  }
  demo.cargo['drone-scout'] = 20
  demo.cargo['drone-assault'] = 10
  state.shipId = uid // 直接开船
  notes.push(`新增「${uid}（三族战斗演示）」虎鲨级并已设为驾驶：高槽 2×动能 MK2 + 激光 MK2 + 导弹 MK2（×2 齐射 + 必中光束 + 爆破轰炸）、中槽 索敌 + 陀螺、低槽 动能稳定器（留 1 位试射速/换稳定器）`)
  notes.push('演示船货仓预置蜂鸟侦察机 ×20 + 赤鸢攻击机 ×10（仓库有无人机挂架可试无人机流对比）')
  // 3) 三族武器 MK1~3 全套入库（自由换装对比各族各档）
  for (const id of [
    'mod-turret-kin-1', 'mod-turret-kin-2', 'mod-turret-kin-3',
    'mod-missile-1', 'mod-missile-2', 'mod-missile-3',
    'mod-laser-1', 'mod-laser-2', 'mod-laser-3',
    'mod-stab-kin-2', 'mod-stab-exp-2', 'mod-stab-pla-2', 'mod-rof-2', 'mod-drone-rack-2',
  ]) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
  }
  notes.push('装备库补三族武器 MK1/2/3 各一件 + 三系稳定器 MK2 + 射速计算机 MK2 + 无人机挂架 MK2（单族对比与换装用）')
  // 4) 弹药足量 + 耐久
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 2_000
  }
  for (const s of Object.values(state.fleet)) s.durability = 1
  notes.push('仓库补动能弹/爆破导弹/能量弹药 ×2000 各；全舰耐久回满')
  notes.push('测试路径：星图任选悬赏/目标出击 → 观察三族弹道与命中/威力差异（动能距离衰减+近盲、激光必中+威力减半衰减、导弹近盲防自爆+追踪无衰减）；换装单族 MK1/2/3 对比 DPS 手感；AI 副船装配同源生效')
  return notes
}

/** B3：残骸打捞-回收全链验证门槛 */
function injectB3(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  // 1) 资金 + 声望 + 星图全点亮（低安打捞点可达）
  state.wallet.isk += 20_000_000
  notes.push('钱包 +20,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 10)
  notes.push('协会声望升至 10')
  let lit = 0
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) {
      state.exploredGalaxies.push(g.id)
      lit++
    }
  }
  notes.push(`星图全部点亮（新增 ${lit} 个）——低安打捞点已可达`)
  // 2) 打捞演示船（白鲨级：高槽 5 位装 4×打捞器 MK2，留 1 位试单/多台差异）直接设为驾驶
  const uid = addShipToFleet(state, 'sh-whiteshark')
  const demo = state.fleet[uid]!
  demo.customName = '残骸打捞演示'
  demo.fitted = {
    high: ['mod-salvager-2', 'mod-salvager-2', 'mod-salvager-2', 'mod-salvager-2', null],
    mid: [null, null, null],
    low: [null, null],
  }
  state.shipId = uid
  for (const id of ['mod-salvager-1', 'mod-salvager-2', 'mod-salvager-3']) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
  }
  for (const s of Object.values(state.fleet)) s.durability = 1
  notes.push('新增「残骸打捞演示」白鲨级并设为驾驶（高槽 4×打捞器 MK2，留 1 位）；打捞器 MK1/2/3 各一件已入库；全舰耐久回满')
  // 3) 高残骸密度（低安打捞点 + 深空顶级点）
  state.galaxyWrecks['galaxy-grave'] = { density: 60, rare: 0 }
  state.galaxyWrecks['galaxy-abyss'] = { density: 50, rare: 0 }
  state.galaxyWrecks['galaxy-vault'] = { density: 70, rare: 0 }
  notes.push('坟场/深渊/穹顶墓园残骸密度预置 60/50/70（打捞即见肥瘦随密度变化）')
  // 4) 仓库预置残骸（回收开箱立即可测：保底矿物 + 彩头）
  state.warehouse.items['wreck-ano-gravekeeper'] = (state.warehouse.items['wreck-ano-gravekeeper'] ?? 0) + 100
  state.warehouse.items['wreck-ano-abyss-guard'] = (state.warehouse.items['wreck-ano-abyss-guard'] ?? 0) + 100
  notes.push('仓库预置 坟场守墓人/深渊之门卫队 残骸各 100 m³——工业页「残骸回收」可直接开箱')
  // 5) AI 打捞任务门槛（名额 1 + 基础核心）
  state.skills.trained['ai-expert'] = Math.max(state.skills.trained['ai-expert'] ?? 0, 1)
  state.aiCores.basic = (state.aiCores.basic ?? 0) + 1
  notes.push('「AI 核心操作学」Lv1 + 基础 AI 核心 ×1（可试 AI 打捞任务）')
  notes.push('测试路径：星图远征面板「残骸打捞」开捞（或 AI 指挥中心打捞任务）→ 满仓自动返港 → 工业页残骸回收开箱（保底矿物 + 彩头/碎片）→ 装备库与仓库核收')
  return notes
}

/** repair（P2 修理系统验收门槛，2026-09-05）：驾驶船带伤（结构 55%/装甲 40%）+
 * 货仓预置 民用×3 / 军用×2 + 仓库备件 + 钱包——开箱即测 港内计费（HP×科技档）、
 * 野外/舰船页组件修复、自动链阈值、蓝图自造材料账。 */function injectRepair(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 500_000
  notes.push('钱包 +500,000 ISK（够几次港内维修对比）')
  const pilot = state.fleet[state.shipId]
  if (pilot) {
    pilot.durability = 0.55
    pilot.armorPct = 0.4
    pilot.cargo['repairkit-civ'] = (pilot.cargo['repairkit-civ'] ?? 0) + 3
    pilot.cargo['repairkit-mil'] = (pilot.cargo['repairkit-mil'] ?? 0) + 2
    notes.push(`驾驶船带伤：结构 55%、装甲 40%；货仓预置 民用修理组件 ×3 + 军用 ×2`)
  }
  state.warehouse.items['repairkit-civ'] = (state.warehouse.items['repairkit-civ'] ?? 0) + 5
  state.warehouse.items['repairkit-mil'] = (state.warehouse.items['repairkit-mil'] ?? 0) + 3
  state.warehouse.items['bp-repairkit-civ'] = (state.warehouse.items['bp-repairkit-civ'] ?? 0) + 1
  state.warehouse.items['bp-repairkit-mil'] = (state.warehouse.items['bp-repairkit-mil'] ?? 0) + 1
  notes.push('仓库备件：两档组件 + 两本蓝图书各 1（可现场学习后到工业页自造看材料账）')
  notes.push('测试路径：舰船页看 结构/装甲 双显与受损提示 → 港内维修（对照费用文案）→ 读档重来用 舰船页/星图远征停留面板 组件修复 → 货仓页把组件装/卸 → 学蓝图自造 → 低耐久下开连续出击观察自动吃组件')
  return notes
}

/** redtide（2026-09-08 玩家反馈"MK1 满配灰鲭鲨被赤潮劫掠队三发打成破烂"手感试验档）：
 * 点亮红环航道 + 声望 6（赤潮需 3）+ 两艘灰鲭鲨级（高4/中3/低2）——MK1 满配设为驾驶
 * （复现反馈场景：4×动能炮 MK1 + 中 盾抗/容量/索敌 MK1 + 低 甲抗/甲板 MK1），
 * MK2 满配同型参考船换装对比；装备库备 MK1/MK2 换装件 + 足量弹药与修理组件。 */
function injectRedtide(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 30_000_000
  notes.push('钱包 +30,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 6)
  notes.push('协会声望升至 6（赤潮劫掠舰队需 3，可接）')
  if (!state.exploredGalaxies.includes('galaxy-redring')) state.exploredGalaxies.push('galaxy-redring')
  notes.push('点亮 红环航道（赤潮劫掠舰队所在星系）')
  // MK1 满配试验船（设为驾驶）
  const uid1 = addShipToFleet(state, 'sh-mako')
  const s1 = state.fleet[uid1]!
  s1.customName = 'MK1满配·试验'
  s1.fitted = {
    high: ['mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1'],
    mid: ['mod-shield-kin-1', 'mod-shield-ext-1', 'mod-track-1'],
    low: ['mod-armor-kin-1', 'mod-armor-plate-1'],
  }
  state.shipId = uid1
  // MK2 满配参考船（P1 S2 官方锚装：battle-calibrate S2 行——4×动能MK2 + 中 盾抗/索敌/陀螺 + 低 火力稳定器/甲抗）
  const uid2 = addShipToFleet(state, 'sh-mako')
  const s2 = state.fleet[uid2]!
  s2.customName = 'MK2锚装·P1参考'
  s2.fitted = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  notes.push(`新增灰鲭鲨级 ×2：${uid1}（MK1满配·试验，已设为驾驶——复现"三发被打成破烂"场景）与 ${uid2}（MK2锚装·P1参考，舰船页切换对比）`)
  // 弹药/修理组件（两船货仓 + 仓库）
  const ammo: Array<[string, string]> = [
    ['ammo-kinetic-l', '动能弹'],
    ['ammo-plasma-l', '能量弹药'],
    ['ammo-explosive-l', '爆破导弹'],
  ]
  for (const ship of [s1, s2]) {
    ship.cargo['ammo-kinetic-l'] = (ship.cargo['ammo-kinetic-l'] ?? 0) + 600
    ship.cargo['ammo-plasma-l'] = (ship.cargo['ammo-plasma-l'] ?? 0) + 300
    ship.cargo['ammo-explosive-l'] = (ship.cargo['ammo-explosive-l'] ?? 0) + 300
    ship.cargo['repairkit-civ'] = (ship.cargo['repairkit-civ'] ?? 0) + 3
    ship.cargo['repairkit-mil'] = (ship.cargo['repairkit-mil'] ?? 0) + 2
  }
  for (const [id, name] of ammo) {
    state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + 2_000
    notes.push(`仓库补 ${name} ×2,000`)
  }
  notes.push('两船货仓各带 动能弹 600 / 能量弹药·爆破导弹 300 + 修理组件（民 3/军 2）')
  // 换装备件：MK1 全系 + MK2 武器/抗容/支援
  const spares: Array<[string, number]> = [
    ['mod-turret-kin-1', 2], ['mod-laser-1', 1], ['mod-missile-1', 1],
    ['mod-shield-kin-1', 1], ['mod-shield-ext-1', 1],
    ['mod-armor-kin-1', 1], ['mod-armor-plate-1', 1],
    ['mod-track-1', 1], ['mod-prop-1', 1],
    ['mod-turret-kin-2', 2], ['mod-laser-2', 1], ['mod-missile-2', 1],
    ['mod-shield-kin-2', 1], ['mod-shield-ext-2', 1],
    ['mod-armor-kin-2', 1], ['mod-armor-plate-2', 1],
    ['mod-track-2', 1], ['mod-prop-2', 1],
    ['mod-rof-2', 1], ['mod-gyro-2', 1], ['mod-stab-kin-2', 1],
  ]
  for (const [id, n] of spares) state.moduleBay[id] = (state.moduleBay[id] ?? 0) + n
  notes.push('装备库备 MK1/MK2 换装件（动能/激光/导弹、盾抗/容量、甲抗/甲板、索敌/推进/射速/陀螺/稳定器）——装配页自由换装对比')
  for (const sh of Object.values(state.fleet)) sh.durability = 1
  notes.push('全舰耐久回满')
  notes.push('测试路径：星图·战斗悬赏 → 红环航道「赤潮劫掠舰队」→ 开战观察 MK1 满配被几轮齐射击穿/残血比例（对照玩家反馈）与预估胜率 → 舰船页切换 MK2锚装·P1参考 同目标再打一轮对比 → 装配页换 推进器/射速计算机 等变体看手感差异')
  return notes
}

/** drone（2026-09-08 无人机舱大改实测档：battle-calibrate 无人机行 = 新船清单装载（见 D1-D3），
 * 供船长实测定数值方向后校准）：钱包 +5000 万 + 声望 10 + 全星系点亮 + 三艘对照演示船——
 * ①梭鱼级·无人机中装 = calibrate D2 配装（rack2×2+tac2×2，droneLoad 清单注入）设为驾驶；
 * ②王鲭级·无人机重装 = D3（rack3×2+tac3×2，droneLoad 清单注入）；③灰鲭鲨·炮流参考 = S2（4×动能 MK2 + 支援）。
 * 装备库备 rack/tac MK1-3 全套；仓库预置 4 型无人机足量（战斗只放飞清单；仓库余量不自动出战）；弹药三型足量。 */
function injectDrone(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 50_000_000
  notes.push('钱包 +50,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 10)
  notes.push('协会声望升至 10（可接全部悬赏）')
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) state.exploredGalaxies.push(g.id)
  }
  notes.push(`点亮全部星系（${GALAXIES.length}）`)
  // ① 梭鱼级·无人机中装（calibrate D2 配装 + 清单）→ 驾驶
  const uidA = addShipToFleet(state, 'sh-swarm')
  const sA = state.fleet[uidA]!
  sA.customName = '梭鱼·无人机中装(驾驶)'
  sA.fitted = {
    high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2', 'mod-drone-tac-2'],
    mid: [],
    low: [],
  }
  sA.droneLoad = { 'drone-scout': 8, 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 }
  state.shipId = uidA
  // ② 王鲭级·无人机重装（calibrate D3 配装 + 清单）
  const uidB = addShipToFleet(state, 'sh-sentinel')
  const sB = state.fleet[uidB]!
  sB.customName = '王鲭·无人机重装'
  sB.fitted = {
    high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'],
    mid: [],
    low: [],
  }
  sB.droneLoad = { 'drone-heavy': 4, 'drone-sentry': 6 }
  // ③ 灰鲭鲨·炮流参考（calibrate S2）
  const uidC = addShipToFleet(state, 'sh-mako')
  const sC = state.fleet[uidC]!
  sC.customName = '炮流参考·S2'
  sC.fitted = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  notes.push(`新增演示船 ×3：${uidA}（梭鱼级·无人机中装 D2，已设为驾驶）、${uidB}（王鲭级·无人机重装 D3）、${uidC}（灰鲭鲨·炮流参考 S2）——舰船页切驾驶逐船对照`)
  // 无人机库存：只放仓库（战斗装载只读各船 droneLoad 清单——2026-09-08 无人机舱大改，
  // 仓库余量不自动出战；装配页「无人机舱」弹层可改配/补装）
  const drones: Array<[string, string, number]> = [
    ['drone-sentry', '雷鸥哨戒', 40],
    ['drone-heavy', '猎鹰攻坚', 60],
    ['drone-assault', '赤鸢战斗', 100],
    ['drone-scout', '蜂鸟侦察', 200],
  ]
  for (const [id, nm, n] of drones) {
    state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + n
    notes.push(`仓库预置 ${nm} 无人机 ×${n}（${id}；装入见装配页「无人机舱」）`)
  }
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 2_000
  }
  notes.push('仓库弹药三型 ×2000（可换炮流自行对照）')
  // 增幅件备件（自定义配装用）
  for (const m of ['mod-drone-rack-1', 'mod-drone-rack-2', 'mod-drone-rack-3', 'mod-drone-tac-1', 'mod-drone-tac-2', 'mod-drone-tac-3']) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 2
  }
  notes.push('装备库备 甲板扩展/战术导控 MK1-3 ×2 全套（可自组配装）')
  // 全舰耐久回满
  for (const s of Object.values(state.fleet)) {
    if (s) {
      s.durability = 1
      s.armorPct = 1
    }
  }
  notes.push('全舰耐久回满')
  notes.push('测试路径：星图·战斗悬赏逐威胁开战 → 观察无人机流（梭鱼中装/王鲭重装）击杀时长、残血与体感 → 舰船页切 S2 炮流参考打同目标对照（校准口径：D2/D3 vs S1/S2/S4）→ 装配页「无人机舱」增删 甲板扩展/战术导控 看可装载架数与清单 CPU 预占 → 手感结论交船长定数值方向')
  return notes
}

/** cruiser（2026-09-09 巡洋舰线实测档：T3 巡洋四艘对照——锤头鲨炮击/长尾鲨导弹/电鳐激光/
 * 牛鲨突击，均 MK3 满配 + 支援;声望 13(全悬赏可接,含穹顶)+ 全星系点亮;钱包 +6000 万)。
 * 目的:实测巡洋对 D~E 段手感与三族武器差异(校准口径 = calibrate T3 行),回传定数值方向。 */
function injectCruiser(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 60_000_000
  notes.push('钱包 +60,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13（可接全部悬赏含穹顶守卫）')
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) state.exploredGalaxies.push(g.id)
  }
  notes.push(`点亮全部星系（${GALAXIES.length}）`)
  const mk3s: Array<[string, string, string, string[], string[], string[]]> = [
    // [船, 家族武器, 自定义名, high, mid, low]
    ['sh-hammerhead', 'mod-turret-kin-3', '锤头鲨·炮击巡洋(驾驶)', ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2', 'mod-rof-2'], ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2']],
    ['sh-electricray', 'mod-laser-3', '电鳐·激光巡洋', ['mod-laser-3', 'mod-laser-3', 'mod-laser-3', 'mod-laser-3', 'mod-laser-3'], ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2', 'mod-rof-2'], ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2']],
    ['sh-thresher', 'mod-missile-3', '长尾鲨·导弹巡洋', ['mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3'], ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2', 'mod-rof-2'], ['mod-stab-kin-2', 'mod-armor-kin-2']],
    ['sh-bullshark', 'mod-turret-kin-3', '牛鲨·突击巡洋', ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], ['mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2'], ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2']],
  ]
  const uids: string[] = []
  mk3s.forEach(([shipId, _w, name, high, mid, low], i) => {
    const uid = addShipToFleet(state, shipId)
    const s = state.fleet[uid]!
    s.customName = name
    s.fitted = { high: [...high], mid: [...mid], low: [...low] }
    if (i === 0) state.shipId = uid
    uids.push(uid)
  })
  notes.push(`新增巡洋 ×4：${uids[0]}（锤头鲨·炮击巡洋 MK3 满配，已设为驾驶）、${uids[1]}（电鳐·激光巡洋）、${uids[2]}（长尾鲨·导弹巡洋）、${uids[3]}（牛鲨·突击巡洋）——舰船页切驾驶逐船对照`)
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  notes.push('仓库弹药三型 ×5000（三族武器各自供弹）')
  for (const m of ['mod-turret-kin-3', 'mod-missile-3', 'mod-laser-3', 'mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2', 'mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2']) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 3
  }
  notes.push('装备库备 MK3 三族武器与支援件 ×3（可自组换装）')
  for (const s of Object.values(state.fleet)) {
    if (s) {
      s.durability = 1
      s.armorPct = 1
    }
  }
  notes.push('全舰耐久回满')
  notes.push('测试路径：星图·战斗悬赏从 D 段逐威胁开战（天底 66 → 噬口 80 → 坟场/虚海 88 → 穹顶 96）→ 逐船切驾驶对照三族武器与船体手感（校准口径：T3 电鳐 26s/牛鲨 32s/锤头 39s/长尾鲨 53s @96 顶，全技能）→ 装配页换装试配 → 体感结论回传定巡洋数值方向')
  return notes
}

const INJECTORS: Record<string, (state: GameState) => string[]> = {
  b1: injectB1,
  standby: injectStandby,
  refine: injectRefine,
  v18: injectV18,
  v18b: injectV18b,
  b3: injectB3,
  repair: injectRepair,
  redtide: injectRedtide,
  drone: injectDrone,
  cruiser: injectCruiser,
}
function main(): void {
  const feature = process.argv[2]
  if (!feature || feature === 'help' || !(feature in INJECTORS)) {
    console.log(`用法：npx tsx tools/make-test-save.ts <feature>\n已注册功能：${Object.keys(INJECTORS).join(' / ')}`)
    process.exit(feature ? 1 : 0)
  }
  if (!existsSync(SAVE_PATH)) {
    console.error(`找不到真档：${SAVE_PATH}\n请先启动一次游戏（生成存档）再运行本脚本。`)
    process.exit(1)
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const s = stamp()
  // 1) 自动备份原档（防注入失误）
  const backupName = `user-backup-${s}.json`
  copyFileSync(SAVE_PATH, join(OUT_DIR, backupName))
  // 2) 读档（合法化/迁移）→ 注入 → 落盘
  const { state } = loadSaveFile(readFileSync(SAVE_PATH, 'utf8'))
  const notes = INJECTORS[feature]!(state)
  const outName = `test-save-${feature}-${s}.json`
  writeFileSync(join(OUT_DIR, outName), serializeSaveFile(state, Date.now()), 'utf8')
  console.log(`✅ 已生成测试档：${join(OUT_DIR, outName)}`)
  console.log(`   原档已备份到：${join(OUT_DIR, backupName)}`)
  console.log('   注入清单：')
  for (const n of notes) console.log(`     - ${n}`)
  console.log('\n加载方法（详见 docs/test-saves/README.md）：')
  console.log('   1) 游戏内「存档管理 → 备份」；2) 退出游戏；3) 用本文件替换 %APPDATA%\\whale-idle\\save.json；')
  console.log('   4) 启动即测；测完在游戏内用备份恢复原档。')
}

main()
