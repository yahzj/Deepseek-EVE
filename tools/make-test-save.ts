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
 *  - shipart 舰船战斗图形目测（2026-09-09 三号，新规格 240×110 图形全量接入后）：钱包 +6000 万
 *         + 声望 13 + 全星系点亮 + 各族代表演示船 ×5（锤头鲨炮巡 MK3 满配驾驶/牛鲨突击巡/玄武
 *         重装旗舰/皇带鱼货舰/座头鲸矿舰）+ 弹药装备库（真机目测我方各族船形与敌族 A~G 型形，
 *         细节锚点/比例问题回传，详见 ship-battle-art 验收清单）。
 *  - hauling 长途运输实测（2026-09-09，两站往返运输）：红环/烬火两座副站标记"建成"并入基地网络
 *         + 点亮两星系 + 钱包 +300 万 + 蝠鲼级重载货舰（7000 m³ 大货舱）设为驾驶——任务中心「运输
 *         任务」页签可见 母港⇄红环 / 母港⇄烬火 / 红环⇄烬火 三条航线（报酬随容量与航程预览），
 *         点开始 → 顶部活动栏进度/停止运输（到站即止）→ 事件日志到站结算 → 货仓页看虚拟满载占用。
 *  - hullrep 船体维修装置实测（2026-09-09，中槽自动修复装甲/结构）：灰鲭鲨级驾驶带 MK2 维修装置
 *         + 带伤出场（装甲 55%）——开战即见装甲在脉冲下回升、每 5 秒扣 1 枚军用组件、组件耗尽停机
 *         + 战报返还；另有同型无维修对照船；三档装置与组件备件齐全。
 *  - lockrep 目标锁定阵列 × 维修装置联合实测（2026-09-09，新高槽 target-lock + 中槽修复件）：
 *         锤头鲨级 ×2——驾驶船 4×动能MK3 + 锁定阵列MK3 + 维修装置MK2（带伤出场装甲 60%，集火
 *         金标与修复脉冲同场可见）；无件对照船同火力；锁定/维修三档备件与组件齐全。
 *  - abyssgate  能量卡火力重标 + 族系改判实机验收（2026-09-10 船长「深渊之门给我个存档测试下」）：
 *   驾驶 = 灰鲭鲨 4×动能MK2 + 支援（中位技能 Lv3）；**四张验收卡 = 深渊之门 45（纯能量·单发直写 45）/
 *   星髓虫群 72（移除回退）/ 噬口猎杀令 80（改 brawl）/ 坟场守墓者 88（改 orbit）**；
 *   装备库备**盾/甲 × 动能/能量**四系抗性件各 3 件 → **换件即换抗**，实测"堆对应抗性"的回报。
 *  - etier  E 段顶格混伤实机复核（2026-09-10 船长「④给我相关存档做实机测试」）：三船 = P1 复跑表
 *         那三行（大白鲨 S4 驾驶 / 锤头鲨炮巡 / 灰鲭鲨 MK2）+ 中位战斗技能 Lv3 + 声望 13 +
 *         全星系点亮——亲测"中位档在 E 段顶格（虚海 88 / 穹顶 96）到底打不过还是能磨"，
 *         对照值见 docs/design/power-ladder-rework.md §七。
 *  - lairgear 五族专属装备 15 件 + 流亡蜂无人机 验收（2026-09-10 船长「⑧需要」）：在 rarebox
 *         门槛之上把 14 件专属模块 ×2 直接预置进装备库、专属无人机 ×30 架进仓库、另给王鲭级
 *         无人机重装 ×1（否则专属机无处放飞）——省掉 5/8/10% 掷骰等待，可立刻装配实测。
 *
 * 命名规则（2026-09-08 船长定）：测试存档命名必须符合用途——文件名 <feature> 段 = 注册
 * case 名（即该档服务的唯一测试用途），禁止随意命名；新 case 先注册（本注释 + INJECTORS +
 * docs/test-saves/README.md 档案清单）再生成。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadSaveFile, serializeSaveFile, addShipToFleet, rareWreckItemIdOf, RARE_WRECK_VOLUME_M3 } from '@whale/core'
import type { GameState } from '@whale/core'
import { GALAXIES, MODULES } from '@whale/data'

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
    anomalyId: null,
    origin: '',
    invitedAtGameMs: 0,
    deadlineGameMs: 0,
    battle: null,
  }
  state.encounterZoneCooldown = {}
}

/**
 * 稀有残骸·高级箱实机测试门槛（2026-09-10 船长：解禁 + 命中率 5/8/10% + 每炉锁死 1 件）：
 * 五族稀有残骸各备若干（各档位都有，能实测"一炉一件一箱"与"集齐前不重复"）、普通残骸做对照、
 * AI 核心够开多台并行；另备碎片少量与已集齐各一，便于顺带核对"碎片池集齐即移出"。
 */
function injectRareBox(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 30_000_000
  notes.push('钱包 +30,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 12)
  notes.push('协会声望升至 12（深层窝点门槛与暗市闸全过；也够买高级蓝图书）')
  let lit = 0
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) {
      state.exploredGalaxies.push(g.id)
      lit++
    }
  }
  notes.push(`星图全部点亮（新增 ${lit} 个）——赏金任务日板与全部稀有残骸来源可达`)
  // ① 五族稀有残骸进仓库（计数即体积：1 件 = 30 单位 = 30 m³）
  const rareSet: Array<[string, string, number]> = [
    ['ano-mirage-hijackers', 'A 海盗·蜃影劫持团', 3],
    ['ano-maw-hunt', 'C 异形·噬口猎食群', 2],
    ['ano-vault-sentinel', 'D 守墓古舰·穹顶守卫', 2],
    ['ano-titan-wreck', 'E 泰坦巨构·泰坦残骸勘探', 2],
    ['ano-nadir-static', 'G 烬火流亡·天底封锁军', 2],
  ]
  const per = RARE_WRECK_VOLUME_M3
  for (const [anomalyId, label, count] of rareSet) {
    const id = rareWreckItemIdOf(anomalyId)
    state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + per * count
    notes.push(`仓库预置稀有残骸「${label}」×${count} 件（${per * count} m³）`)
  }
  notes.push(`合计 11 件稀有残骸（${per * 11} m³）——工业页「残骸回收」里每族一张卡，各带「高级箱」徽标`)
  // ② 普通残骸做对照（不锁量：仍是"整批直到料尽"）
  state.warehouse.items['wreck-ano-gravekeeper'] = (state.warehouse.items['wreck-ano-gravekeeper'] ?? 0) + 100
  state.warehouse.items['wreck-ano-abyss-guard'] = (state.warehouse.items['wreck-ano-abyss-guard'] ?? 0) + 100
  notes.push('仓库预置普通残骸 坟场守墓者/深渊之门卫队 各 100 m³（对照：普通残骸不锁量、整批拆到料尽）')
  // ③ 多台并行：AI 核心上限技能 + 基础核心（主控 1 台 + AI 各 1 台）
  state.skills.trained['ai-expert'] = Math.max(state.skills.trained['ai-expert'] ?? 0, 2)
  state.aiCores.basic = Math.max(state.aiCores.basic ?? 0, 2)
  notes.push('「AI 核心操作学」Lv2 + 基础 AI 核心 ×2——可同时开 3 台炉（主控 1 + AI 2）验证逐件开箱')
  // ④ 碎片对照：差几片的、已集齐的各一，便于核对"集齐前不重复"与逆向研究
  state.warehouse.items['frag-mod-miner-2'] = (state.warehouse.items['frag-mod-miner-2'] ?? 0) + 20
  state.warehouse.items['frag-mod-turret-kin-3'] = (state.warehouse.items['frag-mod-turret-kin-3'] ?? 0) + 250
  notes.push('仓库预置 MK2 碎片（强化采集器）×20（差 5 片到 25）与 MK3 碎片（攻坚炮台）×250（已够逆向）')
  for (const s of Object.values(state.fleet)) s.durability = 1
  notes.push('全舰耐久回满')
  notes.push(
    '测试路径：① 工业页「精炼炉」→ 稀有残骸卡数据行应显示「每炉锁 30 m³ = 1 件 · 一次起炉 = 开一箱」→ 起炉；' +
      '② 3 批（约 75 秒）后应自动停并写日志「本炉定额完成（每炉 30 m³ = 1 件，共 3 批）· 余料仍在货仓/仓库」；' +
      '③ 每次起炉最多开 1 箱，日志有「✦ 高级箱：稀有残骸开箱额外掉落——…」；把 11 件逐件开完 ≈ 11 箱；' +
      '④ 同一台炉连开两轮应各得 1 箱；对照普通残骸卡：不锁量、会一直拆到料尽；' +
      '⑤ 精炼炉卡产出行应逐行显示「（仓库 N）」、组装机产物行显示「（装备库/仓库/机库 N）」。',
  )
  return notes
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
  notes.push('仓库预置 坟场守墓者/深渊之门卫队 残骸各 100 m³——工业页「残骸回收」可直接开箱')
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
    high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2'], // 2026-09-10 船长：梭鱼高槽 5→3（D2 三槽口径）
    mid: [],
    low: [],
  }
  sA.droneLoad = { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 } // calibrate D2 同款（2026-09-09 体积档 5/10/20/40：220/230m³）
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

/** wave（多波次低安顶段实测，2026-09-09 二号）：基于 cruiser 门槛 + 中位战斗技能（与
 * battle:calibrate MID_SKILLS 同源 20 键 ×3——多波验收口径 = 中位列）+ 灰鲭鲨 MK2 上一档对照船。
 * 对应 docs/design/wave-battles-20260909.md（首批 4 卡：噬口 2 波/坟场 2 波/虚海 3 波/穹顶 3 波）。 */
function injectWave(state: GameState): string[] {
  const notes = injectCruiser(state)
  const midSkillIds = [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control',
    'reload-drills', 'drone-warfare', 'drone-servicing', 'ammunition-condensing',
    'shield-operation', 'energy-management', 'hull-upgrades', 'shield-tuning', 'armor-tuning',
    'armed-ops', 'armored-ops', 'vector-maneuvering', 'evasion-maneuvering',
    'targeting-integration', 'ship-systems-engineering',
  ]
  for (const k of midSkillIds) state.skills.trained[k] = 3
  notes.push('战斗系技能 20 项 = Lv3（中位档，与 battle:calibrate 主验收行同口径）')
  // 上一档对照船：灰鲭鲨 4×MK2 + 支援（calibrate S2 行）——穹顶多波下应"磨不过"（实测 0%）
  const uid = addShipToFleet(state, 'sh-mako')
  const s = state.fleet[uid]!
  s.customName = '灰鲭鲨·MK2（上一档对照）'
  s.fitted = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  s.durability = 1
  s.armorPct = 1
  state.moduleBay['mod-turret-kin-2'] = (state.moduleBay['mod-turret-kin-2'] ?? 0) + 3
  notes.push('新增灰鲭鲨·MK2（上一档对照，不设驾驶）——用它与锤头鲨打同一张多波卡对照强度差')
  notes.push(
    '测试路径（多波验收口径）：星图·战斗悬赏 → 虚海 88（3 波 2+2+1）/穹顶 96（3 波 2+2+1）开战——' +
      '留意战斗日志「第 N/3 波来袭：敌方增援抵达」与增援舰入场节奏；锤头鲨（驾驶，中位技能）单场约 70~140s、' +
      '战后残血 70~112%；逐船切驾驶对照三族（电鳐快 / 长尾鲨慢 / 牛鲨最肉）；换「灰鲭鲨·MK2」打同一张卡对照' +
      '上一档被关门（穹顶磨不过）——体感结论回传（单场时长/压力/波次节奏是否合适）。',
  )
  return notes
}

/** etier（2026-09-10 船长「④给我相关存档做实机测试」）：**E 段顶格对敌方混伤的实机复核档**。
 * 口径完全对齐 P1 复跑表（docs/design/power-ladder-rework.md §七）——三条船就是那三行：
 *   驾驶 = **S4 大白鲨 5×MK3 + 支援**（同代对照行：虚海 11% / 穹顶 0% —— 本次最可能需要亲测的两格）
 *   + **锤头鲨炮巡 5×kin3 + 支援**（E 段主验收行：穹顶 33%）
 *   + **灰鲭鲨 4×MK2 + 支援**（上一档"可磨"行：虚海/穹顶 0%）
 * 战斗系 20 项技能 = Lv3（中位档，与 battle:calibrate 主验收行同口径）。
 * 目的：船长亲测"中位档在 E 段顶格到底是打不过、还是能磨"——决定要不要走单卡数值（复跑表四条结论之四）。 */
function injectEtier(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 60_000_000
  notes.push('钱包 +60,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13（可接全部悬赏，含穹顶守卫 96）')
  let lit = 0
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) {
      state.exploredGalaxies.push(g.id)
      lit++
    }
  }
  notes.push(`星图全部点亮（新增 ${lit} 个）——E 段四卡全部可达`)
  // 中位战斗技能（与 calibrate MID_SKILLS 同源 20 键 ×3）
  const midSkillIds = [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control',
    'reload-drills', 'drone-warfare', 'drone-servicing', 'ammunition-condensing',
    'shield-operation', 'energy-management', 'hull-upgrades', 'shield-tuning', 'armor-tuning',
    'armed-ops', 'armored-ops', 'vector-maneuvering', 'evasion-maneuvering',
    'targeting-integration', 'ship-systems-engineering',
  ]
  for (const k of midSkillIds) state.skills.trained[k] = 3
  notes.push('战斗系技能 20 项 = Lv3（中位档，与 battle:calibrate 主验收行同口径）')
  const rows: Array<[string, string, string[], string[], string[]]> = [
    ['sh-whiteshark', '大白鲨·S4（驾驶·同代对照行）', ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], ['mod-stab-kin-2', 'mod-armor-kin-2']],
    ['sh-hammerhead', '锤头鲨·炮巡（E 段主验收行）', ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], ['mod-stab-kin-2', 'mod-armor-kin-2']],
    ['sh-mako', '灰鲭鲨·MK2（上一档"可磨"行）', ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], ['mod-stab-kin-2', 'mod-armor-kin-2']],
  ]
  const uids: string[] = []
  rows.forEach(([shipId, name, high, mid, low], i) => {
    const uid = addShipToFleet(state, shipId)
    const s = state.fleet[uid]!
    s.customName = name
    s.fitted = { high: [...high], mid: [...mid], low: [...low] }
    s.durability = 1
    s.armorPct = 1
    if (i === 0) state.shipId = uid
    uids.push(uid)
  })
  notes.push(`新增三船：${uids[0]}（大白鲨 S4 = 驾驶）、${uids[1]}（锤头鲨）、${uids[2]}（灰鲭鲨）——舰船页切驾驶逐行对照`)
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  notes.push('仓库弹药三型 ×5000')
  for (const m of ['mod-turret-kin-3', 'mod-turret-kin-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2', 'mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2']) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 3
  }
  notes.push('装备库备件 ×3（可自组换装，试"只堆主系抗 vs 也堆副系抗"的差别）')
  for (const s of Object.values(state.fleet)) {
    if (s) {
      s.durability = 1
      s.armorPct = 1
    }
  }
  notes.push('全舰耐久回满')
  notes.push(
    '测试路径（按复跑表逐格对照，建议同一目标打 3 场看稳定性）：星图·战斗悬赏 → ' +
      '① 噬口猎杀令 80（2 波）② 坟场守墓者 88（2 波）③ 虚海守望者 88（3 波）④ 穹顶守卫 96（3 波）。' +
      '复跑表参考值（9 种子，中位技能）：大白鲨 S4 = 噬口 100%/残血 77% · 坟场 100%/112% · **虚海 11%** · **穹顶 0%**；' +
      '锤头鲨 = 噬口 100%/89% · 坟场 100%/112% · 虚海 100%/51% · **穹顶 33%**；灰鲭鲨 = 坟场 100% · **虚海 0% · 穹顶 0%**。' +
      '重点体感：**虚海/穹顶 是否"明明还有血却被磨死"、还是"根本打不动"**；换装只堆主系抗 vs 兼堆副系抗的差别；' +
      '结论回传用于决定是否给这两张卡单卡降伤（复跑表四条结论之四）。',
  )
  return notes
}

/** dfamily（2026-09-11 船长「给我准备一个存档，我测试下」）：**D 族「守墓古舰」验收档**。
 *
 * 2026-09-11 D 族落码批（火力对齐 + 舰船配置 + 三张卡削减编成 + 抬高最短射程）后的实机验收：
 * 给四套**与 `battle:calibrate` 探索行逐项同源**的装配，让船长直接感受"三张墙到底能不能过"。
 *
 * 装配四套（舰船页切驾驶即换行；模块库另有备件可现场自组）：
 *  - `D 族·A0 动能抗`（动能炮MK2 · 原参考行：那笔"动能抗"投资在 D 换能量主系后**归零**）
 *  - `D 族·A0 能量抗`（同上但抗性逐件换等离子版 ⇒ 校准实测存活 8s→17s）
 *  - `D 族·近距离1500 能量抗`（轻型炮MK1 + 能量抗 + MK2）
 *  - `D 族·近距离1000 能量抗`（转管炮 + 能量抗 + **MK3**；校准实测三张墙仍 0%，但幽灵舰信号 100%）
 *
 * ⚠ 战前把**距离条**拨到对应目标距离（1,500 / 1,000）——校准行是用 `desireM` 直接设定的，
 *   游戏里对应的就是那个距离控件；D 族的**最短射程**是 562 / **1,062** / **2,062**，
 *   拨到下限以内理论上能免伤（但校准实测玩家活不到那个距离）。 */
function injectDfamily(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 80_000_000
  notes.push('钱包 +80,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13（可接全部悬赏：坟场/虚海要 12、穹顶要 13）')
  let lit = 0
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) {
      state.exploredGalaxies.push(g.id)
      lit++
    }
  }
  notes.push(`星图全部点亮（新增 ${lit} 个）——D 族四卡（红环航道 / 暗星坟场 / 虚海边缘 / 穹顶墓园）全部可达`)
  const midSkillIds = [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control',
    'reload-drills', 'drone-warfare', 'drone-servicing', 'ammunition-condensing',
    'shield-operation', 'energy-management', 'hull-upgrades', 'shield-tuning', 'armor-tuning',
    'armed-ops', 'armored-ops', 'vector-maneuvering', 'evasion-maneuvering',
    'targeting-integration', 'ship-systems-engineering',
  ]
  for (const k of midSkillIds) state.skills.trained[k] = 3
  notes.push('战斗系技能 20 项 = Lv3（中位档，与 battle:calibrate 同口径）')
  const PLA_MID_MK2 = ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2']
  const PLA_MID_MK3 = ['mod-prop-3', 'mod-shield-pla-2', 'mod-track-2']
  const KIN_MID_MK2 = ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2']
  const PLA_LOW = ['mod-stab-pla-2', 'mod-armor-pla-2']
  const KIN_LOW = ['mod-stab-kin-2', 'mod-armor-kin-2']
  const turret2 = ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2']
  // ⚠ **参考船更正**（船长 2026-09-11：「你为什么是用灰鲭鲨级测试，这已经属于 E 档敌人，
  //   **理论上我们应该上巡洋舰级的船**」）：E 段（88/96）用 **T3 巡洋**——
  //   `sh-hammerhead` 锤头鲨级炮击巡洋舰 = **E 段既有主验收行**（与 2026-09-10 `etier` 档同源），
  //   槽位 5 高 / 4 中 / 3 低、血 474（vs 灰鲭鲨 366）。**灰鲭鲨留一艘作"上一档对照行"**（同 `etier` 档做法）。
  const cruiserHigh = (m: string): string[] => [m, m, m, m, m]
  const cruiserMidKin = ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2']
  const cruiserMidPla = ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2']
  const cruiserMidPlaMK3 = ['mod-prop-3', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2']
  const cruiserLowKin = ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2']
  const cruiserLowPla = ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2']
  const rows: Array<[string, string, string[], string[], string[]]> = [
    ['E段·锤头鲨 动能抗（原参考行）', 'sh-hammerhead', cruiserHigh('mod-turret-kin-2'), cruiserMidKin, cruiserLowKin],
    ['E段·锤头鲨 能量抗（只换抗性系）', 'sh-hammerhead', cruiserHigh('mod-turret-kin-2'), cruiserMidPla, cruiserLowPla],
    ['E段·锤头鲨 近距离1500 能量抗', 'sh-hammerhead', cruiserHigh('mod-turret-kin-1'), cruiserMidPla, cruiserLowPla],
    ['E段·锤头鲨 近距离1000 能量抗 MK3', 'sh-hammerhead', cruiserHigh('mod-lair-turret-a'), cruiserMidPlaMK3, cruiserLowPla],
    ['上一档对照·灰鲭鲨 A0 动能抗', 'sh-mako', turret2, KIN_MID_MK2, KIN_LOW],
  ]
  const uids: string[] = []
  rows.forEach(([name, shipId, high, mid, low], i) => {
    const uid = addShipToFleet(state, shipId)
    const s = state.fleet[uid]!
    s.customName = name
    s.fitted = { high: [...high], mid: [...mid], low: [...low] }
    s.durability = 1
    s.armorPct = 1
    if (i === 0) state.shipId = uid
    uids.push(uid)
  })
  notes.push(
    `新增五船（**E 段用 T3 巡洋**：锤头鲨级炮击巡洋舰 ×4 + 灰鲭鲨级作上一档对照）：${uids.join(' / ')}` +
      '——舰船页切驾驶即换行',
  )
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  notes.push('仓库弹药三型 ×5000')
  // **全部 MK3 装备**（船长 2026-09-11：「希望你给我准备的存档**含所有 MK3 装备**」）——
  // 按 id 后缀 `-3` **自动枚举**（不手抄清单，日后新增 MK3 件自动带上），每件 ×8 便于多船并行装配。
  const mk3 = MODULES.filter((m) => m.id.endsWith('-3')).map((m) => m.id)
  for (const m of mk3) state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 8
  notes.push(`装备库：**全部 MK3 装备 ${mk3.length} 件**（按 id 后缀自动枚举，每件 ×8）——${mk3.join(' / ')}`)
  for (const m of [
    'mod-shield-pla-2', 'mod-armor-pla-2', 'mod-stab-pla-2',
    'mod-shield-kin-2', 'mod-armor-kin-2', 'mod-stab-kin-2',
    'mod-prop-2', 'mod-turret-kin-1', 'mod-turret-kin-2', 'mod-track-2', 'mod-gyro-2', 'mod-armor-plate-2',
    'mod-lair-turret-a', 'mod-lair-shield-d', 'mod-lair-turret-d', 'mod-lair-armor-d',
  ]) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 3
  }
  notes.push('装备库另备：四套配置用到的 MK2 支援件 ×3 + 转管炮 + **D 族专属三件**（陵墓护盾阵列=三系减伤各 +30% / 守墓者长炮 / 陵寝装甲层）')
  for (const s of Object.values(state.fleet)) {
    if (s) {
      s.durability = 1
      s.armorPct = 1
    }
  }
  notes.push('全舰耐久回满')
  notes.push(
    '测试路径：星图·战斗悬赏 → ① 坟场守墓者 88（现 1 波 2 艘·中程 562~7391·**单发 175 必中**）' +
      '② 虚海守望者 88（1 波 3 艘）③ 穹顶守卫 96（1 波 **2 静滞卫舰 + 1 守墓长舰**·远程 2062~12000·静滞单发 190）' +
      '④ 幽灵舰信号 46（1 波 2 艘·中程 562~7000·单发 64/38）。' +
      '⚠ **战前把距离条拨到目标距离**（1,500 / 1,000 两套才有意义）；D 族最短射程 = 562 / 1,062 / 2,062。',
  )
  notes.push(
    '校准参考值（`--std` 5 播种均值，中位技能）：**灰鲭鲨（T2，旧口径）** = 坟场 0%｜8s · 虚海 0%｜8s · 穹顶 0%｜12s；' +
      '**锤头鲨（T3 巡洋，E 段正确参考船）·动能抗** = 坟场 0%｜12s · 虚海 0%｜8s · 穹顶 0%｜12s · 幽灵舰 100%｜12s｜残血 82%；' +
      '**巡洋 · 能量抗** = 坟场 0%｜**21s** · 虚海 0%｜**17s** · 穹顶 0%｜**25s** · 幽灵舰 100%｜88%；' +
      '**巡洋 · 近距离 + 能量抗** = 三张墙仍 0%（最好贴到 1,472m，仍未进入 1,062 的死区）。' +
      '重点体感：**"活得久"与"打得死"差多少** · 拨近距离条能不能真的躲开炮 · 换上陵墓护盾阵列（三系 +30%）的差别。',
  )
  return notes
}

/** pd（2026-09-11 机群批 S5）：**敌方机群 + 巨构近防炮**验收档。
 *
 * 门槛：钱包 +8,000 万 · 协会声望 13 · 全星系点亮 · 中位技能（20 项 Lv3，与 `battle:calibrate` 同口径）。
 * **三艘 T3 巡洋（锤头鲨）对照**（E 段既有参考船）：
 *  ① **混装**：2× 巨构近防炮 MK2 + 3× 动能炮台 MK2 · 能量抗 —— **推荐打法**
 *     （防空行 G1 实测：30 秒 / 残血 99%；比全主炮多花 4 秒、多留 6% 血）
 *  ② **纯防空**：5× 巨构近防炮 MK3 · 能量抗 —— 看"**打得下来机群、却打不死母舰**"（G0 实测 125 秒）
 *  ③ **全主炮对照**：5× 动能炮台 MK2 · 能量抗 —— **不带防空 ⇒ 机群一架都掉不了**（负向对照）
 * 另备：近防炮三档与蓝图、能量/动能抗件、三型弹药各 5,000、全部 MK3 装备。
 *
 * 测试路径：星图·战斗悬赏 → **泰坦残骸勘探 60**（深渊之门）——该卡现挂 **警戒机群 ×2/舰**。
 * ⚠ **战前把距离条拨到 1,000~1,500**：机群在 **4.5 km** 外布警戒幕，而近防炮只有 1.4~1.6 km
 * ⇒ **必须贴进去才打得到机群**；母舰射程只有 1.0~2.6 km，所以"贴脸"同时也在吃它的炮。 */
function injectPd(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 80_000_000
  notes.push('钱包 +80,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13（可接全部悬赏）')
  let lit = 0
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) {
      state.exploredGalaxies.push(g.id)
      lit++
    }
  }
  notes.push(`星图全部点亮（新增 ${lit} 个）——泰坦残骸勘探（深渊之门）可达`)
  const midSkillIds = [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control',
    'reload-drills', 'drone-warfare', 'drone-servicing', 'ammunition-condensing',
    'shield-operation', 'energy-management', 'hull-upgrades', 'shield-tuning', 'armor-tuning',
    'armed-ops', 'armored-ops', 'vector-maneuvering', 'evasion-maneuvering',
    'targeting-integration', 'ship-systems-engineering',
  ]
  for (const k of midSkillIds) state.skills.trained[k] = 3
  notes.push('战斗系技能 20 项 = Lv3（中位档，与 battle:calibrate 同口径）')
  const MID_PLA = ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'] // 能量抗（D/E 段主系是能量）
  const LOW_PLA = ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2']
  const rows: Array<[string, string[]]> = [
    [
      '⚠机群·混装（2×巨构近防炮MK2 + 3×动能炮台MK2）·能量抗——**推荐打法**',
      ['mod-pd-e-2', 'mod-pd-e-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    ],
    [
      '机群·纯防空（5×巨构近防炮MK3）·能量抗——打得下机群、打不死母舰',
      ['mod-pd-e-3', 'mod-pd-e-3', 'mod-pd-e-3', 'mod-pd-e-3', 'mod-pd-e-3'],
    ],
    [
      '对照·全主炮（5×动能炮台MK2）·能量抗——不带防空，机群一架都掉不了',
      ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    ],
  ]
  const uids: string[] = []
  rows.forEach(([name, high], i) => {
    const uid = addShipToFleet(state, 'sh-hammerhead') // T3 巡洋：E 段既有参考船（5 高 / 4 中 / 3 低）
    const s = state.fleet[uid]!
    s.customName = name
    s.fitted = { high: [...high], mid: [...MID_PLA], low: [...LOW_PLA] }
    s.durability = 1
    s.armorPct = 1
    if (i === 0) state.shipId = uid // 默认驾驶 = 推荐打法那艘
    uids.push(uid)
  })
  notes.push(`新增三船（均 T3 锤头鲨级炮击巡洋舰）：${uids.join(' / ')}——舰船页切驾驶即换行`)
  for (const m of [
    'mod-pd-e', 'mod-pd-e-2', 'mod-pd-e-3',
    'mod-turret-kin-1', 'mod-turret-kin-2', 'mod-turret-kin-3', 'mod-lair-turret-a',
    'mod-shield-pla-2', 'mod-armor-pla-2', 'mod-stab-pla-2', 'mod-armor-plate-2',
    'mod-shield-kin-2', 'mod-armor-kin-2', 'mod-stab-kin-2',
    'mod-prop-2', 'mod-prop-3', 'mod-track-2', 'mod-gyro-2',
  ]) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 6
  }
  notes.push('装备库：**近防炮三档（+蓝图书市可购）×6** + 主炮/抗性/支援件各 ×6（够三船反复换装对照）')
  const mk3 = MODULES.filter((m) => m.id.endsWith('-3')).map((m) => m.id)
  for (const m of mk3) state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 8
  notes.push(`装备库另备：全部 MK3 装备 ${mk3.length} 件 ×8（按 id 后缀自动枚举）`)
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  notes.push('仓库弹药三型 ×5000')
  for (const s of Object.values(state.fleet)) {
    if (s) {
      s.durability = 1
      s.armorPct = 1
    }
  }
  notes.push('全舰耐久回满')
  notes.push(
    '测试路径：星图·战斗悬赏 → **泰坦残骸勘探 60**（深渊之门）：现挂 **警戒机群 ×2/舰**（机群射程 4.5km · ' +
      '母舰 1.0~2.6km · 总血 1,585 · 命中 0.65"老化失准"）。⚠ **战前把距离条拨到 1,000~1,500**——' +
      '机群在 4.5km 外布警戒幕、近防炮只有 1.4~1.6km ⇒ **必须贴进去才打得到机群**。',
  )
  notes.push(
    '校准参考值（`--std6` 5 播种均值 · 中位技能 · 目标距离 1000）：**全主炮** = 100%｜26s｜残血 93.1%；' +
      '**纯防空 5×近防炮** = 100%｜**125s**｜残血 91.1%（机群被清掉、但打不死母舰）；' +
      '**混装 2×近防炮 + 3×主炮** = 100%｜30s｜残血 **99%**。' +
      '重点体感：**贴进去之后机群掉得快不快** · 混装换纯防空的差别 · 不带防空时被机群磨多久。',
  )
  return notes
}

/** lairgear（2026-09-10 船长「⑧需要」）：**五族专属装备 15 件 + 流亡蜂无人机 验收档**。
 * 在 rarebox 门槛（五族稀有残骸 + 高级箱 + AI 核心）之上，**把整族专属产出直接预置进装备库/仓库**，
 * 省掉"开箱靠 5/8/10% 掷骰"的等待——船长可直接装配实测 15 件专属与专属无人机的手感/数值。 */
function injectLairGear(state: GameState): string[] {
  const notes = injectRareBox(state)
  // 五族专属装备：14 件模块（A/C/D/E 各 3 + G 2）+ 1 件专属无人机物品 = 15
  const gear: Array<[string, string]> = [
    ['mod-lair-turret-a', 'A 海盗'],
    ['mod-lair-missile-a', 'A 海盗'],
    ['mod-lair-cargo-a', 'A 海盗'],
    ['mod-lair-armor-c', 'C 异形'],
    ['mod-lair-dc-c', 'C 异形'],
    ['mod-lair-laser-c', 'C 异形'],
    ['mod-lair-shield-d', 'D 守墓'],
    ['mod-lair-turret-d', 'D 守墓'],
    ['mod-lair-armor-d', 'D 守墓'],
    ['mod-lair-turret-e', 'E 巨构'],
    ['mod-lair-hangar-e', 'E 巨构'],
    ['mod-lair-frame-e', 'E 巨构'],
    ['mod-lair-drone-tac-g', 'G 流亡'],
    ['mod-lair-drone-relay-g', 'G 流亡'],
  ]
  for (const [id] of gear) state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 2
  notes.push(`装备库预置五族专属装备 14 件 ×2（A/C/D/E 各 3 + G 2）——装配页可直接装上实测（无蓝图、不上市场，正常只能靠高级箱掷骰）`)
  // 专属无人机（G 族第 3 件）：物品仓库一次给 30 架（正常一箱 10 架）
  state.warehouse.items['drone-exile-bee'] = (state.warehouse.items['drone-exile-bee'] ?? 0) + 30
  notes.push('物品仓库预置专属无人机「流亡蜂无人机」×30 架（正常一箱 10 架；装配页「无人机舱」装入清单后即可放飞）')
  // 四型制式无人机足量（对照专属机与制式机的差别）
  for (const d of ['drone-scout', 'drone-assault', 'drone-heavy', 'drone-sentry']) {
    state.warehouse.items[d] = (state.warehouse.items[d] ?? 0) + 40
  }
  notes.push('物品仓库预置四型制式无人机各 +40 架（与专属机对照）')
  // 无人机专用舰 ×1（王鲭级重装，D3 行配置）——否则专属无人机无处放飞
  const uid = addShipToFleet(state, 'sh-sentinel')
  const s = state.fleet[uid]!
  s.customName = '王鲭·无人机重装（专属机实测）'
  s.fitted = {
    high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  s.durability = 1
  s.armorPct = 1
  state.moduleBay['mod-drone-rack-3'] = (state.moduleBay['mod-drone-rack-3'] ?? 0) + 2
  state.moduleBay['mod-drone-tac-3'] = (state.moduleBay['mod-drone-tac-3'] ?? 0) + 2
  notes.push(`新增王鲭级无人机重装 ${uid}（机舱 460 m³，rack3×2 + tac3×2）——把「流亡蜂无人机」装入清单后开战实测；近防炮会击落机群（战后按回收率 20% 找回）`)
  for (const s2 of Object.values(state.fleet)) {
    if (s2) {
      s2.durability = 1
      s2.armorPct = 1
    }
  }
  notes.push('全舰耐久回满')
  notes.push(
    '测试路径：① 装配页 → 逐件试装 15 件专属装备（对比同级制式件：专属四型定位契约豁免区间校验，数值应明显更强）；' +
      '② 装配页「无人机舱」→ 把「流亡蜂无人机」装入王鲭（切驾驶）→ 星图开战看机群放飞与专属机表现；' +
      '③ 工业页起炉稀有残骸，确认高级箱仍按 5/8/10% 掷骰（本档已把成品直接给到手，开箱链路另见 rarebox 档）。',
  )
  return notes
}

/** shipart（舰船战斗图形目测门槛，2026-09-09 三号）：新规格 240×110 战斗图形全量接入后，
 * 船长真机目测用——钱包/声望/全星系点亮 + 各族代表演示船（逐艘切驾驶开战看形）+ 弹药装备库。
 * 战斗画面重点：我方各族船形（舰首朝右/族色件/引擎挂点/炮口锚/大小比例）与敌族 A~G 型形。 */
function injectShipArt(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 60_000_000
  notes.push('钱包 +60,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13（可接全部悬赏）')
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) state.exploredGalaxies.push(g.id)
  }
  notes.push(`点亮全部星系（${GALAXIES.length}）——各类敌族遭遇均可出发`)
  // 各族代表演示船：驾驶 = 锤头鲨（武装 T3 炮巡 MK3 满配，可扫全段）；其余各族可战对照
  const lineup: Array<[string, string, string[], string[], string[]]> = [
    // [shipId, 自定义名, high, mid, low]
    ['sh-hammerhead', '锤头鲨·炮击巡洋(驾驶)', ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2', 'mod-rof-2'], ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2']],
    ['sh-bullshark', '牛鲨·突击巡洋', ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], ['mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2'], ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2']],
    ['sh-xuanwu', '玄武·重装旗舰', ['mod-turret-kin-2', 'mod-turret-kin-2'], ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2']],
    ['sh-colossal', '皇带鱼·旗舰货舰', ['mod-turret-kin-2', 'mod-turret-kin-2'], ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2']],
    ['sh-humpback', '座头鲸·矿舰', ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], ['mod-shield-kin-2', 'mod-track-2'], ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2']],
  ]
  const uids: string[] = []
  lineup.forEach(([shipId, name, high, mid, low], i) => {
    const uid = addShipToFleet(state, shipId)
    const s = state.fleet[uid]!
    s.customName = name
    s.fitted = { high: [...high], mid: [...mid], low: [...low] }
    if (i === 0) state.shipId = uid
    uids.push(uid)
  })
  notes.push(`新增各族演示船 ×5：${uids[0]}（锤头鲨·炮击巡洋 MK3 满配，已设为驾驶）、${uids[1]}（牛鲨·突击巡洋 MK3）、${uids[2]}（玄武·重装旗舰）、${uids[3]}（皇带鱼·旗舰货舰）、${uids[4]}（座头鲸·矿舰）——舰船页切驾驶逐艘对照造型（武装/重装/航运/工业族）`)
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  notes.push('仓库弹药三型 ×5000（动能炮/激光/导弹各自供弹）')
  for (const m of ['mod-turret-kin-3', 'mod-missile-3', 'mod-laser-3', 'mod-turret-kin-2', 'mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2', 'mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2']) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 3
  }
  notes.push('装备库备 MK2/MK3 武器与支援件 ×3（可自组换装）')
  for (const s of Object.values(state.fleet)) {
    if (s) {
      s.durability = 1
      s.armorPct = 1
    }
  }
  notes.push('全舰耐久回满')
  notes.push('测试路径：星图·战斗悬赏逐敌族开战对照造型——A 海盗（赤潮/碎晶/灰霾/蜃影/边境海盗/信标猎手）、B 武装拾荒者（演习场驱逐令/新港护航/占港拾荒）、C 异形（裂谷畸变/星髓/噬口/深渊之门）、D 守墓（坟场/虚海/穹顶/幽灵舰）、E 泰坦（泰坦残骸/奥罗残骸）、F 制式巡逻（低安遭遇伏击）、G 烬火流亡（烬火/回音/天底静区）；重点看新规格 240×110：舰首朝右、族色件与敌族发光件、尾焰/枪口闪光落点、敌我大小比例、受击/残骸表现、翻转移位；细节锚点与比例问题回传（详见 ship-battle-art 验收清单文档）')
  return notes
}

/** hauling（2026-09-09 长途运输实测）：两座副站标记建成 + 点亮星系 + 大货舱货舰驾驶 */
function injectHauling(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  // 清空进行中主控作业（真档可能在采矿/远征等；运输接单要求空闲停靠）
  state.mining.active = false
  state.salvaging.active = false
  state.expedition.active = false
  state.scanning.active = false
  state.standby.active = false
  state.transit.active = false
  state.autoLoopAnomalyId = null
  state.awayGalaxy = null
  state.dockedSite = null
  if ('deliver' in state.sideTasks && state.sideTasks.deliver !== null) state.sideTasks.deliver = null
  for (const r of state.refineRuns) if (r.active && r.worker === 'pilot') r.active = false
  for (const m of state.manufacturingRuns) if (m.active && m.worker === 'pilot') m.active = false
  notes.push('已清空进行中的主控作业（采矿/打捞/远征/扫描/待命/行程/手动炉线）——从干净停靠起点接运输')
  state.wallet.isk += 3_000_000
  notes.push('钱包 +3,000,000 ISK')
  // 两座副站"建成"（stage = 档位数），并入基地网络 → 与母港互为运输端点
  state.stationSites['site-redring'] = { stage: 3, delivered: {} }
  state.stationSites['site-cinder'] = { stage: 3, delivered: {} }
  notes.push('红环前哨站 / 烬火前哨站 标记建成（并网）；任务中心「长途运输」应出现 3 条航线（母港⇄红环、母港⇄烬火、红环⇄烬火）')
  for (const g of ['galaxy-redring', 'galaxy-cinder']) {
    if (!state.exploredGalaxies.includes(g)) state.exploredGalaxies.push(g)
  }
  notes.push('点亮 红环航道 / 烬火星区')
  // 大货舱演示船（货运本职）：蝠鲼级重载货舰设为驾驶
  const uid = addShipToFleet(state, 'sh-bowhead')
  const s = state.fleet[uid]
  if (s) {
    s.customName = '运输试验·蝠鲼'
    s.durability = 1
    s.armorPct = 1
  }
  state.shipId = uid
  notes.push('新增蝠鲼级重载货舰（已设为驾驶；货仓较大 → 每段报酬可观）')
  notes.push('测试路径：星图 → 星图 →「长途运输」标签 → 任选一条航线「开始运输」→ 顶部活动栏看进度与「停止运输」（= 到站即止）→ 事件日志看每段到站报酬 → 货仓页看「虚拟货物占满货仓」→ 停靠副站后换一条航线 / 切换驾驶（任务终止）对照')
  return notes
}

/** hullrep（2026-09-09 船体维修装置实测）：灰鲭鲨级 ×2——试验船带 MK2 维修装置且带伤出场
 * （装甲 55%：维修上限 = 出场满值 → 开战即可见装甲在脉冲下回升），对照船无装置同配装；
 * 三档装置/两档组件备件齐全，开任意中低威胁悬赏即可观察 5 秒脉冲、组件扣减、耗尽停机与返还。 */
function injectHullrep(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  // 清空进行中主控作业（从干净停靠起点出击）
  state.mining.active = false
  state.salvaging.active = false
  state.expedition.active = false
  state.scanning.active = false
  state.standby.active = false
  state.transit.active = false
  state.autoLoopAnomalyId = null
  state.awayGalaxy = null
  state.dockedSite = null
  if ('deliver' in state.sideTasks && state.sideTasks.deliver !== null) state.sideTasks.deliver = null
  for (const r of state.refineRuns) if (r.active && r.worker === 'pilot') r.active = false
  for (const m of state.manufacturingRuns) if (m.active && m.worker === 'pilot') m.active = false
  notes.push('已清空进行中的主控作业——从干净停靠起点出击')
  state.wallet.isk += 5_000_000
  notes.push('钱包 +5,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 6)
  notes.push('协会声望升至 6（可接各档战斗悬赏）')
  if (!state.exploredGalaxies.includes('galaxy-redring')) state.exploredGalaxies.push('galaxy-redring')
  notes.push('点亮 红环航道')
  // 试验船：灰鲭鲨级 + 船体维修装置 MK2（中槽第 1 位）+ 动能 MK2 四炮 + 盾抗/索敌 —— 设为驾驶
  const uid = addShipToFleet(state, 'sh-mako')
  const s = state.fleet[uid]!
  s.customName = '维修试验·MK2'
  s.fitted = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-hullrep-2', 'mod-shield-kin-2', 'mod-track-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  s.durability = 0.75
  s.armorPct = 0.55 // 带伤出场：维修上限 = 满值 → 开战后装甲可见回升（演示修复能力）
  state.shipId = uid
  // 对照船：同配装但中槽换成 陀螺（无维修）
  const uid2 = addShipToFleet(state, 'sh-mako')
  const s2 = state.fleet[uid2]!
  s2.customName = '无维修·对照'
  s2.fitted = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  notes.push(`新增灰鲭鲨级 ×2：${uid}（维修试验·MK2，已设为驾驶——带伤出场装甲 55%，战斗中自动修复）与 ${uid2}（无维修·对照，舰船页切换对比）`)
  // 补给：试验船货仓带足军用组件（每 5 秒跳耗 1 枚）；对照船同样给足但不会消耗
  for (const sh of [s, s2]) {
    sh.cargo['repairkit-mil'] = (sh.cargo['repairkit-mil'] ?? 0) + 60
    sh.cargo['repairkit-civ'] = (sh.cargo['repairkit-civ'] ?? 0) + 20
    sh.cargo['ammo-kinetic-l'] = (sh.cargo['ammo-kinetic-l'] ?? 0) + 600
    sh.cargo['ammo-plasma-l'] = (sh.cargo['ammo-plasma-l'] ?? 0) + 300
    sh.cargo['ammo-explosive-l'] = (sh.cargo['ammo-explosive-l'] ?? 0) + 300
  }
  notes.push('两船货仓各带 军用修理组件 ×60 / 民用 ×20 + 三型弹药（维修装置开战自动预载，结束退还未用）')
  // 备件：三档装置 + 两档组件（仓库/装备库）
  for (const m of ['mod-hullrep-civ', 'mod-hullrep-1', 'mod-hullrep-2']) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 2
  }
  notes.push('装备库备 三档维修装置 ×2（民用级 / MK1 / MK2——装配页换装对照信息卡数值与 CPU）')
  state.warehouse.items['repairkit-mil'] = (state.warehouse.items['repairkit-mil'] ?? 0) + 300
  state.warehouse.items['repairkit-civ'] = (state.warehouse.items['repairkit-civ'] ?? 0) + 100
  notes.push('仓库补 军用修理组件 ×300 / 民用 ×100（组件不足时装置开战即停机，可先移除货仓组件对照缺料提示）')
  notes.push('测试路径：装配页看 维修装置信息卡（每 5 秒修复量 / 组件消耗 / CPU）→ 星图 → 战斗悬赏（红环「赤潮劫掠舰队」或母港中低威胁目标）开战 → 右上「维修装置运转中 · 组件 ×N」绿点徽标随脉冲呼吸 → 观察装甲/结构血条在受伤后回升 → 事件日志「组件耗尽自动停机」→ 结算后日志/货仓确认未用组件退回仓库 → 舰船页切换「无维修·对照」同目标再打一轮对比')
  return notes
}

/** lockrep（2026-09-09 目标锁定阵列 × 船体维修装置联合实测）：锤头鲨级 ×2——
 * ①「集火+维修·锤头」设为驾驶：4×动能MK3 + 高槽 锁定阵列MK3 + 中槽 维修装置MK2/盾抗/索敌/陀螺，
 *   带伤出场（装甲 60%——开战即见集火金标与修复脉冲同场）；②「无件·对照」同火力无两件；
 * 锁定/维修三档备件与组件齐全（换装看多件递减与停机语义）。声望 13 全悬赏可接（含穹顶长盘）。 */
function injectLockrep(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  // 清空进行中主控作业（从干净停靠起点出击）
  state.mining.active = false
  state.salvaging.active = false
  state.expedition.active = false
  state.scanning.active = false
  state.standby.active = false
  state.transit.active = false
  state.autoLoopAnomalyId = null
  state.awayGalaxy = null
  state.dockedSite = null
  if ('deliver' in state.sideTasks && state.sideTasks.deliver !== null) state.sideTasks.deliver = null
  for (const r of state.refineRuns) if (r.active && r.worker === 'pilot') r.active = false
  for (const m of state.manufacturingRuns) if (m.active && m.worker === 'pilot') m.active = false
  notes.push('已清空进行中的主控作业——从干净停靠起点出击')
  state.wallet.isk += 8_000_000
  notes.push('钱包 +8,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13（全悬赏可接，含穹顶守卫长盘）')
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) state.exploredGalaxies.push(g.id)
  }
  notes.push(`点亮全部星系（${GALAXIES.length}）`)
  // ① 锤头鲨级·集火+维修（设为驾驶，带伤出场）
  const uid = addShipToFleet(state, 'sh-hammerhead')
  const s = state.fleet[uid]!
  s.customName = '集火+维修·锤头'
  s.fitted = {
    high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-lock-3'],
    mid: ['mod-hullrep-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2', null],
  } // CPU 4×52+26(锁)+26(修)+15×4(中)+15×2(低) = 336/360
  s.durability = 0.8
  s.armorPct = 0.6 // 带伤出场：维修上限 = 满值 → 开战后装甲可见回升（演示修复能力）
  state.shipId = uid
  // ② 同火力无件对照（无锁定阵列 / 无维修装置）
  const uid2 = addShipToFleet(state, 'sh-hammerhead')
  const s2 = state.fleet[uid2]!
  s2.customName = '无件·对照'
  s2.fitted = {
    high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', null],
    mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2', null],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2', null],
  }
  notes.push(`新增锤头鲨级 ×2：${uid}（集火+维修·锤头：4×动能MK3 + 锁定阵列MK3 + 维修装置MK2，已设为驾驶——带伤出场装甲 60%）与 ${uid2}（无件·对照，同火力；舰船页切换对比）`)
  // 补给：两船货舱带足组件（维修每 5 秒跳耗 1 枚军用）+ 三型弹药
  for (const sh of [s, s2]) {
    sh.cargo['repairkit-mil'] = (sh.cargo['repairkit-mil'] ?? 0) + 80
    sh.cargo['repairkit-civ'] = (sh.cargo['repairkit-civ'] ?? 0) + 20
    sh.cargo['ammo-kinetic-l'] = (sh.cargo['ammo-kinetic-l'] ?? 0) + 800
    sh.cargo['ammo-plasma-l'] = (sh.cargo['ammo-plasma-l'] ?? 0) + 300
    sh.cargo['ammo-explosive-l'] = (sh.cargo['ammo-explosive-l'] ?? 0) + 300
  }
  notes.push('两船货仓各带 军用修理组件 ×80 / 民用 ×20 + 三型弹药（维修装置开战自动预载，结束退还未用）')
  // 备件：锁定/维修三档 + 火力支援件（自组换装）
  for (const m of ['mod-lock-1', 'mod-lock-2', 'mod-lock-3', 'mod-hullrep-civ', 'mod-hullrep-1', 'mod-hullrep-2']) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 2
  }
  notes.push('装备库备 目标锁定阵列 MK1/2/3 ×2 + 船体维修装置 民用级/MK1/MK2 ×2（装配页换装对照信息卡与多装递减标签）')
  for (const m of ['mod-turret-kin-3', 'mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2', 'mod-stab-kin-2', 'mod-armor-kin-2']) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 2
  }
  notes.push('装备库备 动能MK3 与支援件 ×2（对照船改装/补充用）')
  state.warehouse.items['repairkit-mil'] = (state.warehouse.items['repairkit-mil'] ?? 0) + 300
  state.warehouse.items['repairkit-civ'] = (state.warehouse.items['repairkit-civ'] ?? 0) + 100
  notes.push('仓库补 军用修理组件 ×300 / 民用 ×100')
  notes.push('测试路径：装配页看 锁定阵列/维修装置 信息卡 → 星图 → 带僚机悬赏（深渊之门卫队/幽灵舰信号/奥罗武装残骸群）开战 → 敌方首位敌舰**金色呼吸 + ◈ 集火标记**，观察整队火力逐艘击毁（不再分散磨血）；切「无件·对照」打同目标感受随机分散差异 → 长盘（穹顶守卫 3 波）看维修装置绿点脉冲随受伤回升、组件逐跳扣减 → 装配页加装第 2 件锁定阵列看「多装递减」标签与加深叠加 → 货仓组件清空再开战看「缺组件停机」暗红徽标 → 结算后确认未用组件退回仓库')
  return notes
}

/** abyssgate（2026-09-10 船长「深渊之门给我个存档测试下」）：**能量卡火力重标 + 族系改判的实机验收档**。
 * 本档验收四处（敌速重标的下一批）：
 *   ① **深渊之门卫队 45**：改为**纯能量**（光束必中）+ **移除 0.35 逐卡伤害倍率回退**（该字段已于 2026-09-11 整体退休）+ 远端威力衰减 **0.1**
 *      + **基础单发直写 45**（`foeShotDmg`，推得基础单发本是 90）。
 *      判据：**不堆能量抗 → 打不过（实测 0%）**；**换上能量抗件 → 稳过（实测 100% / 残血约 27%）**。
 *   ② **星髓虫群 72**：移除 0.35 逐卡伤害倍率（该字段已于 2026-09-11 整体退休；基础单发 104.7 全额生效；对主力行是死旋钮、只影响被贴脸的薄皮行）。
 *   ③ **噬口猎杀令 80**：orbit → **brawl**（射程带 7.1km→2.7km、速度 338→426、血量 4000→1844）。
 *   ④ **坟场守墓者 88**：brawl → **orbit**（射程带 2.8km→7.4km、速度 433→345；血量 3600 未动，预期 = E 段墙）。
 * 配装 = **灰鲭鲨 4×动能MK2 + 支援**（与 `battle:calibrate` 的 S2 锚行同源），战斗系 20 项 = Lv3（中位档）。
 * 换抗方式：装备库里备好**盾/甲 × 动能/能量**四系抗性件各 3 件，**换件即换抗**，直接对比承伤。 */
function injectAbyssgate(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 40_000_000
  notes.push('钱包 +40,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13（全悬赏可接：深渊之门 45 / 星髓虫群 72 / 噬口猎杀令 80 / 坟场守墓者 88）')
  let lit = 0
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) {
      state.exploredGalaxies.push(g.id)
      lit++
    }
  }
  notes.push(`星图全部点亮（新增 ${lit} 个）——四张验收卡全部可达`)
  const midSkillIds = [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control',
    'reload-drills', 'drone-warfare', 'drone-servicing', 'ammunition-condensing',
    'shield-operation', 'energy-management', 'hull-upgrades', 'shield-tuning', 'armor-tuning',
    'armed-ops', 'armored-ops', 'vector-maneuvering', 'evasion-maneuvering',
    'targeting-integration', 'ship-systems-engineering',
  ]
  for (const k of midSkillIds) state.skills.trained[k] = 3
  notes.push('战斗系技能 20 项 = Lv3（中位档，与 battle:calibrate 验收行同口径）')
  const uid = addShipToFleet(state, 'sh-mako')
  const s = state.fleet[uid]!
  s.customName = '灰鲭鲨·能量卡验收（只堆主系+MK2推进器）'
  s.fitted = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  s.durability = 1
  s.armorPct = 1
  state.shipId = uid
  notes.push(`新增驾驶船 ${uid}：灰鲭鲨 4×动能MK2 + 支援 + **矢量推进器 MK2**（起手 = 只堆主系抗，即"没堆能量抗"那一端）`)
  const spares = [
    'mod-turret-kin-2', 'mod-shield-kin-2', 'mod-shield-pla-2', 'mod-armor-kin-2', 'mod-armor-pla-2',
    'mod-track-2', 'mod-gyro-2', 'mod-stab-kin-2', 'mod-rof-2',
    // 推进器三档：实测「带/不带推进器」对同一张卡差别极大（深渊之门 0%→40%、星髓残血 81%→100%、
    // 噬口反而更慢），故三档都备件供换装对比
    'mod-prop-1', 'mod-prop-2', 'mod-prop-3',
  ]
  for (const m of spares) state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 3
  notes.push('装备库四系抗性件各 ×3（盾动能 / 盾能量 / 甲动能 / 甲能量）**＋ 推进器 MK1/MK2/MK3 各 ×3**——换件即换抗/换推进器')
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  notes.push('仓库弹药三型 ×5000')
  return notes
}

const INJECTORS: Record<string, (state: GameState) => string[]> = {
  // pd（2026-09-11 机群批 S5）：敌方机群 + 巨构近防炮验收档（三船对照 + 近防炮三档）
  pd: injectPd,
  rarebox: injectRareBox,
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
  shipart: injectShipArt,
  wave: injectWave,
  hauling: injectHauling,
  hullrep: injectHullrep,
  lockrep: injectLockrep,
  etier: injectEtier,
  abyssgate: injectAbyssgate,
  lairgear: injectLairGear,
  dfamily: injectDfamily,
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
