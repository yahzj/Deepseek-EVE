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
  notes.push('人工智能专家 Lv3 + 基础核心 ×4（可同时指挥 3 艘副船）')
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

const INJECTORS: Record<string, (state: GameState) => string[]> = {
  b1: injectB1,
  standby: injectStandby,
  refine: injectRefine,
  v18: injectV18,
  v18b: injectV18b,
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
