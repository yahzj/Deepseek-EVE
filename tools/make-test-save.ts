/**
 * 测试门槛存档生成器（船长 2026-09-04 约定：B 批次 / 新玩法数值交付时配可测存档）。
 *
 * 用法：npx tsx tools/make-test-save.ts <feature>
 *  - 基于船长当前真档（%APPDATA%\whale-idle\save.json）复制注入（先自动备份原档到输出目录）；
 *  - 只补"难达成的门槛"（资金/声望/星系点亮/舰船/核心/装配弹药等），可达成的操作不代做；
 *  - 产物落 docs/test-saves/test-save-<feature>-<stamp>.json，加载方法见 docs/test-saves/README.md。
 *
 * 功能 case 注册制（扩展在此追加）：
 *  - battleship **战列舰实机测试档**（2026-09-24 船长：「你给我准备一个有战列舰和各种装备的存档」）：
 *         真战列 T4 巨齿鲨（6/5/3 · 动能抗 · 驾驶）＋ T4 均衡对照 ＋ T5 邓氏鱼旗舰 ＋ T3 锤头鲨巡洋对照，
 *         **中低槽装满**、备件 31 种 ×3、弹药三型 ×8000、全星系点亮、声望 13
 *         （起因：二号曾拿"鲸王级采矿艇"当 T3 战列测，结论全错 ⇒ 用真战列实机复核）。
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
 *         重装战列舰/皇带鱼货舰/座头鲸矿舰）+ 弹药装备库（真机目测我方各族船形与敌族 A~G 型形，
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
 *  - lairgear 五族专属装备 15 件 + 鱿蜂无人机 验收（2026-09-10 船长「⑧需要」）：在 rarebox
 *         门槛之上把 14 件专属模块 ×2 直接预置进装备库、专属无人机 ×30 架进仓库、另给王鲭级
 *         无人机重装 ×1（否则专属机无处放飞）——省掉 5/8/10% 掷骰等待，可立刻装配实测。
 *  - pd    敌方机群 + 巨构近防炮验收（2026-09-11 机群批 S5）：三船对照（2×近防炮MK2 + 3×炮台MK2
 *         「推荐打法」/ 纯防空 5×近防炮MK3 / 全主炮对照）+ 能量抗 + 近防炮三档与主炮备件。
 *  - dfamily D 族「守墓古舰」四卡实战复核（2026-09-11 船长追问"是不是该上巡洋舰"）：五船 =
 *         **E 段用 T3 巡洋（锤头鲨）×4 + 灰鲭鲨上一档对照** + 全部 MK3 装备——结论是
 *         "**换抗性系才是主旋钮**"（同型只换 mid/low 抗性件）。
 *  - gswarm G 族「鱿烬亡军」**等离子蜂群**验收（2026-09-12 · P-20a 收口）：四艘**同型对照船**
 *         （T3 锤头鲨，**只差抗性系与武器**：动能抗 / 等离子抗 / 双抗折中 / 4×近防炮向）——
 *         星图 → 天底静区 →「**天底静区封锁 66**」开战：看两架蜂群机的**弹点颜色与弹种**
 *         （等离子已按船长裁决"丙＝换系"上舰、取代爆炸），并实测"**针对性堆等离子抗能不能救回来**"。
 *         （本档存在的理由：机群挂在**单张卡**上，只有同型船对照才能把"抗性选择"从船型/火力差里分出来。）
 *  - wh-all **虫洞全量验收**（2026-09-14 · 船长：「修复后给我准备一个可以全部测试的存档」）：
 *         乱摆货仓（3× 安全货柜 + 2× 谜质储存器 + **2 条老档形状散货宽条** + 8 件散货，实测 42/77 格）·
 *         第 2 层的舰船墓场/遗迹/矿脉/舰船信号/谜质格各一处 · 编队 2×长尾鲨 + 2×玳瑁（四艘都挂作业装）
 *         ⇒ 一档验完「整理 / 大件小件换位 / 抓任意一格拖动」三处修复与整条链路（打捞·采集·惊扰守卫·
 *         交火·谜质增益·货柜拆解）。
 *
 *  - mt-lab **谜质科技实验档**（2026-09-19 · 船长：「给我个拥有谜质和虫洞的存档，我打算实机测试
 *         不同科技的影响」）：谜质 ×2,000 + 信用点 +3B（点满全树 1,196 枚 / 约 1.43B）·
 *         声望 60（过「扫描虫洞」门槛 40）· **货仓刻意空着（纯科技读数）**、仓库另备谜质装置供对照 ·
 *         第 2 层站在「舰船信号」上（脚下按迎战即开打）＋ 同层遗迹/矿脉/谜质格 ·
 *         工业线备料（遗迹货柜五族各 ×4 / 虚空母矿 ×5,000 / 残骸各 ×6）。
 *  - bp-cancel **一次性图纸 · 取消退书实测档**（2026-09-20 · 船长：「给我一个存档实机测试」）：
 *         六种局面 = 单张随手取消 / 多张不同挨个撤退 / **同名两条线（缺口主场景）** /
 *         普通图纸对照（已学会）/ 名额已用尽对照 / 舰船一次性；备料按图纸材料现算 ×5 ·
 *         AI 核心 ×8 ＋ 相关技能拉满（多线并行）。
 *
 * 命名规则（2026-09-08 船长定）：测试存档命名必须符合用途——文件名 <feature> 段 = 注册
 * case 名（即该档服务的唯一测试用途），禁止随意命名；新 case 先注册（本注释 + INJECTORS +
 * docs/test-saves/README.md 档案清单）再生成。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadSaveFile,
  serializeSaveFile,
  addShipToFleet,
  rareWreckItemIdOf,
  RARE_WRECK_VOLUME_M3,
  // 2026-09-16 `wh-logi`（后勤舰验收档）：新物品 id 常量 + 库存项的族/原型现算
  WORMHOLE_ESSENCE_ITEM_ID,
  WORMHOLE_LUXURY_ITEM_IDS,
  wormholeArchetypeOf,
  wormholeFamilyOfSeed,
  // 2026-09-25 `weekend` / `weekendkill`（旗舰战准备档）：入侵现场的三个单点
  weekendRollOccupation,
  // 2026-09-26 `shipwreck`（玩家舰船残骸验收档）：注入残骸的唯一入口
  noteShipWreck,
} from '@whale/core'
import type { GameState } from '@whale/core'
// 满池常量（旗舰 BOSS 血池；`@whale/core` 未转出 ⇒ 走深路径，与本文件既有做法一致）
import { WEEKEND_FLAGSHIP_POOL_HP } from '../packages/core/src/weekendEvent'
import { FACTION_CODEX_ORDER, FOE_SHIPS, GALAXIES, ITEMS, MODULES, SHIPS, SHIP_BLUEPRINTS, buildSimContext } from '@whale/data'
// 虫洞·货仓装不下 / 超载 / 第 4 层星云现场（要用到的核心单点，走深路径，与 `wormhole-econ` 同一套做法）
import { WORMHOLE_ORE_ITEM_ID, wormholeEnter } from '../packages/core/src/wormhole'
import { hexDistance, hexLine, hexNeighbors, isExitCell, gridContentIndex, wormholeMakeGrid } from '../packages/core/src/wormholeGrid'
import {
  wormholeHoldCapacityOf,
  wormholeEnsureSalvagePiles,
  wormholeEnsureVeinPiles,
  wormholeHoldSyncCargo,
  wormholeHoldUsage,
  wormholeSalvagersOf,
  wormholeStowOrTemp,
} from '../packages/core/src/wormholeSalvage'
import { makeHoldState, placementCells } from '../packages/core/src/wormholeHold'
import { wormholeUnitsPerSlot } from '../packages/core/src/wormhole'
// 2026-09-17 `wh-ewar`（劫掠电子舰现场档）：敌卡的**唯一取值点**（与 `wormholeStartBattle` 同一函数，
// 故本档能"先算好是哪张卡、写死现场、再当场断言"）
import { wormholeCardIdForRun } from '../packages/core/src/wormholeFoes'

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
/**
 * **蓝图碎片 · 逆向解锁验收档**（2026-09-19 船长：「帮我准备一个蓝图碎片的存档，玩家反应依旧找不到，
 * 我要实机测试一下」）。
 *
 * 一档同时覆盖 **三种状态**（可兑 / 差几片 / 已掌握），并把主控拉回母港停靠（`redeemFragments` 要求
 * `isAtHomeLike`）——这样"找不到入口"这件事能一次问清是"入口没渲染"还是"位置/材料不满足"：
 * - 仓库 `frag-mod-miner-2` × 25 ⇒ **可兑**（二档书 · 门槛 25）；
 * - 仓库 15 片 ＋ **主控货舱 10 片** 的 `frag-mod-cargo-2` ⇒ **可兑**（门槛 25）——顺带证明"仓库＋货舱一本账"；
 * - 仓库 `frag-mod-miner-3` × 250 ⇒ **可兑**（三档书 · 门槛 250）；
 * - 仓库 `frag-mod-cargo-3` × 120 ⇒ **差 130 片**（按钮应显示 120/250）；
 * - **`bp-turret-3` 保持"已掌握"**（真档原样）⇒ 那一行显示「已解锁配方」，作第三种状态对照。
 *
 * ⚠ 为什么要把其余五本从 `learnedRecipes` 里摘掉：真档已把六本碎片书全部学过（多半从市场买的），
 * 不摘的话六行全是"已解锁配方"、逆向按钮全都不可点——**这也正是玩家报"找不到在哪换"的一种情形**。
 *
 * 入口两处：**物品页 →「蓝图碎片」分组行**（船长裁定甲案的落点）与**货仓页**（同款按钮）。
 */
function injectFragments(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  // 回到母港停靠 + 清空进行中主控作业（逆向研究要求"停靠空间站"）
  state.mining.active = false
  state.salvaging.active = false
  state.expedition.active = false
  state.scanning.active = false
  state.standby.active = false
  state.transit.active = false
  state.autoLoopAnomalyId = null
  state.awayGalaxy = null
  state.dockedSite = null
  for (const r of state.refineRuns) if (r.active && r.worker === 'pilot') r.active = false
  for (const m of state.manufacturingRuns) if (m.active && m.worker === 'pilot') m.active = false
  notes.push('主控已回到母港停靠、清空进行中作业（逆向研究要求停靠空间站）')

  /** 摘掉"已掌握"里指定的蓝图（真档六本全会）——与 `fragmentPoolOf` 的判据反向操作 */
  const forget = (bpId: string): void => {
    state.learnedRecipes = state.learnedRecipes.filter((x) => x !== bpId)
  }
  for (const bp of ['bp-miner-2', 'bp-cargo-2', 'bp-miner-3', 'bp-cargo-3', 'bp-turret-2']) forget(bp)
  notes.push(
    '已把五本碎片书从「已掌握」里摘掉（强化采集器 MK2 / 货舱扩展 MK2 / 精密采集器 MK3 / 折叠货舱扩展 MK3 / ' +
      '重型炮台 MK2）——真档六本都在 learnedRecipes 里，不摘则六行全是"已解锁配方"、按钮全都不可点',
  )

  const put = (itemId: string, n: number): void => {
    state.warehouse.items[itemId] = (state.warehouse.items[itemId] ?? 0) + n
  }
  // ① 二档 · 可兑（25 片）
  put('frag-mod-miner-2', 25)
  notes.push('仓库：强化采集器 MK2 碎片 ×25（门槛 25 ⇒ **可兑**，物品页「蓝图碎片」分组行应出现「逆向解锁 25/25」）')
  // ② 二档 · 可兑（跨仓库＋货舱：15 + 10 = 25）
  put('frag-mod-cargo-2', 15)
  const cargo = state.fleet[state.shipId]?.cargo
  if (cargo) {
    cargo['frag-mod-cargo-2'] = (cargo['frag-mod-cargo-2'] ?? 0) + 10
    notes.push('仓库 15 片 ＋ **当前船货舱 10 片** ＝ 25 片的「货舱扩展 MK2」（门槛 25 ⇒ 可兑；证明仓库与货舱一本账）')
  } else {
    put('frag-mod-cargo-2', 10)
    notes.push('仓库：货舱扩展 MK2 碎片 ×25（门槛 25 ⇒ 可兑）')
  }
  // ③ 三档 · 可兑（250 片）
  put('frag-mod-miner-3', 250)
  notes.push('仓库：精密采集器 MK3 碎片 ×250（门槛 250 ⇒ **可兑**）')
  // ④ 三档 · 差几片（120/250）
  put('frag-mod-cargo-3', 120)
  notes.push('仓库：折叠货舱扩展 MK3 碎片 ×120（门槛 250 ⇒ 应显示 120/250 与"还差 130 片"）')
  // ⑤ 第三种状态：已掌握（保留 bp-turret-3 不摘）
  notes.push('「攻坚炮台 MK3（动能）蓝图」保持已掌握（真档原样）⇒ 那一行应显示「已解锁配方」，作对照')
  notes.push('另「重型炮台 MK2」为 0 片（未集齐的默认显示，作对照）')

  state.wallet.isk += 1_000_000
  notes.push('钱包 +1,000,000 ISK（无关紧要 · 便于顺带看市场与制造）')
  return notes
}

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
  // ⚠ 2026-09-19 残骸合并：稀有残骸按「族 × 地区」并组 ⇒ 这五张卡分别落在 A·低安 / C·低安 /
  //   D·低安 / E·低安 / G·低安 五个组上（本档仍是"五族各一件"，只是名字变成组名）
  const rareSet: Array<[string, string, number]> = [
    ['wreck-rare-a-lo', 'A 海盗·低安', 3],
    ['wreck-rare-c-lo', 'C 异形生物·低安', 2],
    ['wreck-rare-d-lo', 'D 守墓者·低安', 2],
    ['wreck-rare-e-lo', 'E 泰坦巨构·低安', 2],
    ['wreck-rare-g-lo', 'G 鱿烬亡军·低安', 2],
  ]
  const per = RARE_WRECK_VOLUME_M3
  for (const [id, label, count] of rareSet) {
    state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + per * count
    notes.push(`仓库预置稀有残骸「${label}」×${count} 件（${per * count} m³）`)
  }
  notes.push(`合计 11 件稀有残骸（${per * 11} m³）——工业页「残骸回收」里每族一张卡，各带「高级箱」徽标`)
  // ② 普通残骸做对照（不锁量：仍是"整批直到料尽"）
  state.warehouse.items['wreck-d-lo'] = (state.warehouse.items['wreck-d-lo'] ?? 0) + 100
  state.warehouse.items['wreck-c-lo'] = (state.warehouse.items['wreck-c-lo'] ?? 0) + 100
  notes.push('仓库预置普通残骸 守墓者（低安）/异形生物（低安）各 100 m³（对照：普通残骸不锁量、整批拆到料尽）')
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
    ['ore-veldspar', '橄榄岩', 900],
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
  // 2026-09-19 合并：坟场守墓者 → `wreck-d-lo`（守墓者·低安）、深渊之门卫队 → `wreck-c-lo`（异形生物·低安）
  state.warehouse.items['wreck-d-lo'] = (state.warehouse.items['wreck-d-lo'] ?? 0) + 100
  state.warehouse.items['wreck-c-lo'] = (state.warehouse.items['wreck-c-lo'] ?? 0) + 100
  notes.push('仓库预置 守墓者（低安）/异形生物（低安）残骸各 100 m³——工业页「残骸回收」可直接开箱')
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
    // 2026-09-10 船长：梭鱼高槽 5→3（D2 三槽口径）。
    // **2026-09-12 船长口径：无人机船至少要带一件「加射程的高槽装备」**（`drone-relay` 家族）⇒
    // 把 `tac-2` 换成 **`relay-2`（无人机射程 +45%）**；⚠ **两件甲板扩展保留**——
    // 机巢 160 ＋ 2×35 ＝ **230 m³** 正是 D2 清单（assault10+heavy4+sentry1 = 230 m³）的硬门，动不得。
    high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-relay-2'],
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
    // **2026-09-12 口径**：无人机船带一件中继 ⇒ 第二件 `tac-3` 换成 **`relay-3`（无人机射程 +80%）**；
    // 两件甲板扩展保留（机巢 320 ＋ 2×70 ＝ 460 ≥ D3 清单 320 m³，余量充足）。
    high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-relay-3'],
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
  for (const m of ['mod-drone-rack-1', 'mod-drone-rack-2', 'mod-drone-rack-3', 'mod-drone-tac-1', 'mod-drone-tac-2', 'mod-drone-tac-3', 'mod-drone-relay-1', 'mod-drone-relay-2', 'mod-drone-relay-3']) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 2
  }
  notes.push(
    '装备库备 甲板扩展/战术导控/**中继天线** MK1-3 ×2 全套（可自组配装）——' +
      '⚠ **2026-09-12 口径：无人机船至少要带一件「加射程的高槽装备」**（中继天线 MK1/2/3 = +20/45/80%），' +
      '本档两艘无人机船已按此换上中继（各把一件战术导控换掉，**甲板扩展保留**以守住机巢容量）。',
  )
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
      '⚠机群·混装（2×近防炮MK2 + 3×动能炮台MK2）·能量抗——**推荐打法**',
      ['mod-pd-e-2', 'mod-pd-e-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    ],
    [
      '机群·纯防空（5×近防炮MK3）·能量抗——打得下机群、打不死母舰',
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
  notes.push('装备库：**近防炮三档（动能 · +蓝图书市可购）×6** + 主炮/抗性/支援件各 ×6（够三船反复换装对照）')
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

/** lairgear（2026-09-10 船长「⑧需要」）：**五族专属装备 15 件 + 鱿蜂无人机 验收档**。
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
    ['mod-lair-drone-tac-g', 'G 鱿烬'],
    ['mod-lair-drone-relay-g', 'G 鱿烬'],
  ]
  for (const [id] of gear) state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 2
  notes.push(`装备库预置五族专属装备 14 件 ×2（A/C/D/E 各 3 + G 2）——装配页可直接装上实测（无蓝图、不上市场，正常只能靠高级箱掷骰）`)
  // 专属无人机（G 族第 3 件）：物品仓库一次给 30 架（正常一箱 10 架）
  state.warehouse.items['drone-exile-bee'] = (state.warehouse.items['drone-exile-bee'] ?? 0) + 30
  notes.push('物品仓库预置专属无人机「鱿蜂无人机」×30 架（正常一箱 10 架；装配页「无人机舱」装入清单后即可放飞）')
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
    // **2026-09-12 口径**：无人机船至少要带一件「加射程的高槽装备」⇒ 一件 `tac-3` 换 **`relay-3`（+80%）**；
    // 两件甲板扩展保留（机巢 320 ＋ 2×70 ＝ 460）。
    high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-relay-3'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  s.durability = 1
  s.armorPct = 1
  state.moduleBay['mod-drone-rack-3'] = (state.moduleBay['mod-drone-rack-3'] ?? 0) + 2
  state.moduleBay['mod-drone-tac-3'] = (state.moduleBay['mod-drone-tac-3'] ?? 0) + 2
  state.moduleBay['mod-drone-relay-3'] = (state.moduleBay['mod-drone-relay-3'] ?? 0) + 2
  notes.push(
    `新增王鲭级无人机重装 ${uid}（机巢 460 m³，rack3×2 + tac3 + **relay3**）——` +
      '⚠ **2026-09-12 口径：无人机船至少要带一件「加射程的高槽装备」**，本档已按此把一件战术导控换成' +
      '**中继天线 MK3（无人机射程 +80%）**；甲板扩展保留。把「鱿蜂无人机」装入清单后开战实测；' +
      '近防炮会击落机群（战后按回收率 20% 找回）',
  )
  for (const s2 of Object.values(state.fleet)) {
    if (s2) {
      s2.durability = 1
      s2.armorPct = 1
    }
  }
  notes.push('全舰耐久回满')
  notes.push(
    '测试路径：① 装配页 → 逐件试装 15 件专属装备（对比同级制式件：专属四型定位契约豁免区间校验，数值应明显更强）；' +
      '② 装配页「无人机舱」→ 把「鱿蜂无人机」装入王鲭（切驾驶）→ 星图开战看机群放飞与专属机表现；' +
      '③ 工业页起炉稀有残骸，确认高级箱仍按 5/8/10% 掷骰（本档已把成品直接给到手，开箱链路另见 rarebox 档）。',
  )
  return notes
}

/** gswarm（2026-09-12 二号 · P-20a 收口）：**G 族「鱿烬亡军」等离子蜂群验收档**。
 *
 * 为什么需要：P-20a 把「天底封锁舰」的蜂群机由「动能 + 爆炸」换成 **「动能 + 等离子」**
 * （射程 7,000m · 2 架 · 无后备；机型/美术/数值一字未改，**只换系**）。机群挂在
 * **天底静区封锁 66** 这张卡上，要肉眼确认"**等离子的弹点与弹种真的在打**"、以及
 * "**针对性堆等离子抗能不能救回来**"，需要一个能立刻开打、且**同型船只换抗性系**的对照档
 * ——否则读数差会被船型/火力差污染（std 表 A0 与 A1 差 40pp 就是距离口径污染的教训）。
 * 基准船沿用既有参考口径（**T3 巡洋 · 锤头鲨级炮击巡洋舰** 5 高 / 4 中 / 3 低，与 `pd`/`dfamily` 档同源），
 * 四行**只差抗性系与武器**。 */
function injectGSwarm(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 80_000_000
  notes.push('钱包 +80,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13（天底静区封锁要 9；顺带覆盖全部悬赏）')
  let lit = 0
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) {
      state.exploredGalaxies.push(g.id)
      lit++
    }
  }
  notes.push(`星图全部点亮（新增 ${lit} 个）——G 族三卡（烬火围攻战 42 / 回音残舰 52 / **天底静区封锁 66**）全部可达`)
  const midSkillIds = [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control',
    'reload-drills', 'drone-warfare', 'drone-servicing', 'ammunition-condensing',
    'shield-operation', 'energy-management', 'hull-upgrades', 'shield-tuning', 'armor-tuning',
    'armed-ops', 'armored-ops', 'vector-maneuvering', 'evasion-maneuvering',
    'targeting-integration', 'ship-systems-engineering',
  ]
  for (const k of midSkillIds) state.skills.trained[k] = 3
  notes.push('战斗系技能 20 项 = Lv3（中位档，与 battle:calibrate 同口径）')
  const MID_KIN = ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2']
  const MID_PLA = ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2']
  const LOW_KIN = ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2']
  const LOW_PLA = ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2']
  const gun2 = ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2']
  const rows: Array<[string, string[], string[]]> = [
    ['天底·动能抗（旧口径：只堆主系）', [...gun2, 'mod-turret-kin-2', 'mod-turret-kin-2'], MID_KIN, LOW_KIN],
    ['天底·等离子抗（针对蜂群：盾甲全堆副系）', [...gun2, 'mod-turret-kin-2', 'mod-turret-kin-2'], MID_PLA, LOW_PLA],
    ['天底·双抗折中（盾抗等离子 · 甲抗动能）', [...gun2, 'mod-turret-kin-2', 'mod-turret-kin-2'], MID_PLA, LOW_KIN],
    ['天底·近防炮向（打蜂群本身：4×近防炮MK3）', ['mod-pd-e-3', 'mod-pd-e-3', 'mod-pd-e-3', 'mod-pd-e-3', 'mod-turret-kin-2'], MID_PLA, LOW_PLA],
  ]
  const uids: string[] = []
  rows.forEach(([name, high, mid, low], i) => {
    const uid = addShipToFleet(state, 'sh-hammerhead')
    const s = state.fleet[uid]!
    s.customName = name
    s.fitted = { high: [...high], mid: [...mid], low: [...low] }
    s.durability = 1
    s.armorPct = 1
    if (i === 0) state.shipId = uid
    uids.push(uid)
  })
  notes.push(
    `新增**四艘同型对照船**（T3 锤头鲨级炮击巡洋舰，只差抗性系与武器）：${uids.join(' / ')}——舰船页切驾驶即换行`,
  )
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  notes.push('仓库弹药三型 ×5000')
  const mk3 = MODULES.filter((m) => m.id.endsWith('-3')).map((m) => m.id)
  for (const m of mk3) state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 8
  for (const m of [...MID_KIN, ...MID_PLA, ...LOW_KIN, ...LOW_PLA, 'mod-turret-kin-2']) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 6
  }
  notes.push(`装备库预置**全部 MK3 装备**各 ×8（按 id 后缀 -3 自动枚举，共 ${mk3.length} 件）+ 四行用到的抗性/支援/主炮件各 ×6`)
  for (const s2 of Object.values(state.fleet)) {
    if (s2) {
      s2.durability = 1
      s2.armorPct = 1
    }
  }
  notes.push('全舰耐久回满')
  notes.push(
    '测试路径：① 星图 → 天底静区 →「**天底静区封锁 66**」开战：看敌方**两架蜂群机的弹点颜色/弹种**' +
      '（机型资产三型共用同一机体、**颜色按弹型**，等离子与动能的弹点不同色）；' +
      '② 依次切四艘对照船各打一场，对比**残血与时长**——重点看"等离子抗"两行是否明显更耐打；' +
      '③ 第 4 行带 4 门近防炮，可顺带看**我方近防炮打蜂群**（集火：锁定一架到击落才换靶）；' +
      '④ 蜂群 **2 架、无后备**（A3 打光为止不补充）⇒ 先清机群再打母舰是解；' +
      '⑤ 想对照"换系前"手感，可另开 `lairgear`/`dfamily` 档，或让我加一版"爆炸系蜂群"对照档。',
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
    ['sh-xuanwu', '玄武·重装战列舰', ['mod-turret-kin-2', 'mod-turret-kin-2'], ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2']],
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
  notes.push(`新增各族演示船 ×5：${uids[0]}（锤头鲨·炮击巡洋 MK3 满配，已设为驾驶）、${uids[1]}（牛鲨·突击巡洋 MK3）、${uids[2]}（玄武·重装战列舰）、${uids[3]}（皇带鱼·旗舰货舰）、${uids[4]}（座头鲸·矿舰）——舰船页切驾驶逐艘对照造型（武装/重装/航运/工业族）`)
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
  notes.push('测试路径：星图·战斗悬赏逐敌族开战对照造型——A 海盗（赤潮/碎晶/灰霾/蜃影/边境海盗/信标猎手）、B 武装拾荒者（演习场驱逐令/新港护航/占港拾荒）、C 异形（裂谷畸变/星髓/噬口/深渊之门）、D 守墓（坟场/虚海/穹顶/幽灵舰）、E 泰坦（泰坦残骸/奥罗残骸）、遭遇模板（F 族已废弃、四张模板归 A 族：低安遭遇伏击）、G 鱿烬亡军（烬火/回音/天底静区）；重点看新规格 240×110：舰首朝右、族色件与敌族发光件、尾焰/枪口闪光落点、敌我大小比例、受击/残骸表现、翻转移位；细节锚点与比例问题回传（详见 ship-battle-art 验收清单文档）')
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

/**
 * **虫洞验收档**（2026-09-13 · 一号；船长拍板前的实机验收入口）。
 *
 * 为什么需要它：虫洞**施工期对玩家不可见**（入口只在调试模式下渲染、虚空母矿被 `unreleased` 闸门挡着）
 * ⇒ 船长要实机试玩，必须先有个"编队配好、补给够、能直接进洞"的档，而不是手工配 4 艘船。
 *
 * 注入门槛（**按船长 2026-09-13 给的难度基准编队**）：
 * - **4× 长尾鲨级导弹巡（T3 · 5×动能 MK2 + 推进/盾/索敌/稳像/装甲 MK2）** = `wormhole:econ` 的参考编队，
 *   也就是船长原话里的「**4×巡洋 MK2**」；
 * - 另加 **玄武级（T4 战列舰）** 与 **皇带鱼级（T5 旗舰）** 各一艘 ⇒ 准备页可直接看「**过重**」置灰
 *   与「T4 能带、T5 进不去」；
 * - 钱包 +3000 万 ISK（洞内修船/换装）+ 协会声望 13 + 星图全点亮；
 * - 仓库弹药三型 ×5000、修理组件民用/军用各 ×20（承伤持久 ⇒ 出洞修船要用）；
 * - 装备库把用到的 MK2 件各备 4 件（换装对比）。
 *
 * ⚠ **入口可见性**：虫洞入口只在**调试模式**下出现 ⇒ 进游戏前先在 DevTools 执行
 * `localStorage.setItem('whale-idle:debug','1')` 并刷新（与调试面板同一开关）。
 */
function injectWormhole(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 30_000_000
  notes.push('钱包 +30,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13')
  let lit = 0
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) {
      state.exploredGalaxies.push(g.id)
      lit++
    }
  }
  notes.push(`星图全部点亮（新增 ${lit} 个）`)
  for (const k of ['gunnery', 'fire-control', 'reload-drills', 'shield-operation', 'armor-tuning', 'vector-maneuvering', 'evasion-maneuvering', 'targeting-integration']) {
    state.skills.trained[k] = Math.max(state.skills.trained[k] ?? 0, 3)
  }
  notes.push('战斗系 8 项技能 ≥ Lv3（与 wormhole:econ 的参考行同口径）')
  // 4× 巡洋 MK2（= 船长给的难度基准编队）
  const fit = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  const names = ['①', '②', '③', '④']
  for (let i = 0; i < 4; i++) {
    const uid = addShipToFleet(state, 'sh-thresher')
    const s = state.fleet[uid]!
    s.customName = `长尾鲨${names[i]}·虫洞编队（5×动能MK2）`
    s.fitted = { high: [...fit.high], mid: [...fit.mid], low: [...fit.low] }
    s.durability = 1
    s.armorPct = 1
    if (i === 0) state.shipId = uid // 主控 = 第一艘
  }
  notes.push('4× 长尾鲨级导弹巡（T3）· 5×动能 MK2 + 支援三件 = **4×巡洋 MK2 基准编队**（主控 = ①）')
  // T4 战列舰（可带）+ T5 旗舰（必须在准备页置灰）
  const t4 = addShipToFleet(state, 'sh-xuanwu')
  state.fleet[t4]!.customName = '玄武级·T4 战列舰（可带）'
  state.fleet[t4]!.fitted = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-shield-kin-2', 'mod-shield-kin-2', 'mod-track-2'],
    low: ['mod-armor-kin-2', 'mod-armor-kin-2', 'mod-stab-kin-2'],
  }
  const t5 = addShipToFleet(state, 'sh-colossal')
  state.fleet[t5]!.customName = '皇带鱼级·T5 旗舰（进不去）'
  notes.push('另加 玄武级（T4 · 可带）与 皇带鱼级（T5 · 准备页应显示「过重」并置灰）')
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  for (const kit of ['repairkit-civ', 'repairkit-mil']) {
    state.warehouse.items[kit] = (state.warehouse.items[kit] ?? 0) + 20
  }
  notes.push('仓库：弹药三型 ×5000 · 修理组件民用/军用各 ×20（承伤持久，出洞要修船）')
  for (const m of [
    'mod-turret-kin-2', 'mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-stab-kin-2', 'mod-armor-kin-2',
  ]) {
    state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 4
  }
  notes.push('装备库：编队用到的 MK2 件各 +4（换装对比）')
  notes.push('⚠ 入口只在调试模式下出现：DevTools 执行 localStorage.setItem(\'whale-idle:debug\',\'1\') 后刷新')
  return notes
}

/**
 * **虫洞·货仓装不下 / 超载**验收档（船长 2026-09-13：「当玩家打捞/采矿超出了背包容量时会怎么样？
 * 请给我一个这种情况的虫洞存档，我实机测试下」）。
 *
 * `wh-bag`（**装不下**）：货仓 19/20 格已占 ⇒ 只剩 1 格。打捞/采集**不会**变成超载，而是
 * 「**这一批只回收放得下的那几堆，剩下的留在原地**」（打捞器已经开工 ⇒ 那一回合照扣）。
 *
 * `wh-overload`（**超载**）：编队只剩 3 艘（沉船缩容）⇒ 可用格 20→15，货仓仍装 19 格 ⇒ 超载：
 * 扫描/前往/打捞/采集/拾取全封，界面出红条 + 「一键抛到容量内」；**抛货永远可用**（不软锁）。
 *
 * 共同场面：4× 长尾鲨（T3）· 满配搜打撤（高槽 3×炮台 + 打捞器 MK3 + 采集器 MK3）· **第 2 层** ·
 * 站在**舰船墓场**（已铺 3~10 堆残骸）· 同层一格**矿脉**（已扫描、1 回合可达）·
 * 出口已知（信标读过）· 守卫没清（撤离随时可走、深入要先打守卫）。
 */
function injectWormholeBag(state: GameState, overload: boolean): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 30_000_000
  for (const k of ['gunnery', 'fire-control', 'reload-drills', 'shield-operation', 'armor-tuning', 'vector-maneuvering', 'evasion-maneuvering', 'targeting-integration']) {
    state.skills.trained[k] = Math.max(state.skills.trained[k] ?? 0, 3)
  }
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  for (const kit of ['repairkit-civ', 'repairkit-mil']) {
    state.warehouse.items[kit] = (state.warehouse.items[kit] ?? 0) + 20
  }
  notes.push('钱包 +30,000,000 ISK · 战斗系技能 Lv3 · 弹药三型 ×5000 · 修理组件各 ×20')
  // 满配搜打撤编队（2026-09-14 船长「改回高槽」：作业装备回高槽 ⇒ 高槽 3×炮台 + 打捞器 + 采集器）
  const fit = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3', 'mod-miner-3'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  const uids: string[] = []
  for (let i = 0; i < 4; i++) {
    const uid = addShipToFleet(state, 'sh-thresher')
    const s = state.fleet[uid]!
    s.customName = `长尾鲨${['①', '②', '③', '④'][i]}·搜打撤满配（打捞器+采集器在高槽）`
    s.fitted = { high: [...fit.high], mid: [...fit.mid], low: [...fit.low] }
    s.durability = 1
    s.armorPct = 1
    if (i === 0) state.shipId = uid
    uids.push(uid)
  }
  notes.push('4× 长尾鲨级巡洋（T3）· 满配：3×动能 MK2 + 推进/双盾/索敌 + **高槽 打捞器 MK3 + 采集器 MK3** · 低槽 稳像 + 装甲（CPU 226/345）')
  // 进洞（第 2 层）并把场面摆成"站在墓场上、货仓快满"
  const ctx = buildSimContext()
  const seed = 20260913
  /**
   * ⚠ **先清掉在途副本**（与 `wh-layer4` 同款）：真档里若玩家正停在洞里，`wormholeEnter` 会被
   * 「已经在虫洞里了」拒掉（本档目的就是给一个**指定的层**现场 ⇒ 旧的在途状态一律作废；
   * 本工具不写回真档，只产出测试档）。2026-09-14 复现：船长当时正在洞里 ⇒ 本档生成中断。
   */
  state.wormhole = { run: null, lastFleetLost: 0 }
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  const run = state.wormhole.run!
  run.attending = true
  run.depth = 2
  run.grid = wormholeMakeGrid(seed, 2, 0)
  const grid = run.grid
  const cells = grid.cells
  const pick = (i: number): (typeof cells)[number] => cells[i % cells.length]!
  // 当前格 = 舰船墓场（铺 3~10 堆普通残骸 + 每 3 堆判一次的稀有残骸）
  const here = pick(3)
  here.place = 'graveyard'
  here.piles = []
  grid.pos = { q: here.q, r: here.r }
  grid.start = { q: here.q, r: here.r }
  if (!grid.visited.includes(here.key)) grid.visited.push(here.key)
  if (!grid.scanned.includes(here.key)) grid.scanned.push(here.key)
  wormholeEnsureSalvagePiles(state, here)
  notes.push(`第 2 层 · 站在舰船墓场（Q${here.q} R${here.r}）：已铺 ${(here.piles ?? []).length} 堆残骸（稀有在前）`)
  // 一格矿脉（扫出来，走过去 1 回合就能测"采集装不下"）
  const vein = pick(9)
  if (vein.key !== here.key) {
    vein.place = 'vein'
    vein.piles = []
    wormholeEnsureVeinPiles(state, vein)
    if (!grid.scanned.includes(vein.key)) grid.scanned.push(vein.key)
    notes.push(`同层矿脉（Q${vein.q} R${vein.r}）：${(vein.piles ?? []).length} 堆虚空母矿 · 已扫描（点地图前往，1 回合）`)
  }
  // 出口已知（信标读过）⇒ 撤离/深入都能试；守卫故意**没清**
  grid.exitKnown = true
  const exitKey = `${grid.exit.q},${grid.exit.r}`
  if (!grid.scanned.includes(exitKey)) grid.scanned.push(exitKey)
  run.bossCleared = 0
  run.turnsLeft = Math.max(run.turnsLeft, 18)
  /**
   * **把货仓填到只剩 2 格**（按真实容量算）：网格 8 列 ⇒ 一条货条最多横着占满一整行（8 格），
   * 所以用**多种货**各切一条 8 格（背包不变式：一种物品一条；单条 26 格横竖都放不下 ⇒ 会直接判超载）。
   * 留 2 格 < 一批打捞量（= 编队打捞器台数，4 艘各 1 台 MK3）⇒ 一点打捞就会撞上"装不下"。
   */
  run.hold = undefined as never
  const capCells = wormholeHoldCapacityOf(state, ctx)
  const fillTarget = Math.max(1, capCells - 2)
  const fillIds = ITEMS.filter((i) => i.kind === 'ore' || i.kind === 'mineral').map((i) => i.id)
  run.bag = []
  let left = fillTarget
  for (const id of fillIds) {
    if (left <= 0) break
    const take = Math.min(8, left) // 8 格 = 一整行（unitM3 = 1 ⇒ 500 单位/格）
    run.bag.push({ itemId: id, units: take * 500 })
    left -= take
  }
  if (left > 0) throw new Error(`货仓填充不足：还差 ${left} 格（可用的原矿/矿物条目不够切条）`)
  wormholeHoldSyncCargo(state, ctx)
  const cap = wormholeHoldUsage(state, ctx)
  notes.push(
    `货仓：按真实容量填到**只剩 ${cap.capacity - cap.used} 格**（已用 ${cap.used}/${cap.capacity} 格 · ` +
      `每条 8 格铺满整行、共 ${run.bag.length} 种货）· 一批打捞量 = ${wormholeSalvagersOf(state, ctx)} 台打捞器`,
  )
  if (overload) {
    run.fleet = run.fleet.slice(0, 3)
    state.wormhole.lastFleetLost = 1
    const after = wormholeHoldUsage(state, ctx)
    notes.push(
      `**已造成超载**：编队只剩 3 艘（模拟沉船）⇒ 可用格 ${after.capacity} 格、货仓仍装 ${after.used} 格 ⇒ 超载 = ${after.overload}`,
    )
    notes.push('试法：点个地点会提示「货仓超载…先抛货」；到「背包」页点「一键抛到容量内」或逐条抛弃 ⇒ 立刻恢复可动')
  } else {
    notes.push('试法：点「打捞」⇒ 只回收放得下的那几堆，并提示「货仓放不下：这一批只回收了 N 堆，剩下的仍留在原处」')
  }
  notes.push('⚠ 入口只在调试模式下出现：DevTools 执行 localStorage.setItem(\'whale-idle:debug\',\'1\') 后刷新')
  return notes
}

/**
 * **虫洞 · 第 4 层「星云现场」验收档**（2026-09-13 · 船长：「给我准备一个4层的存档，我打算实际测试」）。
 *
 * 为什么要单开一档：星云机制**只在层 4 起出现**（`WORMHOLE_NEBULA_MIN_DEPTH = 4`），
 * 而从层 1 打下去要连过三层守卫 + 三层搜打撤（十几分钟）⇒ 手工验不到这条机制。
 *
 * 现场（**确定性摆位**，同 seed 每次一样）：
 * - **第 4 层**（37 格 · R=3）；编队 = 4× 长尾鲨满配搜打撤（同 `wh-bag` 档），
 *   回合预算按**真实入场校验**给（`wormholeEnter` ⇒ 4×T3 = 53 回合，不是拍脑袋写的数）；
 * - **入口格脚下就是一处舰船墓场**（铺好残骸，落地即可试打捞）；
 * - **入口格的正邻格 = 一处遗迹，且被星云罩住**（`nebula: true` —— 与引擎生成时一样，
 *   只长在"有信号的地点"上）⇒ 原地扫一次就**看见云**（信号读不出来），**再扫一次驱散**、
 *   遗迹信号显形，走过去打捞即得 **2~3 件稀有残骸**；
 * - 本层还有引擎自己撒的**另外几格星云**（层 4 配额 = 4 格）⇒ 顺带能看"整盘有几处云"；
 * - **守卫没清**（`bossCleared = 0`）⇒ 撤离随时可走、深入要先打守卫；
 * - **入口没标**（`exitKnown = false`：信标没读、出口格也还没扫到）⇒ 出口要靠找信标，与正常一趟一致
 *   （⚠ 2026-09-16 甲案起：**扫到出口格本身**也会把它标上地图）。
 *
 * 试法（进游戏后）：
 * 1. 先在 DevTools 跑 `localStorage.setItem('whale-idle:debug','1')` 再刷新（虫洞入口只在调试模式渲染）；
 * 2. 若面板停在"准备页"，点**继续**（本档 `attending = true`，人在洞里）；
 * 3. 点「**扫描**」⇒ 看地图上出现**云团图标**（比"未扫描"的蓝灰虚线更深一档）与提示
 *    「N 格被星云遮挡——在原位再扫描一次即可驱散」；
 * 4. **原地再点一次「扫描」**⇒ 云散、那一格显形为**残骸信号**；走过去 ⇒ 打捞 ⇒ 稀有残骸 2~3 件；
 * 5. 顺带核对：**层 1~3 不该有云**（本档直接在第 4 层，可另用 `wormhole` 档从层 1 看起）。
 */
function injectWormholeLayer4(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 30_000_000
  notes.push('钱包 +30,000,000 ISK（洞内修船/换装）')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13')
  for (const k of ['gunnery', 'fire-control', 'reload-drills', 'shield-operation', 'armor-tuning', 'vector-maneuvering', 'evasion-maneuvering', 'targeting-integration']) {
    state.skills.trained[k] = Math.max(state.skills.trained[k] ?? 0, 3)
  }
  notes.push('战斗系 8 项技能 ≥ Lv3（与 wormhole:econ 的参考行同口径）')
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  for (const kit of ['repairkit-civ', 'repairkit-mil']) {
    state.warehouse.items[kit] = (state.warehouse.items[kit] ?? 0) + 20
  }
  notes.push('弹药三型 ×5000 · 修理组件民用/军用各 ×20（承伤持久，出洞要修船）')
  // 满配搜打撤编队（2026-09-14「改回高槽」：作业装备在高槽，与 `wh-bag` 同款）
  const fit = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3', 'mod-miner-3'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  const uids: string[] = []
  for (let i = 0; i < 4; i++) {
    const uid = addShipToFleet(state, 'sh-thresher')
    const s = state.fleet[uid]!
    s.customName = `长尾鲨${['①', '②', '③', '④'][i]}·搜打撤满配`
    s.fitted = { high: [...fit.high], mid: [...fit.mid], low: [...fit.low] }
    s.durability = 1
    s.armorPct = 1
    if (i === 0) state.shipId = uid
    uids.push(uid)
  }
  notes.push('4× 长尾鲨级巡洋（T3）· 3×动能 MK2 + 推进/双盾/索敌 + 高槽 打捞器 MK3 + 采集器 MK3 · 低槽 稳像 + 装甲（CPU 226/345）')
  const ctx = buildSimContext()
  const seed = 20260913
  /**
   * ⚠ **先清掉在途副本**：真档里若玩家正停在洞里，`wormholeEnter` 会被「已经在虫洞里了」拒掉
   * （本档目的就是给一个**指定的层**现场 ⇒ 旧的在途状态一律作废；本工具不写回真档，只产出测试档）。
   */
  state.wormhole = { run: null, lastFleetLost: 0 }
  // 入场校验走真引擎（借它算回合预算与总质量，不手写数字）
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  const run = state.wormhole.run!
  run.attending = true
  run.depth = 4
  run.turnsLeft = enter.run!.turnsTotal // 满预算（4×T3 = 32 回合）
  run.turnsTotal = enter.run!.turnsTotal
  run.bossCleared = 0 // 本层守卫没清：撤离随时可走、深入先打守卫
  run.grid = wormholeMakeGrid(seed, 4, 0)
  const grid = run.grid
  const here = grid.cells.find((c) => c.key === `${grid.start.q},${grid.start.r}`)!
  // ① 入口格脚下 = 舰船墓场（铺真残骸：普通 + 按概率的稀有）
  here.place = 'graveyard'
  here.piles = []
  grid.pos = { q: here.q, r: here.r }
  wormholeEnsureSalvagePiles(state, here)
  notes.push(
    `第 4 层（37 格 · R=3）· 入口格 (Q${here.q} R${here.r}) = 舰船墓场：已铺 ${(here.piles ?? []).length} 堆残骸`,
  )
  // ② 入口格的**正邻格** = 一处遗迹，并**手动罩上星云**（与引擎生成时同款：只长在有信号的地点上）
  const neighbor = hexNeighbors(grid.pos)
    .map((n) => ({ n, cell: grid.cells.find((c) => c.key === `${n.q},${n.r}`) }))
    .find((x) => !!x.cell && x.cell.key !== here.key)
  if (neighbor?.cell) {
    const ruins = neighbor.cell
    ruins.place = 'ruins'
    ruins.piles = []
    ruins.nebula = true
    delete grid.dispersed
    notes.push(
      `**星云现场**：入口格正邻 (Q${ruins.q} R${ruins.r}) = 遗迹 + **星云罩住** ` +
        `⇒ 原地点「扫描」先看到云（信号读不出），**再点一次「扫描」驱散** ⇒ 显形为残骸信号` +
        ` ⇒ 走过去打捞得稀有残骸 2~3 件`,
    )
  } else {
    notes.push('⚠ 没找到入口格的邻格（异常）——星云现场没摆成')
  }
  // ③ 本层其余星云由引擎自己撒（层 4 配额 = 4 格，含上面那格）
  const nebs = grid.cells.filter((c) => c.nebula === true)
  notes.push(`本层星云共 ${nebs.length} 格（层 4 配额；空地与下一层入口都不长云）`)
  // ④ 信标没读（出口要靠找），同层再摆一格**未罩云的遗迹**做对照（走过去能看信号）
  const plainRuins = grid.cells.find((c) => c.place === 'ruins' && c.nebula !== true && c.key !== here.key)
  if (plainRuins) notes.push(`对照：同层另有一处遗迹 (Q${plainRuins.q} R${plainRuins.r}) **没有被云罩**——扫到即可读信号`)
  grid.exitKnown = false
  notes.push('守卫没清（撤离随时可走、深入要先打守卫）· 信标没读（出口要靠找）')
  notes.push('⚠ 入口只在调试模式下出现：DevTools 执行 localStorage.setItem(\'whale-idle:debug\',\'1\') 后刷新')
  return notes
}

/**
 * **虫洞 · 全量验收档**（2026-09-14 · 船长：「修复后给我准备一个可以全部测试的存档」）。
 *
 * 为什么需要它：今天修的三处摆位 BUG（**整理后重叠** / **大件小件换位后重叠** / **抓非左上角拖动被判"放不下"**）
 * 只有在**乱摆的货仓**上才验得出来；同时虫洞其它链路（打捞 · 采集 · 遗迹惊扰守卫 · 舰船信号交火 ·
 * 谜质装置增益 · 安全货柜拆解）也都在这一档里顺手能试 ⇒ **一档走完全部**。
 *
 * 现场（确定性摆位，同 seed 每次一样）：
 * - **第 2 层**；编队 = **2× 长尾鲨级（T3 · 搜打撤满配）＋ 2× 玳瑁级（T3 · 重装 4/4/5 槽）**——今天测的是货仓管理，
 *   借两艘重装巡舰把货仓放大到 **77 格**（回合预算走真引擎 `wormholeEnter` 算，不手写数字）；
 * - **入口格 = 舰船墓场**（已铺残骸，落地即可打捞）；
 * - 同层另有：**遗迹**（打捞 ⇒ 「惊扰守卫」确认 ⇒ 恶战）· **矿脉**（采集虚空母矿）·
 *   **舰船信号**（到达即交火）· **谜质格**（激活取回一台谜质储存器）；
 * - **出口已知 + 守卫没清** ⇒ 撤离随时可走、深入要先打守卫；
 * - **货仓故意乱摆**：3 件遗迹安全货柜（2×2）· 2 台谜质储存器（2×2 · 增益立刻可见）·
 *   **2 条老档形状的散货宽条（8 格 / 6 格）** · 8 件散货（各 1 格）——大件小件穿插、四周留空，
 *   正好对上今天修的三处摆位。
 *
 * 试法（详见 `docs/test-saves/README.md` 同名条目）：
 * 1. DevTools 执行 `localStorage.setItem('whale-idle:debug','1')` 后刷新（虫洞入口只在调试模式渲染）；
 * 2. 星图 →「进入虫洞」→ 若停在准备页就点**继续**（本档人在洞里）；
 * 3. **货仓页**：① 抓**货柜/谜质的任意一格**（别只抓左上角）拖到空格 ⇒ 应正确落位；
 *    ② 抓货柜拖到**散货**那格 ⇒ 两件**换位**且不重叠；③ 抓**宽条**拖到货柜上 ⇒ 提示
 *    「形状对不上，换不了位置」且**谁都不动**（旧版会把两件压在一起）；④ 点「**整理**」⇒ 全部重排、
 *    互不重叠、件数不变（旧版会留下压在一起的件）；
 * 4. **探索页**：遗迹打捞 ⇒ 先弹「惊扰守卫」确认条；舰船信号格到达即交火（顺手看敌舰爆炸）；
 *    矿脉采集；谜质格激活取回装置（货仓多一个 2×2、顶部增益立刻多一条）；
 * 5. 撤离回基地 ⇒ 工业页「安全货柜拆解」（调试模式可见）：仓库里五族货柜**各 2 件**，可连拆。
 */
function injectWormholeAll(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 30_000_000
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  for (const k of ['gunnery', 'fire-control', 'reload-drills', 'shield-operation', 'armor-tuning', 'vector-maneuvering', 'evasion-maneuvering', 'targeting-integration']) {
    state.skills.trained[k] = Math.max(state.skills.trained[k] ?? 0, 3)
  }
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  for (const kit of ['repairkit-civ', 'repairkit-mil']) {
    state.warehouse.items[kit] = (state.warehouse.items[kit] ?? 0) + 20
  }
  const BOXES = ['box-relic-a', 'box-relic-c', 'box-relic-d', 'box-relic-e', 'box-relic-g']
  for (const b of BOXES) state.warehouse.items[b] = (state.warehouse.items[b] ?? 0) + 2
  notes.push('钱包 +30,000,000 ISK · 协会声望 13 · 战斗系技能 Lv3 · 弹药三型 ×5000 · 修理组件各 ×20')
  notes.push(`仓库：五族遗迹安全货柜**各 2 件**（${BOXES.join(' / ')}）⇒ 工业页可连拆`)
  // 编队：2× 长尾鲨（T3 搜打撤满配，与 wh-bag 同款）+ 2× 玳瑁（T3 重装 4/4/5 槽，把货仓放到 77 格）
  const uids: string[] = []
  /** 舰型分工：长尾鲨 = 主战（3×动能 MK2 + 作业装）；玳瑁 = 重装（360 装甲）——四艘**都挂作业装**（打捞器 + 采集器 MK3，2026-09-14「改回高槽」后在高槽） */
  const thresherFit = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3', 'mod-miner-3'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  const hawksbillFit = {
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3', 'mod-miner-3'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-armor-plate-2'],
  }
  const fleetPlan: Array<[string, string, typeof thresherFit]> = [
    ['sh-thresher', '长尾鲨①·主战（搜打撤满配）', thresherFit],
    ['sh-thresher', '长尾鲨②·主战（搜打撤满配）', thresherFit],
    ['sh-hawksbill', '玳瑁①·重装（360 装甲 + 作业装）', hawksbillFit],
    ['sh-hawksbill', '玳瑁②·重装（360 装甲 + 作业装）', hawksbillFit],
  ]
  for (const [shipId, name, fit] of fleetPlan) {
    const uid = addShipToFleet(state, shipId)
    const s = state.fleet[uid]!
    s.customName = name
    s.fitted = { high: [...fit.high], mid: [...fit.mid], low: [...fit.low] }
    s.durability = 1
    s.armorPct = 1
    if (uids.length === 0) state.shipId = uid
    uids.push(uid)
  }
  notes.push(
    '编队（**入场封顶 4 艘 · 总质量上限 16,000**）：2× 长尾鲨级巡洋（T3 · 3×动能 MK2）＋ ' +
      '2× 玳瑁级重装巡舰（T3 · 9,600 m³ / 艘 · 4/4/5 槽），**四艘都挂 打捞器 MK3 + 采集器 MK3（高槽）**' +
      '——今天测货仓管理，借两艘重装巡舰把货仓放大（4×T3 = 14,000 质量，仍在上限内；' +
      '玳瑁货舱 2026-09-15 由 12,000 下调到 9,600，本档说明同步）',
  )
  const ctx = buildSimContext()
  const seed = 20260914
  state.wormhole = { run: null, lastFleetLost: 0 } // 清掉在途副本（本档要指定现场）
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  const run = state.wormhole.run!
  run.attending = true
  run.depth = 2
  run.turnsLeft = enter.run!.turnsTotal
  run.turnsTotal = enter.run!.turnsTotal
  run.bossCleared = 0
  run.grid = wormholeMakeGrid(seed, 2, 0)
  notes.push(
    `本档货仓 = **${wormholeHoldCapacityOf(state, ctx)} 格**（编队各自货仓 ÷ 500 **现算**：技能与装配一变就跟着变）`,
  )
  const grid = run.grid
  const cells = grid.cells
  const pick = (i: number): (typeof cells)[number] => cells[i % cells.length]!
  /** 扫过 + 走过（本档要"地图已知、落地即测"） */
  const reveal = (c: (typeof cells)[number]): void => {
    if (!grid.scanned.includes(c.key)) grid.scanned.push(c.key)
    if (!grid.visited.includes(c.key)) grid.visited.push(c.key)
  }
  // ① 入口格 = 舰船墓场（铺真残骸）
  const here = pick(0)
  here.place = 'graveyard'
  here.piles = []
  grid.pos = { q: here.q, r: here.r }
  grid.start = { q: here.q, r: here.r }
  reveal(here)
  wormholeEnsureSalvagePiles(state, here)
  notes.push(`第 2 层 · 入口格 (Q${here.q} R${here.r}) = **舰船墓场**：已铺 ${(here.piles ?? []).length} 堆残骸`)
  // ② 同层四格：遗迹（惊扰守卫）/ 矿脉（采集）/ 舰船信号（到达即交火）/ 谜质（取回装置）
  const ruins = pick(1)
  const vein = pick(2)
  const ship = pick(3)
  const matter = pick(4)
  for (const [cell, place, label] of [
    [ruins, 'ruins', '遗迹'],
    [vein, 'vein', '矿脉'],
    [ship, 'ship', '舰船信号'],
    [matter, 'matter', '虫洞谜质'],
  ] as const) {
    if (cell.key === here.key) continue
    cell.place = place
    cell.piles = []
    reveal(cell)
    if (place === 'ruins') wormholeEnsureSalvagePiles(state, cell)
    if (place === 'vein') wormholeEnsureVeinPiles(state, cell)
    notes.push(`同层**${label}** (Q${cell.q} R${cell.r})：${place === 'ruins' ? `已铺 ${(cell.piles ?? []).length} 堆稀有残骸 ⇒ 打捞即「惊扰守卫」` : place === 'vein' ? `已铺 ${(cell.piles ?? []).length} 堆虚空母矿 ⇒ 采集` : place === 'ship' ? '已知敌格 ⇒ 走过去即交火（对照：未扫描的敌格会先发事件提醒、确认后才开战）' : '激活取回一台谜质储存器（货仓多一个 2×2）'}`)
  }
  grid.exitKnown = true
  notes.push('出口已知（可随时撤离/深入）· 守卫没清（深入要先打守卫）')
  /**
   * ③ **货仓乱摆现场**（本档的重点）：先用**真收货路径**把 2 台谜质储存器 + 3 件货柜摆进去
   * （`wormholeStowOrTemp` = 打捞/拾取的唯一入口），再手工把它们挪到"穿插"的坐标上；
   * 散货则直接写件（**不调 `wormholeHoldSyncCargo`**——那样 8 格宽条会被重排成一件一格，
   * 就没有"大件↔小件换位"的现场可测了）。
   */
  run.bag = []
  run.hold = makeHoldState()
  const stow = (itemId: string): void => {
    const r = wormholeStowOrTemp(state, ctx, itemId, 1)
    if (!r.ok) throw new Error(`摆货失败（${itemId}）：${r.error ?? ''}`)
  }
  for (const b of ['box-relic-a', 'box-relic-c', 'box-relic-d']) stow(b)
  stow('mat-chrono') // 时序核心：回合 +10（立刻能在增益里看见）
  stow('mat-crane') // 打捞吊臂：每台装置额外打捞
  notes.push('货仓：3× 安全货柜（2×2）＋ 2× 谜质储存器（2×2 · **时序核心**与**打捞吊臂**，增益立刻生效）')
  // 散货：2 条老档形状宽条（8 格 / 6 格）+ 8 件 1 格
  const cargoIds = ITEMS.filter((i) => i.kind === 'ore' || i.kind === 'mineral').map((i) => i.id)
  const perSlotOf = (itemId: string): number => wormholeUnitsPerSlot(ctx.items.get(itemId)?.unitM3 ?? 1)
  const barA = cargoIds[0]!
  const barB = cargoIds[1]!
  run.bag.push({ itemId: barA, units: 8 * perSlotOf(barA) })
  run.bag.push({ itemId: barB, units: 6 * perSlotOf(barB) })
  const singles = cargoIds.slice(2, 10)
  for (const id of singles) run.bag.push({ itemId: id, units: perSlotOf(id) })
  const hold = run.hold
  const placeCargo = (itemId: string, x: number, y: number, units: number, w = 1, h = 1): void => {
    hold.placements.push({ id: `${itemId}#${x},${y}`, itemId, kind: 'cargo', units, x, y, w, h })
  }
  placeCargo(barA, 0, 5, perSlotOf(barA) * 8, 8, 1) // 8 格宽条（老档形状）⇒ 换位拒绝路径
  placeCargo(barB, 1, 6, perSlotOf(barB) * 6, 6, 1) // 6 格宽条（老档形状）
  // 8 件 1 格散货：落在"大件之间的缝里"（确定性乱摆）
  const scattered: Array<[number, number]> = [[7, 0], [7, 1], [7, 2], [5, 2], [5, 3], [0, 2], [1, 2], [0, 3]]
  singles.forEach((id, i) => {
    const [x, y] = scattered[i % scattered.length]!
    placeCargo(id, x, y, perSlotOf(id))
  })
  // 把 5 件 2×2 挪到"穿插"坐标（大件彼此错开、四周留空 ⇒ 整理看得出重排效果）
  const shapedSpots: Array<[number, number]> = [[0, 0], [3, 2], [5, 0], [2, 0], [6, 3]]
  const shaped = hold.placements.filter((p) => p.kind === 'box')
  if (shaped.length !== 5) throw new Error(`形状件数不对：${shaped.length}（应为 5）`)
  shaped.forEach((p, i) => {
    const [x, y] = shapedSpots[i % shapedSpots.length]!
    p.x = x
    p.y = y
  })
  /** 自检：不重叠 + 装在容量内 + 留出打捞空间（摆位错就当场报，别把坏档交给船长） */
  const occupied = new Set<string>()
  for (const p of hold.placements) {
    for (const c of placementCells(p)) {
      const k = `${c.x},${c.y}`
      if (occupied.has(k)) throw new Error(`货仓摆位自检失败：${k} 被两件同时占住`)
      occupied.add(k)
    }
  }
  const cap = wormholeHoldCapacityOf(state, ctx)
  const usage = wormholeHoldUsage(state, ctx)
  if (usage.overload) throw new Error(`货仓摆位自检失败：超载（${usage.used}/${usage.capacity}）`)
  if (usage.unplacedCells !== 0) throw new Error(`货仓摆位自检失败：有 ${usage.unplacedCells} 格货没落在网格里`)
  if (cap - usage.used < 6) throw new Error(`货仓留空不足（${cap - usage.used} 格）——打捞/采集会立刻装不下`)
  notes.push(
    `货仓乱摆现场：**已用 ${usage.used} / ${cap} 格**（货柜+装置 ${usage.shapeCells} 格 · 散货 ${usage.cargoCells} 格 · ` +
      `其中 2 条是**老档形状宽条**），四周留空 ${cap - usage.used} 格 ⇒ 打捞/采集都有地方放`,
  )
  notes.push('⚠ 老档宽条只是本档的"复现现场"：任何一次装货同步（拾取/打捞/采集）都会把它们重排成**一件一格**，那是新口径的正常行为')
  notes.push('⚠ 入口只在调试模式下出现：DevTools 执行 localStorage.setItem(\'whale-idle:debug\',\'1\') 后刷新')
  return notes
}

/**
 * **虫洞 · 路径拦截验收档**（2026-09-16 · 船长「路径拦截」机制）。
 *
 * 要让船长**一点就能看见三种结果**，现场必须把三条直线摆成三种形态（其余格保持生成原样）：
 * - **① 拦路者已知** ⇒ 点目标时弹「路径上有**敌人阻拦**（Q?,R?）」，地图上那一格**描红指名**；
 * - **② 拦路者未扫描** ⇒ 弹「路径上**可能**有敌人阻拦」，地图**只把路径线置警示色、不指名**
 *   （§5.2 甲案：不给未扫描格上信号色）；
 * - **③ 路径干净** ⇒ 不弹确认、直接到达。
 * 另附一条**打完再看**：① 那条打赢后停在被拦格，**再点一次同一目标应直达**（拦路者已清）。
 *
 * ⚠ 做法：三条线各自把**中间格清成空地**再按要求摆敌人（真盘本来就有随机舰船信号 ⇒ 不清线就说不清是谁拦的）；
 * 三个目标格一律**已扫描但不曾到达**（否则会是"去过"的暗格，看不出是目的地）。
 */
function injectWormholeIntercept(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 5_000_000
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 45)
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 3_000
  }
  for (const kit of ['repairkit-civ', 'repairkit-mil']) {
    state.warehouse.items[kit] = (state.warehouse.items[kit] ?? 0) + 20
  }
  notes.push('钱包 +5,000,000 ISK · 协会声望 45（虫洞已解锁）· 弹药三型 ×3000 · 修理组件各 ×20')
  const ctx = buildSimContext()
  const seed = 20260916
  state.wormhole = { run: null, lastFleetLost: 0 } // 清掉在途副本（本档要指定现场）
  const uids: string[] = []
  for (let i = 0; i < 2; i++) {
    const uid = addShipToFleet(state, 'sh-thresher')
    const s = state.fleet[uid]!
    s.customName = `长尾鲨${i + 1}·拦截验收`
    s.fitted = {
      high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3', 'mod-miner-3'],
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
      low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
    }
    s.durability = 1
    s.armorPct = 1
    if (i === 0) state.shipId = uid
    uids.push(uid)
  }
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  const run = state.wormhole.run!
  run.attending = true
  run.turnsLeft = enter.run!.turnsTotal
  run.turnsTotal = enter.run!.turnsTotal
  run.bossCleared = 0
  /**
   * **层 3**（R=3 · 37 格）：层 1 只有 19 格，容不下**三条互不干扰**的验收直线
   * （首版在层 1 上跑，三元搜索直接判"盘面太小"）。
   */
  run.depth = 3
  run.grid = wormholeMakeGrid(seed, 3, 1)
  const grid = run.grid
  const here = { q: grid.pos.q, r: grid.pos.r }
  const cellAt = (q: number, r: number): (typeof grid.cells)[number] => {
    const c = grid.cells.find((x) => x.key === `${q},${r}`)
    if (!c) throw new Error(`盘里没有格 ${q},${r}`)
    return c
  }
  const reveal = (c: (typeof grid.cells)[number]): void => {
    if (!grid.scanned.includes(c.key)) grid.scanned.push(c.key)
  }
  /** 把这条连线的**中间格**清成空地并揭开（`keepHidden` 那一格例外：甲案要它保持未扫描） */
  const prepLine = (target: (typeof grid.cells)[number], keepHidden?: string): Array<{ q: number; r: number }> => {
    const line = hexLine(here, { q: target.q, r: target.r })
    for (let i = 1; i < line.length - 1; i++) {
      const c = cellAt(line[i]!.q, line[i]!.r)
      c.place = 'empty'
      c.piles = []
      grid.activated = grid.activated.filter((k) => k !== c.key)
      if (c.key !== keepHidden) reveal(c)
    }
    return line
  }
  /** 三个目标格：已扫描、没到过、不是出口格、离玩家 ≥3 格（按距离与 key 稳定排序） */
  const cands = grid.cells
    .filter(
      (c) =>
        c.key !== `${here.q},${here.r}` &&
        hexDistance(here, { q: c.q, r: c.r }) >= 3 &&
        !isExitCell(grid, { q: c.q, r: c.r }),
    )
    .sort((a, b) => hexDistance(here, a) - hexDistance(here, b) || a.key.localeCompare(b.key))
  const lineOf = (t: (typeof grid.cells)[number]): Array<{ q: number; r: number }> =>
    hexLine(here, { q: t.q, r: t.r })
  const keyOf = (c: { q: number; r: number }): string => `${c.q},${c.r}`
  /**
   * **三元搜索**：三条线必须互不干扰，否则现场会塌成一种形态（首版就踩过：①②的拦路者落在同一格）。
   *
   * 约束（缺一不可）：
   * ① `L_A ≠ L_B`（两处拦路者不是同一格 —— 否则"已知/未扫描"两种形态无法并存）；
   * ② `L_A` 不在 B 的线上、`L_B` 不在 A 的线上（否则 A 的线会先撞上 B 的拦路者 ⇒ A 变成"未扫描拦路"）；
   * ③ 三个目标互不在对方的线上、拦路者也不是任何一个目标（否则清线/摆敌人会互相覆盖）；
   * ④ `L_A`、`L_B` 都不在 C 的线上（C 必须保持"路径干净"）。
   */
  let triple: [number, number, number] | null = null
  outer: for (let i = 0; i < cands.length; i++) {
    const la = lineOf(cands[i]!)
    const La = la[1]!
    for (let j = 0; j < cands.length; j++) {
      if (j === i) continue
      const lb = lineOf(cands[j]!)
      const Lb = lb[1]!
      if (keyOf(La) === keyOf(Lb)) continue
      const sa = new Set(la.map(keyOf))
      const sb = new Set(lb.map(keyOf))
      if (sb.has(keyOf(La)) || sa.has(keyOf(Lb))) continue
      if (sa.has(cands[j]!.key) || sb.has(cands[i]!.key)) continue
      for (let k = 0; k < cands.length; k++) {
        if (k === i || k === j) continue
        const lc = lineOf(cands[k]!)
        const sc = new Set(lc.map(keyOf))
        if (sc.has(keyOf(La)) || sc.has(keyOf(Lb))) continue
        if (sc.has(cands[i]!.key) || sc.has(cands[j]!.key)) continue
        if (sa.has(cands[k]!.key) || sb.has(cands[k]!.key)) continue
        triple = [i, j, k]
        break outer
      }
    }
  }
  if (!triple) throw new Error('盘面太小：找不到三条互不干扰的验收直线（换个 seed）')
  const [tA, tB, tC] = triple.map((n) => cands[n]!) as [
    (typeof cands)[number],
    (typeof cands)[number],
    (typeof cands)[number],
  ]
  for (const t of [tA, tB, tC]) {
    t.place = 'empty'
    t.piles = []
    grid.visited = grid.visited.filter((k) => k !== t.key) // 保持"没到过"（目的地不该是暗格）
    reveal(t)
  }
  // ① 已知拦路者（第二个中间格也算"线上"）——先把三条线都清空，再摆敌人（避免互相覆盖）
  const lineA = prepLine(tA)
  const lineB = prepLine(tB)
  const lineC = prepLine(tC)
  const blockerA = cellAt(lineA[1]!.q, lineA[1]!.r)
  const blockerB = cellAt(lineB[1]!.q, lineB[1]!.r)
  blockerA.place = 'ship'
  blockerA.piles = []
  reveal(blockerA)
  // ② 未扫描拦路者（甲案：界面不指名）
  blockerB.place = 'ship'
  blockerB.piles = []
  grid.scanned = grid.scanned.filter((k) => k !== blockerB.key)
  grid.visited = grid.visited.filter((k) => k !== blockerB.key)
  grid.exitKnown = true
  notes.push(
    `第 3 层 · 玩家在 (Q${here.q} R${here.r}) · 回合 ${run.turnsLeft}（4×T3 真实入场预算）· 出口已知（随时可撤）`,
  )
  notes.push(
    `① **拦路者已知**：点 (Q${tA.q} R${tA.r})（离 ${hexDistance(here, tA)} 格）⇒ 确认栏写「路径上有**敌人阻拦**` +
      `（Q${blockerA.q} R${blockerA.r}）」且地图上那一格**描红指名**（它已扫描 ⇒ 本来就有橙色舰船图标）`,
  )
  notes.push(
    `② **拦路者未扫描**：点 (Q${tB.q} R${tB.r})（离 ${hexDistance(here, tB)} 格）⇒ 确认栏写「路径上**可能**有敌人阻拦」，` +
      `地图**只把路径线置警示色、不描红任何格**（那一格 (Q${blockerB.q} R${blockerB.r}) 在地图上是蓝灰虚线的未扫描格）`,
  )
  notes.push(
    `③ **路径干净**：点 (Q${tC.q} R${tC.r})（离 ${hexDistance(here, tC)} 格）⇒ **不弹确认**、直接到达（对照：没有拦截这一层）`,
  )
  notes.push(
    `④ **打完再看**：① 确认前往 ⇒ 位置应停在 (Q${blockerA.q} R${blockerA.r})（**不是**目标格）、回合 −1、就地开战；` +
      `打赢后再点一次 (Q${tA.q} R${tA.r}) ⇒ 这次应**直达**（拦路者已清）`,
  )
  notes.push(
    '⑤ **顺带**：被拦那一格会记「已激活」（地图上图标消失/压暗）；日志里应出现「🕳 途中被拦下（Q?,R?）：对方的舰船信号挡住去路——交火开始」',
  )
  notes.push('⚠ 入口只在调试模式下出现：DevTools 执行 localStorage.setItem(\'whale-idle:debug\',\'1\') 后刷新')
  return notes
}

/**
 * **虫洞 · 后勤舰验收档**（船长 2026-09-16：「给我准备一个存档」——承接同日两半特性）：
 * ① 我方「后勤舰」（`subClass: '后勤舰'` = 亡军后勤舰）的维修装置**改修三层剩余比例最低的队友**；
 * ② 敌方后勤舰的机制（本档**看不到**——船长定了"先不进卡"，新舰 `foe-g-remnant-tender` 是备用壳体；
 *    想看它得先点名进哪张卡）。
 *
 * 现场（确定性摆位，同 seed 每次一样）：
 * - **第 3 层**（这一档同时顺带验"层 3 起遗迹保底 + 遗迹出货柜 70%"）；
 * - 编队 4 艘（入场封顶 4 · 总质量 16,000 以内）：主控 = **亡军后勤舰**（装 `mod-hullrep-1` 军用维修装置）
 *   ＋ 长尾鲨①（装 `mod-hullrep-civ` ⇒ **对照**：非后勤舰只修自己）＋ 长尾鲨②（裸装）＋ 玳瑁（重装裸装）；
 * - **四艘按不同残血进场**：后勤舰 0.95 / 长尾鲨① 0.80 / **长尾鲨② 0.50（最惨 ⇒ 后勤舰第一跳就修它）** /
 *   玳瑁 0.90（`durability` 结构与 `armorPct` 装甲两个旋钮一起给，进场满值口径照真引擎算）；
 * - **入口格 = 舰船信号**：进洞即交火 ⇒ 开打 5 秒后就能在战斗页看到维修脉冲（战报尾部还会报组件消耗）；
 * - 同层另有：**遗迹**（打捞 ⇒ 70% 出货箱）· **矿脉**（采集）· **墓场**（打捞残骸）；
 * - **货仓**：2 台谜质储存器（时序核心 = 回合 +10 · 打捞吊臂 = 多捞一堆，增益立刻可见）——撤离成功时会
 *   按"1 台 = 1 枚"折成**虫洞谜质**（结算单会多一格）；
 * - **仓库**：修理组件民用/军用各 40 · **贵重品货柜 ×2 + 军用备货柜 ×2 + 安全货柜 ×1**（撤离后到工业页连拆）·
 *   虫洞谜质 ×3 与奢侈品三档各 5（物品页/市场页可见；奢侈品可买可卖）；
 * - **扫描页**：预置 **2 处已发现的虫洞**（不同族）⇒ 卡片上能看「敌：{卡名}（{族}）· {主系}」与悬停三档构成。
 *
 * 试法（详见 `docs/test-saves/README.md` 同名条目）：
 * 1. 进游戏（本档**人在洞里**，且停在"舰船信号"格）⇒ 星图 →「进入虫洞」→ 探索页；
 * 2. 点「开战」（或直接走到该格）⇒ 看**后勤舰的维修脉冲**：长尾鲨②（最惨）每 5 秒回 10 点甲/结构；
 *    对照组长尾鲨① 只修自己；战后战报尾部有「船体维修装置消耗 …」；
 * 3. 打完去**遗迹**打捞 ⇒ 看"极高概率出货柜"；**矿脉**采集；**墓场**打捞；
 * 4. **撤离** ⇒ 结算单里多一格「虫洞谜质 ×N」（2 台装置 ⇒ 2 枚）；
 * 5. 回基地 → **工业页**：贵重品/军用/安全货柜连拆（看奢侈品整叠与 MK3 装备）；
 * 6. 星图 →「扫描虫洞」：看两处库存卡片上的**敌情行**与悬停（三档火力构成）。
 */
function injectWormholeLogi(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 30_000_000
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  for (const k of [
    'gunnery',
    'fire-control',
    'reload-drills',
    'shield-operation',
    'armor-tuning',
    'vector-maneuvering',
    'evasion-maneuvering',
    'targeting-integration',
  ]) {
    state.skills.trained[k] = Math.max(state.skills.trained[k] ?? 0, 3)
  }
  /** 修理组件管够（预载**本舰货舱优先、仓库兜底** ⇒ 放仓库即可）· 弹药三型管够 */
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  for (const kit of ['repairkit-civ', 'repairkit-mil']) state.warehouse.items[kit] = (state.warehouse.items[kit] ?? 0) + 40
  /** 本批新货柜（拆解用）+ 新物品（看物品页/市场） */
  for (const b of ['box-valuables', 'box-military']) state.warehouse.items[b] = (state.warehouse.items[b] ?? 0) + 2
  state.warehouse.items['box-relic-a'] = (state.warehouse.items['box-relic-a'] ?? 0) + 1
  state.warehouse.items[WORMHOLE_ESSENCE_ITEM_ID] = (state.warehouse.items[WORMHOLE_ESSENCE_ITEM_ID] ?? 0) + 3
  for (const l of WORMHOLE_LUXURY_ITEM_IDS) state.warehouse.items[l] = (state.warehouse.items[l] ?? 0) + 5
  notes.push('钱包 +30,000,000 信用点 · 协会声望 13 · 战斗系技能 Lv3 · 弹药三型 ×5000 · **修理组件民用/军用各 +40**')
  notes.push('仓库：**贵重品货柜 ×2 · 军用备货柜 ×2 · 安全货柜 ×1**（撤离后工业页连拆）· 虫洞谜质 ×3 · 奢侈品三档各 ×5')

  const ctx = buildSimContext()
  /** 编队：主控 = 后勤舰（装军用维修装置）；僚舰 = 长尾鲨①（民用装置 = 对照）· 长尾鲨②（裸装）· 玳瑁（重装裸装） */
  const plan: Array<{ shipId: string; name: string; fit: { high: string[]; mid: string[]; low: string[] }; durability: number; armorPct: number }> = [
    {
      shipId: 'sh-wh-g-destroyer',
      name: '亡军后勤舰·主控（后勤特性 + 军用维修装置）',
      fit: {
        high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3', 'mod-miner-3'],
        mid: ['mod-hullrep-1', 'mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'],
        low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
      },
      durability: 0.95,
      armorPct: 0.95,
    },
    {
      shipId: 'sh-thresher',
      name: '长尾鲨①·对照（民用维修装置 ⇒ 只修自己）',
      fit: {
        high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3'],
        mid: ['mod-prop-2', 'mod-hullrep-civ', 'mod-shield-kin-2', 'mod-track-2'],
        low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
      },
      durability: 0.8,
      armorPct: 0.8,
    },
    {
      shipId: 'sh-thresher',
      name: '长尾鲨②·最惨（裸装 ⇒ 只能被后勤舰修）',
      fit: {
        high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
        mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
        low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
      },
      durability: 0.5,
      armorPct: 0.5,
    },
    {
      shipId: 'sh-hawksbill',
      name: '玳瑁·重装（裸装）',
      fit: {
        high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3'],
        mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
        low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-armor-plate-2'],
      },
      durability: 0.9,
      armorPct: 0.9,
    },
  ]
  const uids: string[] = []
  for (const p of plan) {
    const uid = addShipToFleet(state, p.shipId)
    const s = state.fleet[uid]!
    s.customName = p.name
    s.fitted = { high: [...p.fit.high], mid: [...p.fit.mid], low: [...p.fit.low] }
    s.durability = p.durability
    s.armorPct = p.armorPct
    if (uids.length === 0) state.shipId = uid
    uids.push(uid)
  }
  notes.push(
    '编队（4 艘）：主控 **亡军后勤舰**（`subClass: 后勤舰` · 军用维修装置）＋ 长尾鲨①（民用装置 = 对照）＋ ' +
      '长尾鲨②（**残血 50% ⇒ 最缺血**）＋ 玳瑁（重装）；四艘按 0.95 / 0.80 / **0.50** / 0.90 的残血进场',
  )

  const seed = 20260916
  state.wormhole = { run: null, lastFleetLost: 0 } // 清掉在途副本（本档要指定现场）
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  const run = state.wormhole.run!
  run.attending = true
  run.depth = 3 // 第 3 层：遗迹保底（2 格）与"遗迹出货柜 70%"都在这一层生效
  run.turnsLeft = enter.run!.turnsTotal
  run.turnsTotal = enter.run!.turnsTotal
  run.bossCleared = 0
  run.grid = wormholeMakeGrid(seed, 3, 0)
  const grid = run.grid
  const cells = grid.cells
  const pick = (i: number): (typeof cells)[number] => cells[i % cells.length]!
  const reveal = (c: (typeof cells)[number]): void => {
    if (!grid.scanned.includes(c.key)) grid.scanned.push(c.key)
    if (!grid.visited.includes(c.key)) grid.visited.push(c.key)
  }
  /** 入口格 = **舰船信号**（落地即交火 ⇒ 一进洞就能看后勤舰的维修脉冲） */
  const here = pick(0)
  here.place = 'ship'
  here.piles = []
  grid.pos = { q: here.q, r: here.r }
  grid.start = { q: here.q, r: here.r }
  reveal(here)
  notes.push(`第 3 层 · **入口格 (Q${here.q} R${here.r}) = 舰船信号**：直接开战即可看"后勤舰修最缺血的那艘"`)
  const ruins = pick(1)
  const vein = pick(2)
  const grave = pick(3)
  for (const [cell, place, label] of [
    [ruins, 'ruins', '遗迹'],
    [vein, 'vein', '矿脉'],
    [grave, 'graveyard', '墓场'],
  ] as const) {
    if (cell.key === here.key) continue
    cell.place = place
    cell.piles = []
    reveal(cell)
    if (place === 'ruins') wormholeEnsureSalvagePiles(state, cell)
    if (place === 'vein') wormholeEnsureVeinPiles(state, cell)
    if (place === 'graveyard') wormholeEnsureSalvagePiles(state, cell)
    notes.push(
      `同层**${label}** (Q${cell.q} R${cell.r})：` +
        (place === 'vein'
          ? `已铺 ${(cell.piles ?? []).length} 堆虚空母矿 ⇒ 采集`
          : `已铺 ${(cell.piles ?? []).length} 堆 ⇒ 打捞` +
            (place === 'ruins' ? '（**遗迹打捞完 = 70% 出货柜**，打完还会 70% 触发守卫战）' : '')),
    )
  }
  grid.exitKnown = true
  /** 货仓：2 台谜质储存器（增益立刻可见；撤离成功时折成虫洞谜质） */
  run.bag = []
  run.hold = makeHoldState()
  for (const id of ['mat-chrono', 'mat-crane']) {
    const r = wormholeStowOrTemp(state, ctx, id, 1)
    if (!r.ok) throw new Error(`摆货失败（${id}）：${r.error ?? ''}`)
  }
  notes.push('货仓：**2 台谜质储存器**（时序核心 = 回合 +10 · 打捞吊臂 = 每次多捞一堆）——撤离成功时按 1 台 = 1 枚折成**虫洞谜质**')
  /** 扫描页：预置 2 处已发现虫洞（不同族）⇒ 看卡片"敌情行"（族名 + 主系 + 悬停三档构成） */
  state.wormholeStock = [seed + 101, seed + 202].map((sd, i) => ({
    id: `probe-${i + 1}`,
    seed: sd,
    depth: 1,
    archetype: wormholeArchetypeOf(sd),
    family: wormholeFamilyOfSeed(sd),
    foundAtGameMs: 0,
  }))
  notes.push(
    '扫描页：预置 **2 处已发现虫洞**（族 = ' +
      state.wormholeStock.map((x) => x.family).join(' / ') +
      '）⇒ 卡片上直接看「敌：{卡名}（{族}）· {主系}」与悬停三档构成',
  )
  return notes
}

/**
 * **虫洞 · 劫掠电子舰「海盗战团」现场档**（2026-09-17 · 船长：「**准备一个在虫洞内面对该敌人的存档**」）。
 *
 * 目的：一开档就站在**舰船信号**格上，**点脚下那格按迎战**即对上 A 族**深层**卡「**海盗战团**」——
 * 编成 = 海盗头目舰 ×1 ＋ **劫掠电子舰 ×1**（首轮开火即发动**劫掠捕获网**）＋ 海盗快艇 ×2。
 * 要看的东西：**蓝色连线**（发动者那头最亮 + 外发光、被钉舰那头羽化）·
 * 被钉住的我方舰 **机动 ×0.1 / 推进器熄火 / 闪避归零 / 射程两端 −500m**（悬停敌卡可看挂载件名），
 * **击杀劫掠电子舰 = 当场解除**。
 *
 * 关键做法（确定性 · 可复现 · 不用手翻档）：
 * - **层 4**：深层卡从层 4 起进池（`WORMHOLE_TIER_UNLOCK_DEPTH.deep = 4`）⇒ 本档把 run 直接放第 4 层；
 * - **族锁定 A**：种子挑 A 族（`wormholeFamilyOfSeed`）并**同时写死 `run.family = 'A'`**，
 *   免得"档里是 A、种子算出来是别的族"两套口径（整趟一族是 2026-09-14 的既定口径）；
 * - **卡片确定性**：敌卡 = `wormholeCardIdForRun({族, 种子, 层, kind:'node', nodeIndex: gridContentIndex(盘, 格)})`
 *   —— 与 `wormholeStartBattle` **同一个函数**；本档在脚本里**搜一个"起始格的内容序号恰好抽中
 *   `wh-pirate-warband`"的种子**，摆好现场后**再算一遍断言**（卡不对直接抛错，绝不产出错档）；
 * - 出口已知 ⇒ 想撤随时撤；同层其余格原样保留（可自由探索，不挡事）。
 */
/**
 * **谜质科技实验档**（2026-09-19 · 船长：「给我个拥有谜质和虫洞的存档，我打算实机测试不同科技的影响」）。
 *
 * 这一档存在的理由：科技的**效果全在洞内/工业链路上**，而正常玩到"有谜质 + 有虫洞 + 有余钱"要很久；
 * 且科技是**逐级叠加**的，只有把"点树"和"读数"放在同一档里来回切，才看得出每一级到底改了什么。
 *
 * 配方（尽量让"改动前后"都有可比读数）：
 * - **钱与料给足**：+3,000,000,000 信用点 + 虫洞谜质 ×2,000
 *   （点满 23 节点全树共需 **1,196 枚 / 约 1.43B** ⇒ 够点满还有余量做"单点对照"）；
 * - **协会声望 60** ⇒ 过「扫描虫洞」解锁门槛（40）：星图 → 扫描虫洞 →「谜质科技」子页直接可点；
 * - **货仓刻意不带谜质装置** ⇒ 第一趟读数 = **纯科技**（想对照"装置 vs 科技"，仓库另备
 *   时序核心 ×2 / 打捞吊臂 ×2 / 母矿富集器 ×2 / 货仓扩展 ×1，自己装进货仓即可）；
 * - **现场 = 第 2 层 · 站在「舰船信号」上**（脚下按「迎战」即开打）＋ 同层 遗迹 / 矿脉 / 谜质格 / 墓场
 *   ⇒ 一档同时验：战斗线（抗性·命中·回避·射程·威胁·回收·自修）、探索线（打捞/采集效率·货仓格·扫描间隔）、
 *   工业线（撤离后：拆货柜 · 精炼虚空晶 · 回收残骸保底）；
 * - **工业线材料**：遗迹安全货柜 ×4/族 · 虚空母矿 ×5,000 · 残骸（普通+稀有）各若干 ⇒ 工业页可连拆连炼。
 *
 * ⚠ 两条会让人误判的既有口径（一并写进 notes）：
 * 1. **锚定器（回合）趟内也生效**（2026-09-19 起）：入洞后再点，本趟上限立刻 +10/级；
 * 2. **倍速**要先把「时间压缩矩阵」点到 1 级，战斗窗口顶部中间才会出现 ×1/×2/×4 控件
 *    （选了会**记住**，下次开游戏沿用）。
 */
/**
 * **一次性图纸 · 取消退书实测档**（2026-09-20 船长：「给我一个存档实机测试」——测当日的改判
 * 「一次性蓝图的制造取消后返还玩家蓝图」＋ 随后查修的多条同名线缺口）。
 *
 * 档内摆好的六种局面（表在组装机「蓝图」下拉 / 蓝图书架上都看得到）：
 * 1. **单张、随手取消**：`bp-wh-a-frag` ×1 ⇒ 开工再取消，看书回架、名额恢复、能再开工；
 * 2. **多张不同、挨个撤退**：`bp-wh-a-hangar` / `bp-wh-a-prop` / `bp-wh-a-coat` **各 ×1**
 *    ⇒ 同时开 3 条线再挨个取消，每张都该回架；
 * 3. **同名两条线（缺口主场景）**：`bp-wh-a-shield` **×2** ⇒ 开 2 条 → 撤 1 条（回 1 本）→
 *    拿这本再开 1 条 → 等"未撤的那条完工" → 再撤第三条 ⇒ **不能出现"有书却判名额已用尽"**；
 * 4. **对照（普通图纸）**：`bp-turret-kin-2` 预置为**已学会** ⇒ 取消时书架与名额表都不该动；
 * 5. **对照（名额已用尽）**：`bp-wh-a-scan` 预置成"名额已用尽、架上无书"⇒ 卡片应显示"需再获得一张"；
 * 6. **舰船一次性**：`sbp-wh-a-frigate` ×1 ⇒ 同一条退书通路（产物是舰船，完工入舰船仓库）。
 *
 * 备料：四种矿物按"够 5 条装备线 + 1 条舰船线"给（见注释内的算式）；AI 核心 ×8 ＋
 * 「AI 核心操作学」拉满 ⇒ 可同时开多条 AI 线（主控亲自位全局只 1 条）。
 */
function injectBpCancel(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  const ctx = buildSimContext()
  /**
   * ⚠ **必须把虫洞趟清干净**（2026-09-20 生成后自检发现）：本档是从**当前真档**改出来的，
   * 而真档里可能正有一趟虫洞在跑 ⇒ **主控亲自位被它占着**，组装机点「手动制造」会被拒
   * （实测报"人在虫洞里……先撤离或结算本趟"）⇒ 船长一上手就踩坑。这里清成"不在洞里"。
   */
  state.wormhole = { run: null, lastFleetLost: 0 }
  notes.push('已清空虫洞趟（否则主控亲自位被占，组装机开不了工）')
  state.wallet.isk += 200_000_000
  notes.push('钱包 **+200,000,000 信用点**')
  // ① 六种局面所需的一次性图纸（都是虫洞专属那批：不上市场、不能学、只能造一次）
  const stockPlan: Array<[string, number]> = [
    ['bp-wh-a-frag', 1], // ① 单张随手取消
    ['bp-wh-a-hangar', 1], // ② 多张不同 · 挨个撤退
    ['bp-wh-a-prop', 1],
    ['bp-wh-a-coat', 1],
    ['bp-wh-a-shield', 2], // ③ 同名两条线（缺口主场景）
    ['sbp-wh-a-frigate', 1], // ⑥ 舰船一次性
  ]
  for (const [id, n] of stockPlan) state.blueprintStock[id] = (state.blueprintStock[id] ?? 0) + n
  notes.push(
    '蓝图书架预置：`bp-wh-a-frag` ×1 · `bp-wh-a-hangar` / `bp-wh-a-prop` / `bp-wh-a-coat` 各 ×1 · ' +
      '**`bp-wh-a-shield` ×2**（同名多线用）· `sbp-wh-a-frigate` ×1（舰船一次性）',
  )
  // ④ 对照：普通图纸先学会（取消时不该动书架）
  if (!state.learnedRecipes.includes('bp-turret-kin-2')) state.learnedRecipes.push('bp-turret-kin-2')
  notes.push('`bp-turret-kin-2` 预置为**已永久学会** ⇒ 组装机可直接开工（对照组：取消不该动任何书）')
  // ⑤ 对照：一张"名额已用尽、架上无书"的一次性图纸（卡片应提示"要再获得一张"）
  state.spentOneTimeRecipes = [...(state.spentOneTimeRecipes ?? []).filter((id) => id !== 'bp-wh-a-scan'), 'bp-wh-a-scan']
  delete state.blueprintStock['bp-wh-a-scan']
  notes.push('`bp-wh-a-scan` 预置为**名额已用尽、架上无书**（对照组：组装机卡应写"需再获得一张同名图纸"）')
  // ② 备料：按各图纸 `materials` 现算，四种矿物给足 5 条装备线 + 1 条舰船线
  const wanted = new Map<string, number>()
  const planIds = ['bp-wh-a-frag', 'bp-wh-a-hangar', 'bp-wh-a-prop', 'bp-wh-a-coat', 'bp-wh-a-shield', 'sbp-wh-a-frigate']
  for (const id of planIds) {
    const bp = ctx.blueprints.get(id) ?? ctx.shipBlueprints.get(id)
    const mats = (bp as unknown as { materials?: Array<{ itemId: string; count: number }> } | undefined)?.materials ?? []
    for (const m of mats) wanted.set(m.itemId, (wanted.get(m.itemId) ?? 0) + m.count * 5)
  }
  for (const [id, n] of wanted) state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + n
  notes.push(
    `组装机备料（按图纸现算 ×5）：${[...wanted.entries()].map(([k, v]) => `${k} ${v.toLocaleString('zh-CN')}`).join(' · ')}`,
  )
  // ③ 多线并行：AI 核心 8 枚 + 「AI 核心操作学」满级（主控亲自位全局只 1 条，其余必须走 AI 线）
  state.aiCores['basic'] = (state.aiCores['basic'] ?? 0) + 8
  for (const k of ['ai-expert', 'industrial-automation', 'batch-production']) {
    state.skills.trained[k] = Math.max(state.skills.trained[k] ?? 0, 5)
  }
  notes.push('**基础 AI 核心 ×8** ＋「AI 核心操作学 / 工业自动化 / 批量生产学」拉满 ⇒ 可同时开多条线')
  return notes
}

function injectMatterTechLab(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  // ① 钱与研究材料：点满全树 1,196 枚 / 约 1.43B ⇒ 给足余量做单点对照
  state.wallet.isk += 3_000_000_000
  state.warehouse.items[WORMHOLE_ESSENCE_ITEM_ID] =
    (state.warehouse.items[WORMHOLE_ESSENCE_ITEM_ID] ?? 0) + 2_000
  notes.push(
    '钱包 **+3,000,000,000 信用点** · 仓库 **虫洞谜质 ×2,000 枚**（点满全树需 1,196 枚 / 约 1.43B，余量做单点对照）',
  )
  // ② 解锁门槛：协会声望 60（「扫描虫洞」要 40）
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 60)
  notes.push('「深空工业协会」声望 = **60**（过「扫描虫洞」门槛 40）⇒ 星图 → 扫描虫洞 →「**谜质科技**」子页直接可点树')
  // ③ 战斗系技能 Lv3（与洞内其余验收档同款基准，读数才可比）
  for (const k of [
    'gunnery',
    'fire-control',
    'reload-drills',
    'shield-operation',
    'armor-tuning',
    'vector-maneuvering',
    'evasion-maneuvering',
    'targeting-integration',
  ]) {
    state.skills.trained[k] = Math.max(state.skills.trained[k] ?? 0, 3)
  }
  // ④ 弹药与修理组件管够
  for (const key of [
    'ammo-kinetic-l',
    'ammo-kinetic-2',
    'ammo-explosive-l',
    'ammo-explosive-2',
    'ammo-plasma-l',
    'ammo-plasma-2',
  ]) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  for (const kit of ['repairkit-civ', 'repairkit-mil']) {
    state.warehouse.items[kit] = (state.warehouse.items[kit] ?? 0) + 40
  }
  // ⑤ 工业线三件的料：拆货柜（拆解周期）· 虚空母矿（虚空晶 +10%/级）· 残骸（保底原材料 +5%/级）
  for (const b of ['box-relic-a', 'box-relic-c', 'box-relic-d', 'box-relic-e', 'box-relic-g']) {
    state.warehouse.items[b] = (state.warehouse.items[b] ?? 0) + 4
  }
  state.warehouse.items[WORMHOLE_ORE_ITEM_ID] = (state.warehouse.items[WORMHOLE_ORE_ITEM_ID] ?? 0) + 5_000
  for (const w of ['wreck-a-lo', 'wreck-c-lo', 'wreck-rare-a-lo', 'wreck-rare-d-lo']) {
    state.warehouse.items[w] = (state.warehouse.items[w] ?? 0) + 6
  }
  notes.push(
    '仓库备料：遗迹安全货柜五族 **各 ×4**（工业页可连拆 · 验「货柜拆解技术」）· **虚空母矿 ×5,000**' +
      '（精炼验「虚空精炼技术」）· 残骸（普通 2 种 + 稀有 2 种）**各 ×6**（回收验「残骸解析技术」）',
  )
  // ⑥ 谜质装置放**仓库**（不进本趟货仓）：想对照"装置 vs 科技"再自己装
  for (const [id, n] of [
    ['mat-chrono', 2],
    ['mat-crane', 2],
    ['mat-enricher', 2],
    ['mat-expander', 1],
  ] as const) {
    state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + n
  }
  notes.push(
    '仓库另备谜质装置（**本趟货仓刻意空着 ⇒ 第一趟读数 = 纯科技**）：时序核心 ×2（回合 +10/台）· ' +
      '打捞吊臂 ×2 · 母矿富集器 ×2 · 货仓扩展 ×1 —— 想对照"装置 vs 科技"再装进货仓',
  )
  // ⑦ 编队：2× 长尾鲨（主战满配）+ 2× 玳瑁（重装）⇒ 洞内打得动，改动前后都有可比读数
  const ctx = buildSimContext()
  const uids: string[] = []
  const thresherFit = {
    high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-2'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  const hawksbillFit = {
    high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2'],
  }
  const fleetPlan: Array<[string, string, typeof thresherFit]> = [
    ['sh-thresher', '长尾鲨①·主战（科技对照）', thresherFit],
    ['sh-thresher', '长尾鲨②·主战（科技对照）', thresherFit],
    ['sh-hawksbill', '玳瑁①·重装', hawksbillFit],
    ['sh-hawksbill', '玳瑁②·重装', hawksbillFit],
  ]
  for (const [shipId, name, fit] of fleetPlan) {
    const uid = addShipToFleet(state, shipId)
    const s = state.fleet[uid]!
    s.customName = name
    s.fitted = { high: [...fit.high], mid: [...fit.mid], low: [...fit.low] }
    s.durability = 1
    s.armorPct = 1
    if (uids.length === 0) state.shipId = uid
    uids.push(uid)
  }
  notes.push('编队：**2× 长尾鲨级巡洋（T3 主战满配）＋ 2× 玳瑁级重装巡舰（T3）** · 全血满耐久 · 战斗系技能 Lv3')
  // ⑧ 入场：第 2 层 · 站在「舰船信号」上（脚下按迎战即开打）
  // ⚠ 落点要**多舰敌卡**：单舰弱敌几拍就没了，测不出抗性/命中/回避这些科技的前后差异
  //   ⇒ 与 `wh-ewar` 同款做法：先搜种子 + 格（同一函数链算出会遇上哪张卡），再写死现场。
  let found: { seed: number; q: number; r: number; cardId: string; ships: number } | null = null
  for (let seed = 20260920; seed < 20260920 + 400 && !found; seed++) {
    const family = wormholeFamilyOfSeed(seed)
    const probe = wormholeMakeGrid(seed, 2, 0)
    for (const c of probe.cells) {
      const cardId = wormholeCardIdForRun({
        family,
        seed,
        depth: 2,
        kind: 'node',
        nodeIndex: gridContentIndex(probe, c),
      })
      const card = ctx.anomalies.get(cardId)
      const ships = (card?.ships ?? []).reduce((n, sl) => n + (sl.count ?? 1), 0)
      if (ships >= 3) {
        found = { seed, q: c.q, r: c.r, cardId, ships }
        break
      }
    }
  }
  if (!found) throw new Error('没搜到"多舰敌卡"的落点种子（卡表或权重被改过？）')
  const seed = found.seed
  state.wormhole = { run: null, lastFleetLost: 0 } // 清掉在途副本（本档要指定现场）
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  const run = state.wormhole.run!
  run.attending = true
  run.depth = 2
  run.turnsLeft = enter.run!.turnsTotal
  run.turnsTotal = enter.run!.turnsTotal
  run.bossCleared = 0
  run.family = wormholeFamilyOfSeed(seed) // 与种子一致；写死防两套口径
  run.grid = wormholeMakeGrid(seed, 2, 0)
  const grid = run.grid
  const cells = grid.cells
  /** 扫过 + 走过（地图已知、落地即测） */
  const reveal = (c: (typeof cells)[number]): void => {
    if (!grid.scanned.includes(c.key)) grid.scanned.push(c.key)
    if (!grid.visited.includes(c.key)) grid.visited.push(c.key)
  }
  const startCell = cells.find((c) => c.q === found!.q && c.r === found!.r)
  if (!startCell) throw new Error(`盘里没有格 ${found.q},${found.r}`)
  startCell.place = 'ship' // 脚下 = 舰船信号 ⇒ 按「迎战」即开打（与 wh-ewar 同款落点口径）
  startCell.piles = []
  grid.pos = { q: startCell.q, r: startCell.r }
  grid.start = { q: startCell.q, r: startCell.r }
  reveal(startCell)
  grid.activated = (grid.activated ?? []).filter((k) => k !== startCell.key)
  /** 现场断言：脚下这一格按**引擎同一函数**算出来必须是那张多舰卡 */
  const cardNow = wormholeCardIdForRun({
    family: run.family,
    seed: run.seed,
    depth: run.depth,
    kind: 'node',
    nodeIndex: gridContentIndex(grid, grid.pos),
  })
  if (cardNow !== found.cardId) throw new Error(`现场卡不对：期望 ${found.cardId}，实得 ${cardNow}`)
  const card = ctx.anomalies.get(found.cardId)
  notes.push(
    `**第 2 层 · 站在「舰船信号」(Q${startCell.q} R${startCell.r})** ⇒ 点脚下那格按「迎战」即对上 ` +
      `**${card?.name ?? found.cardId}**（${(card?.ships ?? []).map((sl) => `${sl.ship.name}×${sl.count ?? 1}`).join(' ＋ ')}）` +
      ` —— 3 舰级别的战斗，战斗线科技的前后差异才看得出来（脚本按 \`wormholeCardIdForRun\` 算出并当场断言）`,
  )
  // 同层再摆三格：遗迹（打捞 ⇒ 顺带验打捞效率/额外堆）· 矿脉（采集）· 谜质（取回装置）
  const others = cells.filter((c) => c.key !== startCell.key)
  for (const [cell, place, label, hint] of [
    [others[0]!, 'ruins', '遗迹', '打捞稀有残骸 ⇒ 验「引力吊臂」与"效率 → 额外堆"'],
    [others[1]!, 'vein', '矿脉', '采集虚空母矿 ⇒ 验「富集钻头」与额外堆'],
    [others[2]!, 'matter', '谜质', '激活取回一台谜质储存器（本档货仓空着，正好当第一台装置用）'],
  ] as const) {
    cell.place = place
    cell.piles = []
    reveal(cell)
    if (place === 'ruins') wormholeEnsureSalvagePiles(state, cell)
    if (place === 'vein') wormholeEnsureVeinPiles(state, cell)
    notes.push(`同层**${label}** (Q${cell.q} R${cell.r})：${hint}`)
  }
  grid.exitKnown = true
  notes.push('出口已知（随时可撤离：撤离后仓库那批货柜/母矿/残骸就是工业线三件的试验料）· 守卫未清（深入要先打守卫）')
  notes.push(
    '⚠ 两条容易误判的既有口径：① **锚定器（回合）趟内也生效**——入洞后再点，本趟上限立刻 +10/级；' +
      '② **倍速**要先点「时间压缩矩阵」1 级，战斗窗口顶部中间才出现 ×1/×2/×4 控件（选了会记住，下次沿用）',
  )
  return notes
}

function injectWormholeEwar(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  state.wallet.isk += 30_000_000
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  for (const k of [
    'gunnery',
    'fire-control',
    'reload-drills',
    'shield-operation',
    'armor-tuning',
    'vector-maneuvering',
    'evasion-maneuvering',
    'targeting-integration',
  ]) {
    state.skills.trained[k] = Math.max(state.skills.trained[k] ?? 0, 3)
  }
  for (const key of [
    'ammo-kinetic-l',
    'ammo-kinetic-2',
    'ammo-explosive-l',
    'ammo-explosive-2',
    'ammo-plasma-l',
    'ammo-plasma-2',
  ]) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  for (const kit of ['repairkit-civ', 'repairkit-mil']) {
    state.warehouse.items[kit] = (state.warehouse.items[kit] ?? 0) + 40
  }
  notes.push('钱包 +30,000,000 信用点 · 协会声望 13 · 战斗系技能 Lv3 · 弹药六型（l/2）各 ×5000 · 修理组件各 ×40')

  const ctx = buildSimContext()
  /** 战斗编队：4× 长尾鲨级（T3）· 4×动能 MK3 + 1×动能 MK2（CPU 323/345）——够打完这支战团，也扛得住第一轮 */
  const fit = {
    high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-2'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  /** ⚠ 清掉在途副本：本档要指定"第 4 层 · A 族 · 站在舰船信号上"的现场（其余 case 同款处置） */
  state.wormhole = { run: null, lastFleetLost: 0 }
  const uids: string[] = []
  for (let i = 0; i < 4; i++) {
    const uid = addShipToFleet(state, 'sh-thresher')
    const s = state.fleet[uid]!
    s.customName = `长尾鲨${['①', '②', '③', '④'][i]}·对劫掠电子舰`
    s.fitted = { high: [...fit.high], mid: [...fit.mid], low: [...fit.low] }
    s.durability = 1
    s.armorPct = 1
    if (i === 0) state.shipId = uid
    uids.push(uid)
  }
  notes.push('编队：**4× 长尾鲨级巡洋（T3）** · 4×动能 MK3 ＋ 1×动能 MK2 · 推进/双盾/索敌/稳像/装甲（CPU 323/345）· 全血满耐久')
  /**
   * 搜种子：**族 = A** 且"某一格的内容序号恰好抽中海盗战团"。
   * 内容序号 = `gridContentIndex(盘, 格)`（`|q*7 + r*13 + radius*3| % 8`）⇒ 同一盘里换一格就可能换卡，
   * 故一般第一个 A 族种子就能命中；搜 3000 个仍没有 ⇒ 抛错（说明卡表/权重被改过，须人工核）。
   */
  let found: { seed: number; q: number; r: number } | null = null
  for (let seed = 20260917; seed < 20260917 + 3000 && !found; seed++) {
    if (wormholeFamilyOfSeed(seed) !== 'A') continue
    const probe = wormholeMakeGrid(seed, 4, 0)
    for (const c of probe.cells) {
      const card = wormholeCardIdForRun({ family: 'A', seed, depth: 4, kind: 'node', nodeIndex: gridContentIndex(probe, c) })
      if (card === 'wh-pirate-warband') {
        found = { seed, q: c.q, r: c.r }
        break
      }
    }
  }
  if (!found) throw new Error('没搜到"族 A ＋ 起始格抽中海盗战团"的种子（卡表或权重被改过？）')
  const seed = found.seed
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  const run = state.wormhole.run!
  run.attending = true
  run.turnsLeft = enter.run!.turnsTotal
  run.turnsTotal = enter.run!.turnsTotal
  run.bossCleared = 0
  run.depth = 4
  run.family = 'A' // 与种子一致；写死防两套口径
  run.grid = wormholeMakeGrid(seed, 4, 0)
  const grid = run.grid
  const here = grid.cells.find((c) => c.q === found!.q && c.r === found!.r)
  if (!here) throw new Error(`盘里没有格 ${found.q},${found.r}`)
  here.place = 'ship' // 舰船信号：站在原地即可按迎战（`wormholeStartBattle(..., 'node')` 要求脚下是它）
  here.piles = []
  grid.pos = { q: here.q, r: here.r }
  grid.start = { q: here.q, r: here.r }
  if (!grid.visited.includes(here.key)) grid.visited.push(here.key)
  if (!grid.scanned.includes(here.key)) grid.scanned.push(here.key)
  grid.activated = (grid.activated ?? []).filter((k) => k !== here.key) // 未清 ⇒ 迎战入口可用
  grid.exitKnown = true
  /** 现场断言：脚下这一格按**引擎同一函数**算出来必须是海盗战团 */
  const cardNow = wormholeCardIdForRun({
    family: run.family,
    seed: run.seed,
    depth: run.depth,
    kind: 'node',
    nodeIndex: gridContentIndex(grid, grid.pos),
  })
  if (cardNow !== 'wh-pirate-warband') throw new Error(`现场卡不对：期望 wh-pirate-warband，实得 ${cardNow}`)
  const card = ctx.anomalies.get('wh-pirate-warband')
  const make = (card?.ships ?? []).map((sl) => `${sl.ship.name}×${sl.count ?? 1}`).join(' ＋ ')
  notes.push(
    `第 4 层（37 格）· **站在舰船信号 (Q${here.q} R${here.r})** ⇒ 点脚下那格按「迎战」即对上 **${card?.name ?? '海盗战团'}**（${make}）`,
  )
  notes.push(`种子 ${seed} · 族 **A** · 敌卡 = \`wh-pirate-warband\`（脚本按 \`wormholeCardIdForRun\` 算出并当场断言）`)
  notes.push('看什么：劫掠电子舰**首轮开火**那一瞬 → 蓝色连线连住被钉舰（发动者那头亮、被钉舰那头羽化）· 悬停敌舰看挂载件「劫掠捕获网」· 被钉舰机动骤降/推进器熄火/闪避 0/射程收窄 ⇒ **击沉它即解除**')
  notes.push('出口已知（可随时撤离）· 同层其余格未动，可自由探索')
  return notes
}

/**
 * **虫洞 · 孢子导弹巢「全体攻击」现场档**（2026-09-25 船长：「孢子导弹巢效果为攻击敌方全体，
 * 战斗中动画是攻击敌方全体吗？你验证下顺便给我一个相关存档测试」）。
 *
 * 档里给什么（**全部走引擎真路径**，不手写战斗状态）：
 * - **主控 = 巢群重型突击巡洋舰**（C 族 T3）装**孢子导弹巢**（`hitsAllFoes` ⇒ 引擎 `allFoes`）
 *   ＋ 推进/双盾/装甲/稳像件；**僚舰 = 玳瑁级**（重装肉盾，**不装武器**）——
 *   僚舰只有自带基础舰炮（2,500 m，短于开局交距）⇒ **画面上的远程弹道全部来自孢子导弹巢**，一眼看得清；
 * - **爆炸弹药**（本件打爆炸弹）进仓库；2026-09-23 船长令后取用来源 = **仓库**（`resupplyFromWarehouse`）；
 * - **入口 = 第 1 层「舰船信号」格**：层 1 的出场池**只有浅层档**（`wormholeTierWeightsAt(1)`）
 *   ⇒ 敌卡**确定**是 C 族浅层「星髓游猎群」= **星髓成虫 ×3**
 *   （脚本按 `wormholeCardIdForRun` 当场断言，不用搜种子碰运气）。
 *
 * 看什么：点脚下那格按「迎战」→ 3 艘星髓成虫；孢子导弹巢每 **8.36 秒**一轮，
 * **一轮同时飞出 3 条弹道、各飞向一艘敌舰**（逐舰各掷命中、各飘一个伤害数字）。
 * ⟪2026-09-25 船长报障「有时候会只有一发弹道」⇒ 裁「按甲」⟫ **已修**：那段"全体攻击"原先整块写在
 * 主目标那一发的 `if (hit)` 里面 ⇒ 主目标没中时副目标连掷都不掷（真跑读数：单发轮占 64%）。
 * 现改为**主目标的命中只决定它自己**，副目标照常逐个独立结算 ⇒ **每轮都是 N 条弹道**。
 */
function injectWormholeSpore(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  // 清空进行中主控作业（真档可能在采矿/远征等；`wormholeEnter` 会被"远征无法中断"挡下）
  state.mining.active = false
  state.salvaging.active = false
  state.expedition.active = false
  state.scanning.active = false
  state.standby.active = false
  state.transit.active = false
  state.autoLoopAnomalyId = null
  state.awayGalaxy = null
  state.dockedSite = null
  state.wallet.isk += 30_000_000
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  for (const k of [
    'gunnery',
    'fire-control',
    'reload-drills',
    'shield-operation',
    'armor-tuning',
    'vector-maneuvering',
    'evasion-maneuvering',
    'targeting-integration',
  ]) {
    state.skills.trained[k] = Math.max(state.skills.trained[k] ?? 0, 3)
  }
  // 弹药：本件打**爆炸**弹 ⇒ 爆炸两档管够（另铺动能/能量各一档，便于换武器对照）
  for (const key of ['ammo-explosive-2', 'ammo-explosive-l', 'ammo-kinetic-2', 'ammo-plasma-2']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 5_000
  }
  for (const kit of ['repairkit-civ', 'repairkit-mil']) {
    state.warehouse.items[kit] = (state.warehouse.items[kit] ?? 0) + 40
  }
  notes.push(
    '钱包 +30,000,000 · 协会声望 13 · 战斗系技能 Lv3 · **爆炸弹药 MK2（＋MK1 兜底）各 ×5000**（孢子导弹巢打爆炸弹）· 修理组件各 ×40',
  )

  const ctx = buildSimContext()
  /** ⚠ 清掉在途副本：本档要指定"第 1 层 · C 族 · 站在舰船信号上"的现场（其余 case 同款处置） */
  state.wormhole = { run: null, lastFleetLost: 0 }
  const uids: string[] = []
  {
    const uid = addShipToFleet(state, 'sh-wh-c-cruiser')
    const s = state.fleet[uid]!
    s.customName = '巢群巡洋·孢子导弹巢'
    s.fitted = {
      high: ['mod-wh-c-missile'],
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-shield-ext-2'],
      low: ['mod-armor-kin-2', 'mod-stab-kin-2'],
    }
    s.ammoPref = { explosive: 'ammo-explosive-2' }
    s.durability = 1
    s.armorPct = 1
    state.shipId = uid
    uids.push(uid)
  }
  {
    const uid = addShipToFleet(state, 'sh-hawksbill')
    const s = state.fleet[uid]!
    s.customName = '玳瑁·肉盾（不装武器）'
    s.fitted = {
      high: [],
      mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-shield-ext-2'],
      low: ['mod-armor-kin-2', 'mod-stab-kin-2'],
    }
    s.durability = 1
    s.armorPct = 1
    uids.push(uid)
  }
  notes.push(
    '编队：**主控 = 巢群重型突击巡洋舰（C 族 T3）· 孢子导弹巢 ×1** ＋ 推进/双盾/装甲/稳像 ｜ ' +
      '**僚舰 = 玳瑁级（不装武器）** ⇒ 远程弹道只有孢子导弹巢一条来源 · 全血满耐久',
  )

  /** 搜一个 **C 族**种子（层 1 的卡与格子无关 ⇒ 不用像 wh-ewar 那样搜"指定卡"） */
  let seed = 20260925
  for (; seed < 20260925 + 3000; seed++) if (wormholeFamilyOfSeed(seed) === 'C') break
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  const run = state.wormhole.run!
  run.attending = true
  run.turnsLeft = enter.run!.turnsTotal
  run.turnsTotal = enter.run!.turnsTotal
  run.bossCleared = 0
  run.depth = 1
  run.family = 'C' // 与种子一致；写死防两套口径
  run.grid = wormholeMakeGrid(seed, 1, 0)
  const grid = run.grid
  const here = grid.cells[Math.floor(grid.cells.length / 2)]!
  here.place = 'ship' // 舰船信号：站在原地即可按迎战（`wormholeStartBattle(..., 'node')` 要求脚下是它）
  here.piles = []
  grid.pos = { q: here.q, r: here.r }
  grid.start = { q: here.q, r: here.r }
  if (!grid.visited.includes(here.key)) grid.visited.push(here.key)
  if (!grid.scanned.includes(here.key)) grid.scanned.push(here.key)
  grid.activated = (grid.activated ?? []).filter((k) => k !== here.key) // 未清 ⇒ 迎战入口可用
  grid.exitKnown = true
  /** 现场断言：脚下这一格按**引擎同一函数**算出来必须是 C 族浅层卡（层 1 只出浅层） */
  const cardNow = wormholeCardIdForRun({
    family: run.family,
    seed: run.seed,
    depth: run.depth,
    kind: 'node',
    nodeIndex: gridContentIndex(grid, grid.pos),
  })
  if (cardNow !== 'wh-alien-swarm') throw new Error(`现场卡不对：期望 wh-alien-swarm，实得 ${cardNow}`)
  const card = ctx.anomalies.get('wh-alien-swarm')
  const make = (card?.ships ?? []).map((sl) => `${sl.ship.name}×${sl.count ?? 1}`).join(' ＋ ')
  notes.push(
    `第 1 层（${grid.cells.length} 格）· **站在舰船信号 (Q${here.q} R${here.r})** ⇒ 点脚下那格按「迎战」即对上 **${card?.name ?? '星髓游猎群'}**（${make}）`,
  )
  notes.push(`种子 ${seed} · 族 **C** · 敌卡 = \`wh-alien-swarm\`（脚本按 \`wormholeCardIdForRun\` 算出并当场断言）`)
  notes.push(
    '看什么：孢子导弹巢每 8.36 秒一轮 ⇒ **一轮同时飞出 3 条弹道、各飞向一艘敌舰**，逐舰各飘一个伤害数字（打机群那种"只出炮口闪光"不适用本件）',
  )
  notes.push('出口已知（可随时撤离）· 同层其余格未动，可自由探索')
  return notes
}

/**
 * **战列舰实机测试档**（2026-09-24 船长：「你给我准备一个有战列舰和各种装备的存档，我打算实机测试」）。
 *
 * 起因：H 族（墨潮帮）重标过程中，二号拿 `whale-king`（**鲸王级采矿艇**，industrial）当"T3 战列"
 * 测了一轮，结论全错 ⇒ 船长要求**用真正的战列舰在实机上验**。
 *
 * 档里给什么：
 * - **两艘真战列/旗舰**：T4「巨齿鲨级战列舰」（6/5/3 · CPU 490）设为驾驶 · T5「邓氏鱼级旗舰」（7/7/4 · CPU 690）；
 * - **两套对照装配**（同型不同件，可现场对比）：`动能抗` 与 `均衡`（H 族新构成是动能 6 : 爆炸 4）；
 * - **T3 巡洋对照船**（锤头鲨，5/4/3）：验证"巡洋 vs 战列"的手感差；
 * - **全套备件**（MK1/2/3 三族武器 ＋ 盾/甲/推进/支援/CPU/锁定 各 3 件）⇒ 可现场自由换装；
 * - **弹药三型 ×8000**、全星系点亮、协会声望 13（可接全部悬赏）。
 *
 * 看什么（给船长的实测清单）：
 * 1. **装配页**：两艘战列的槽位/CPU 是否够用、换件后战斗数值预览是否合理；
 * 2. **打现役高段卡**（天底 66 / 噬口 80 / 坟场·虚海 88 / 穹顶 96）：掉血多少、打多久、弹药够不够
 *    （⚠ 上一轮的"战列打不动"其实是**备弹 60 发打光**，这档会重现/排除它）；
 * 3. **打 H 族入侵卡**（需调试模式开入侵：核心/外围）：骚扰 78 / 袭击 85 / 主力 93 / 旗舰 120。
 */
/**
 * **测试船标记**：注入的战列/对照船名字都带这个前缀 ⇒ 重复生成时先把上一轮的清掉，
 * 免得"真档里已经有上一版注入的船"导致**越注越多**（2026-09-24 实测踩到：第二次生成后船变成 8 艘）。
 */
const BS_TEST_TAG = '[BStest]'

/**
 * ⚠ **只允许"已上线可获得"的舰型**（2026-09-24 船长报障：「**邓氏鱼级旗舰不是还没做出来？**」）：
 * `sh-dunkleosteus`（T5 邓氏鱼级旗舰）在数据里是**壳体/模子**——`priceIsk: 0`、**无市场行**、
 * **无一次性图纸**、**没有任何卡引用**（见 `ships.ts` 该条注释与守卫用例 `t4-battleship.test.ts`
 * 「T5 邓氏鱼仍是壳体：不上市场、不接蓝图、本轮不越界」）。用 `addShipToFleet` 硬塞它 =
 * 给玩家一艘正常游戏里得不到的船 ⇒ **测试档不许这么干**。
 *
 * 判据：`priceIsk > 0`（有渠道可买到）**或** 有舰船图纸 ⇒ 放行；否则**抛错**（宁可生成失败，
 * 也不给一个越界的档）。
 */
function assertShipInjected(shipId: string): void {
  const s = SHIPS.find((x) => x.id === shipId)
  if (!s) throw new Error(`测试档注入：舰型 ${shipId} 不存在`)
  const buyable = (s.priceIsk ?? 0) > 0
  const hasBlueprint = SHIP_BLUEPRINTS.some((b) => (b as { shipId?: string }).shipId === shipId)
  if (!buyable && !hasBlueprint) {
    throw new Error(
      `测试档注入：**${s.name}（${shipId}）是壳体/模子**（无价、无市场行、无图纸）⇒ 不许进测试档（船长已指出过）`,
    )
  }
}

/** 清掉上一轮注入的测试船（按名字前缀认）。⚠ **不动 `state.shipId`**——紧接着就会把新注入的第一艘设为驾驶 */
function stripPreviousBattleshipTestShips(state: GameState): number {
  let removed = 0
  for (const [uid, s] of Object.entries(state.fleet)) {
    if (s && (s.customName ?? '').startsWith(BS_TEST_TAG)) {
      delete state.fleet[uid]
      removed++
    }
  }
  return removed
}

function injectBattleship(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  /** ⚠ **先清上一轮的测试船**（在注入之前；否则会越注越多——2026-09-24 实测踩到） */
  const stripped = stripPreviousBattleshipTestShips(state)
  /**
   * ⚠ **必须剥掉铁人标记**（2026-09-24 船长报障：「你存档搞的是铁人模式，我无法导入」）：
   * 生成器是**基于真档复制注入**的，而船长的真档是**铁人档**（`ironman.on = true`）⇒ 造出来的档
   * 也带铁人标记；导入时被铁人闸门拦下（`ironmanLoadVerdict`：**来档是铁人档 + 代次落后 ⇒ 拒绝**，
   * 见 `engine.ironmanLoadCheck`）—— 船长根本导不进来。
   * ⇒ 测试档一律**转成普通档**（`ironman` 缺省 = 普通档、代次 0、导入放行）。
   * 代价：导入它会**离开铁人状态**（引擎既有语义：铁人标记以"来档"为准）——测完用游戏内备份恢复即可。
   */
  if (state.ironman !== undefined) {
    delete state.ironman
    notes.push('**已把本档转为普通档**（剥掉铁人标记 `ironman`）——否则铁人闸门会拒绝导入；导入它会离开铁人状态，测完用备份恢复')
  }
  state.wallet.isk += 80_000_000
  notes.push('钱包 +80,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13（可接全部悬赏，含穹顶守卫 96）')
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) state.exploredGalaxies.push(g.id)
  }
  notes.push(`点亮全部星系（${GALAXIES.length}）`)

  /**
   * 四艘船（[船型, 自定义名, high, mid, low]）——
   * ⚠ 中低槽这次**装满**（上一轮的空中低槽是导致"战列很脆"假象的原因之一）。
   * 抗性件按 H 族新构成选：**动能 6 : 爆炸 4** ⇒ 主堆动能抗、另一套走均衡。
   */
  const ships: Array<[string, string, string[], string[], string[]]> = [
    [
      'sh-megalodon',
      `${BS_TEST_TAG} 巨齿鲨·战列（动能抗 · 驾驶）`,
      Array(6).fill('mod-turret-kin-3'),
      ['mod-shield-kin-3', 'mod-shield-kin-3', 'mod-mwd-3', 'mod-gyro-3', 'mod-track-3'],
      ['mod-armor-kin-3', 'mod-stab-kin-3', 'mod-cpu-3'],
    ],
    [
      'sh-megalodon',
      `${BS_TEST_TAG} 巨齿鲨·战列（均衡 · 换装对照）`,
      Array(6).fill('mod-turret-kin-3'),
      ['mod-shield-ext-3', 'mod-shield-ext-3', 'mod-mwd-3', 'mod-rof-3', 'mod-gyro-3'],
      ['mod-armor-plate-3', 'mod-stab-kin-3', 'mod-hullrep-2'],
    ],
    [
      'sh-hammerhead',
      `${BS_TEST_TAG} 锤头鲨·巡洋（T3 对照）`,
      Array(5).fill('mod-turret-kin-3'),
      ['mod-shield-kin-3', 'mod-mwd-3', 'mod-gyro-3', 'mod-rof-3'],
      ['mod-armor-kin-3', 'mod-stab-kin-3', 'mod-cpu-3'],
    ],
  ]
  const uids: string[] = []
  ships.forEach(([shipId, name, high, mid, low], i) => {
    assertShipInjected(shipId) // ⚠ 壳体/模子不许进测试档（船长 2026-09-24 报障）
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
    `新增 ${uids.length} 艘：${uids[0]}（**巨齿鲨·战列 · 动能抗 · 已设驾驶**）· ${uids[1] ?? '-'}（巨齿鲨·均衡对照）· ` +
      `${uids[2] ?? '-'}（锤头鲨·巡洋 T3 对照）——舰船页切驾驶逐船对照。` +
      '⚠ **不含 T5 邓氏鱼级旗舰**：它是壳体/模子（无价、无市场行、无图纸），不进测试档',
  )

  // 备件：三族武器 MK1~3 + 防护/推进/支援/CPU/锁定 各 3 件（现场自由换装）
  const spares = [
    'mod-turret-kin-1', 'mod-turret-kin-2', 'mod-turret-kin-3',
    'mod-missile-1', 'mod-missile-2', 'mod-missile-3',
    'mod-laser-1', 'mod-laser-2', 'mod-laser-3',
    'mod-shield-kin-3', 'mod-shield-exp-3', 'mod-shield-pla-3', 'mod-shield-ext-3', 'mod-shieldchg-3',
    'mod-armor-kin-3', 'mod-armor-exp-3', 'mod-armor-pla-3', 'mod-armor-plate-3',
    'mod-prop-3', 'mod-mwd-3', 'mod-cpu-3', 'mod-lock-3',
    'mod-stab-kin-3', 'mod-stab-exp-3', 'mod-stab-pla-3', 'mod-rof-3', 'mod-track-3', 'mod-gyro-3',
    'mod-hullrep-2', 'mod-shieldfield-3', 'mod-warpcomp-3',
  ]
  for (const m of spares) state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 3
  notes.push(`装备库备 ${spares.length} 种 ×3（三族武器 MK1~3 · 盾/甲六系 · 推进/CPU/锁定/支援/维修/力场 · 可现场换装）`)

  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 8_000
  }
  notes.push('仓库弹药三型（基础/大）各 +8,000 —— **旗舰战打满 4 波也够**（上一轮"战列打不动"就是备弹 60 发打光）')

  /**
   * **打开调试档位**（`debugQuick`）：周末入侵只有调试模式可见/可开（`WEEKEND_DEBUG_ONLY`）
   * ⇒ 不开这一格就**测不了 H 族那四张入侵卡**（骚扰 78 / 袭击 85 / 主力 93 / 旗舰 120）。
   * 同时它会把入侵时间轴按 ÷60 压缩（2 小时倒计时 = 2 分钟）⇒ 磨血/章鱼人也能在实机上看到。
   */
  state.debugQuick = true
  notes.push('**已打开调试模式（`debugQuick`）**：周末入侵开档即出现（时间轴 ÷60 —— 旗舰 2 小时倒计时 = 2 分钟）')
  if (stripped > 0) notes.push(`先清掉上一轮注入的测试船 ×${stripped}（带「${BS_TEST_TAG}」前缀）——避免越注越多`)

  // 首页可见的四张验收卡（顺手把威胁排序写在清单里）
  notes.push(
    '验收路径（星图 · 逐威胁开战）：天底静区封锁 66 → 噬口猎杀令 80 → 坟场守墓者/虚海守望者 88 → **穹顶守卫 96**；' +
      'H 族入侵卡需先在存档里开调试模式（`debugQuick`）触发入侵 ⇒ 骚扰 78 / 袭击 85 / 主力 93 / **旗舰 120（4 船编队战）**',
  )
  notes.push('看什么：① 装配页槽位/CPU 够不够、换件后数值预览 ② 每场**掉血% / 耗时 / 弹药消耗** ③ 战列 vs 巡洋的手感差（同卡切驾驶对照）')
  return notes
}

const WK_TEST_TAG = '[WKtest]'

/** 清掉上一轮注入的旗舰战测试船（按名字前缀认）。⚠ 不动 `state.shipId`（紧接着会把新注入的第一艘设为驾驶）。 */
function stripPreviousWeekendTestShips(state: GameState): number {
  let removed = 0
  for (const [uid, s] of Object.entries(state.fleet)) {
    if (s && (s.customName ?? '').startsWith(WK_TEST_TAG)) {
      delete state.fleet[uid]
      removed++
    }
  }
  return removed
}

/**
 * **周末入侵 · 旗舰战准备档**（**船长 2026-09-25：「帮我准备一个旗舰战之前的存档」**）。
 *
 * 现场 = **核心条已满 ⇒ 旗舰已现身、停在核心星系**，战役尚未开打 —— 玩家从
 * ① 入侵活动框那行「旗舰现身」→「战前准备」或 ② 星图 · 核心星系详细 → 「战前准备」，进选船界面开打。
 *
 * 注入清单（只补"难达成的门槛"，可达成的操作不代做）：
 * - `debugQuick = true`：**入侵只有调试模式可见**（`WEEKEND_DEBUG_ONLY`）；
 * - 一支 **4 艘满配编队**（旗舰战编队上限 4）＋ `weekendPrepSquad` 落盘 ⇒ 准备界面默认就选中这 4 艘；
 * - 钱包 / 协会声望 / 全星系点亮 / 弹药与修理组件备足（4 波编队战够打）；
 * - 一场 **H 族入侵**：核心 + 外围**全部推进到 100%**（外围全清是核心门禁的前提）⇒ `weekendCoreProgressAt = 1`。
 *
 * ⚠ **一处刻意摆过的门槛**（不是游戏行为，纯为"这档一加载就能测"）：
 * `flagshipHpMax` **预置为满池 150,000** —— 让血池读数与章鱼削血从加载起就有效（否则要等第一次接战才锁定）。
 *
 * 窗口口径（**2026-09-25 船长两条令**）：章鱼人削血是**真实削减**（打完一场放一会，母舰血量真减少），
 * 攒满窗口（= 血条见底）才判"章鱼人得手"；**调试档窗口 = 10 分钟**（原"÷60 = 2 分钟"连点进准备界面都来不及）。
 * ⇒ 本档**不再需要摆 anchor**：旗舰现身那一刻起算，你有 10 分钟的"在线且不在战斗"时间可支配
 * （战斗中与离线都暂停，所以实际可测时长比 10 分钟更宽）。
 *
 * `opts.hurt = true`（case `weekendkill`）：血池**只差一点**（差 1,000）⇒ 一场就能打空 ⇒ 立刻验"击沉 + 黑匣"。
 */
function injectWeekend(state: GameState, opts: { hurt?: boolean } = {}): string[] {
  const notes: string[] = []
  genericPrep(state)
  /** 主控回港待命：把在途作业（采矿/打捞/远征/扫描/待命/转场）全部停掉，起点干净（同 `injectFragments` 那一处） */
  state.mining.active = false
  state.salvaging.active = false
  state.expedition.active = false
  state.expedition.battle = null
  state.scanning.active = false
  state.standby.active = false
  state.transit.active = false
  state.autoLoopAnomalyId = null
  /** 清掉上一场的战果快照：免得结算面板/结算通讯还挂着旧那一场（本档的入侵是全新一场） */
  delete state.weekendLastResult
  const stripped = stripPreviousWeekendTestShips(state)
  /** ⚠ 必须剥掉铁人标记：否则铁人闸门拒绝导入（同 `injectBattleship` 那一处的长注释） */
  if (state.ironman !== undefined) {
    delete state.ironman
    notes.push('**已把本档转为普通档**（剥掉铁人标记 `ironman`）——否则铁人闸门会拒绝导入')
  }
  state.wallet.isk += 80_000_000
  notes.push('钱包 +80,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 13)
  notes.push('协会声望升至 13')
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) state.exploredGalaxies.push(g.id)
  }
  notes.push(`点亮全部星系（${GALAXIES.length}）——星图上能直接找到被占的核心星系`)

  /**
   * 4 艘满配船（旗舰战 = 编队战，编队上限 `WEEKEND_FLAGSHIP_MAX_SHIPS` = 4）：
   * 2× 巨齿鲨（T4 战列：动能抗 / 均衡）＋ 2× 锤头鲨（T3 巡洋）——中低槽装满，主炮 MK3。
   */
  const ships: Array<[string, string, string[], string[], string[]]> = [
    [
      'sh-megalodon',
      `${WK_TEST_TAG} 巨齿鲨·战列（动能抗 · 驾驶）`,
      Array(6).fill('mod-turret-kin-3'),
      ['mod-shield-kin-3', 'mod-shield-kin-3', 'mod-mwd-3', 'mod-gyro-3', 'mod-track-3'],
      ['mod-armor-kin-3', 'mod-stab-kin-3', 'mod-hullrep-2'],
    ],
    [
      'sh-megalodon',
      `${WK_TEST_TAG} 巨齿鲨·战列（均衡）`,
      Array(6).fill('mod-turret-kin-3'),
      ['mod-shield-ext-3', 'mod-shield-ext-3', 'mod-mwd-3', 'mod-rof-3', 'mod-gyro-3'],
      ['mod-armor-plate-3', 'mod-stab-kin-3', 'mod-hullrep-2'],
    ],
    [
      'sh-hammerhead',
      `${WK_TEST_TAG} 锤头鲨·巡洋①`,
      Array(5).fill('mod-turret-kin-3'),
      ['mod-shield-kin-3', 'mod-mwd-3', 'mod-gyro-3', 'mod-rof-3'],
      ['mod-armor-kin-3', 'mod-stab-kin-3', 'mod-cpu-3'],
    ],
    [
      'sh-hammerhead',
      `${WK_TEST_TAG} 锤头鲨·巡洋②`,
      Array(5).fill('mod-turret-kin-3'),
      ['mod-shield-kin-3', 'mod-mwd-3', 'mod-gyro-3', 'mod-rof-3'],
      ['mod-armor-kin-3', 'mod-stab-kin-3', 'mod-cpu-3'],
    ],
  ]
  const uids: string[] = []
  ships.forEach(([shipId, name, high, mid, low], i) => {
    assertShipInjected(shipId) // 壳体/模子不许进测试档（船长 2026-09-24 报障）
    const uid = addShipToFleet(state, shipId)
    const s = state.fleet[uid]!
    s.customName = name
    s.fitted = { high: [...high], mid: [...mid], low: [...low] }
    s.durability = 1
    s.armorPct = 1
    if (i === 0) state.shipId = uid
    uids.push(uid)
  })
  /** 落盘编队 = 这 4 艘 ⇒ 准备界面打开即默认选中（`weekendPrepSquadOf` 优先读它） */
  state.weekendPrepSquad = [...uids]
  notes.push(
    `新增 ${uids.length} 艘满配船（2× 巨齿鲨战列 + 2× 锤头鲨巡洋；第一艘已设驾驶）＋ **已把编队落盘** ` +
      `⇒ 战前准备界面打开即默认选中这 4 艘（可自行改选）`,
  )

  const spares = [
    'mod-turret-kin-3', 'mod-missile-3', 'mod-laser-3',
    'mod-shield-kin-3', 'mod-shield-exp-3', 'mod-armor-kin-3', 'mod-armor-plate-3',
    'mod-prop-3', 'mod-mwd-3', 'mod-cpu-3', 'mod-lock-3', 'mod-rof-3', 'mod-track-3', 'mod-gyro-3',
    'mod-hullrep-2', 'mod-stab-kin-3',
  ]
  for (const m of spares) state.moduleBay[m] = (state.moduleBay[m] ?? 0) + 4
  notes.push(`装备库备 ${spares.length} 种 ×4（现场换装/补维修装置）`)
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 8_000
  }
  notes.push('仓库弹药三型（大）各 +8,000（4 波编队战够打）')
  /** 修理组件（船体维修装置要吃）：战场续航的硬需求 */
  for (const key of ['item-repair-kit-1', 'item-repair-kit-2']) {
    state.warehouse.items[key] = (state.warehouse.items[key] ?? 0) + 200
  }
  notes.push('仓库修理组件 MK1/MK2 各 +200（装配「船体维修装置」后战场自动修复）')

  /** 入侵现场：新开一场（seq +1），核心 + 外围全部推进到 100% ⇒ 旗舰现身 */
  const ctx = buildSimContext()
  const seq = (state.weekendEvent?.seq ?? 0) + 1
  const rolled = weekendRollOccupation(state, ctx, seq)
  if (!rolled) throw new Error('测试档注入：侵入地点抽签为空（星系表异常）')
  const occupied = [rolled.coreId, ...rolled.peripheryIds]
  const contributed: Record<string, number> = {}
  for (const gid of occupied) contributed[gid] = 1
  state.weekendEvent = {
    seq,
    startedAtWallMs: Date.now(),
    coreId: rolled.coreId,
    peripheryIds: rolled.peripheryIds,
    // 族锁定 H（`WEEKEND_LOCKED_FAMILY`）；抽签结果照旧消费随机数 ⇒ 直接用抽出来的族
    family: rolled.family,
    contributed,
    // ⚠ 不摆 `flagshipAtWallMs`：让引擎在载入第一拍自己落 anchor（「旗舰现身」日志与一次性弹窗都会照常触发）；
    //   调试档窗口 10 分钟（`weekendFlagshipWindowMs`），且战斗中/离线暂停削血 ⇒ 时间够测。
    flagshipHpMax: WEEKEND_FLAGSHIP_POOL_HP,
    flagshipHpDone: opts.hurt === true ? WEEKEND_FLAGSHIP_POOL_HP - 1_000 : 0,
  }
  const coreName = ctx.galaxies.get(rolled.coreId)?.name ?? rolled.coreId
  notes.push(
    `**入侵现场**：第 ${seq} 场 · ${rolled.family} 族 · 核心「${coreName}」· 外围 ${rolled.peripheryIds.length} 处 —— ` +
      `核心与外围**全部 100%**（外围全清 ⇒ 核心门禁已开）⇒ **旗舰已现身**，停在核心星系`,
  )
  notes.push(
    opts.hurt === true
      ? `**血池只剩 1,000**（满池 ${WEEKEND_FLAGSHIP_POOL_HP.toLocaleString('zh-CN')}）⇒ 打掉就能验「击沉旗舰 ＋ 黑匣 ×1 ＋ 稀有残骸 ×3」`
      : `血池满（${WEEKEND_FLAGSHIP_POOL_HP.toLocaleString('zh-CN')}）⇒ 验「4 波编队战 ＋ 跨场累计伤害」；想一场见击沉就改用 case \`weekendkill\``,
  )
  notes.push(
    '**章鱼人削血是真实削减**（船长 2026-09-25）：打完一场放一会，母舰血条会**真的减少**（每拍按"在线且' +
      '不在战斗"的时长削；战斗中与离线都暂停）；**削满窗口 = 血条见底 = 章鱼人得手**。' +
      '调试档窗口 = **10 分钟**（`weekendFlagshipWindowMs`），锚点由引擎在载入第一拍自己落（「旗舰现身」弹窗会照常出现）',
  )
  state.debugQuick = true
  notes.push('**已打开调试模式（`debugQuick`）**：入侵只有调试模式可见/可开（`WEEKEND_DEBUG_ONLY`）')
  if (stripped > 0) notes.push(`先清掉上一轮注入的测试船 ×${stripped}（带「${WK_TEST_TAG}」前缀）`)
  notes.push(
    '验收路径：① 入侵活动框那一行「旗舰现身」→ 点「战前准备」；或 ② 星图 → 核心星系详细 → 「战前准备」' +
      '（两条路都进同一个选船界面）⇒ 选 4 艘船 → 「出击旗舰」⇒ **战斗画面**（4 舰编队战 · 4 波）',
  )
  notes.push(
    '看什么：① 准备界面的**收藏置顶**与缺口提示（没有武器/没有弹药/装甲结构低于六成）② 战斗画面是否正常上屏、' +
      '敌方母舰血条 = 池子剩余 ③ 战场内「撤退」是否可用（撤退**照记**对母舰的伤害）④ 打完的战报与「击沉 → 黑匣」结算',
  )
  return notes
}

/**
 * shipwreck（2026-09-26 二号 · **玩家舰船残骸验收档**；船长「可以生成一个存档给我核验」）。
 *
 * 机制（船长原话）：「玩家舰船被摧毁后，如果是在非虫洞的正常星系内，在该星系生成一个'<被摧毁的舰船名称>
 * 的残骸'该残骸存在48小时，玩家如果在该星系打捞，优先打捞该残骸（比稀有残骸优先级还高）。打捞后玩家
 * 按照一定概率和比例回收被摧毁舰船的部分装备。除此以外没有其他资源。」＋「留一个接口，给之后舰船插件的。」
 *
 * 本档一次性摆好**四种验证面**（都能立刻上手，不必先去死一艘船）：
 * - ① **暗星坟场**（`galaxy-grave`）：一具满配残骸（6 件 ＋ 无人机 6 架）——看最高优先、逐件掷、保底、清空即消失；
 * - ② **红环航道**（`galaxy-redring`）：另一具残骸（4 件）——验证**跨星系各算各的**；
 * - ③ **穹顶墓园**（`galaxy-vault`）：**带加固结构插件回收率（已被手工写成 0.6）**的残骸——整船回收那条路**现在就能试**
 *   （⚠ 正式插件尚未入库；这条是给接口留白做的"临时把手"，插件上线后请把 `reinforceChance` 那一行删掉）；
 * - ④ 驾驶船 = 白鲨级 4×打捞器 MK2，停在**暗星坟场**，开档即可直接「残骸打捞 → 开始打捞」。
 *
 * 界面读数：打捞面板**置顶**有一组「舰船残骸 N 具（优先打捞）」的卡（船名 ＋ 可回收件数 ＋ 剩余小时）。
 */
function injectShipWreck(state: GameState): string[] {
  const notes: string[] = []
  genericPrep(state)
  const ctx = buildSimContext()
  state.wallet.isk += 20_000_000
  notes.push('钱包 +20,000,000 ISK')
  state.standings['dsi'] = Math.max(state.standings['dsi'] ?? 0, 8)
  notes.push('协会声望升至 8（打捞相关门槛全过）')
  let lit = 0
  for (const g of GALAXIES) {
    if (!state.exploredGalaxies.includes(g.id)) {
      state.exploredGalaxies.push(g.id)
      lit++
    }
  }
  notes.push(`星图全部点亮（新增 ${lit} 个）——四个验收星系全部可达`)

  /**
   * 按船型槽位**拼一副可安装的满配**：模块家族（`slot`）必须落在对应槽类（`rack`）里，
   * 顺便把 `fitted` 数组撑到该船的真实槽数（否则装配页会把它当越界件）。
   *
   * ⚠ **不循环填满**：给的件比槽少时，剩下的槽**留 null**——早先那版用 `pool[i % pool.length]`
   * 循环填，结果同一件在残骸里出现两三次（残骸是快照，重复件会让"逐件掷骰"的件数失真）。
   */
  const loadoutOf = (shipId: string, bySlot: { high: string[]; mid: string[]; low: string[] }): { high: Array<string | null>; mid: Array<string | null>; low: Array<string | null> } => {
    const def = ctx.ships.get(shipId)
    const out = {
      high: [] as Array<string | null>,
      mid: [] as Array<string | null>,
      low: [] as Array<string | null>,
    }
    for (const rack of ['high', 'mid', 'low'] as const) {
      const want = (def?.slots?.[rack] ?? 0) as number
      const pool = bySlot[rack].filter((id) => (ctx.modules.get(id)?.rack ?? 'high') === rack)
      for (let i = 0; i < want; i += 1) out[rack].push(pool[i] ?? null)
    }
    return out
  }

  const wrecks: Array<{
    gal: string
    shipId: string
    name: string
    durability: number
    armorPct: number
    bySlot: { high: string[]; mid: string[]; low: string[] }
    drones?: Record<string, number>
    reinforce?: number
    note: string
  }> = [
    {
      gal: 'galaxy-grave',
      shipId: 'sh-mako',
      name: '灰鲭鲨·第一艘沉船',
      durability: 0.22,
      armorPct: 0.35,
      bySlot: {
        high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-2', 'mod-salvager-2'],
        mid: ['mod-prop-3', 'mod-shield-kin-3', 'mod-track-2'],
        low: ['mod-armor-pla-3', 'mod-stab-kin-2'],
      },
      drones: { 'drone-heavy': 4, 'drone-sentry': 2 },
      note: '① 暗星坟场（驾驶船所在地）：满配残骸 —— 最高优先 / 逐件掷 / 保底 / 清空即消失',
    },
    {
      gal: 'galaxy-redring',
      shipId: 'sh-falconet',
      name: '鲣鱼·侦察分队',
      durability: 0.1,
      armorPct: 0.2,
      bySlot: {
        high: ['mod-turret-kin-2', 'mod-turret-kin-1'],
        mid: ['mod-shield-kin-2'],
        low: ['mod-armor-exp-2'],
      },
      note: '② 红环航道：另一具残骸 —— 跨星系各算各的、互不影响',
    },
    {
      gal: 'galaxy-vault',
      shipId: 'sh-nautilus',
      name: '鹦鹉螺·要回来的那艘',
      durability: 0.4,
      armorPct: 0.5,
      bySlot: {
        high: ['mod-turret-kin-2', 'mod-drone-rack-2', 'mod-drone-tac-2', 'mod-drone-relay-2'],
        mid: ['mod-shieldchg-3', 'mod-prop-2', 'mod-shield-ext-2'],
        low: ['mod-cargo-3', 'mod-hullrep-1'],
      },
      drones: { 'drone-scout': 3 },
      reinforce: 0.6,
      note: '③ 穹顶墓园：**带加固结构插件回收率（手工写成 0.6）**——第一次捞这具时会先掷整船回收，命中即整船回母港（结构 ×0.3 / 装甲 ×0.5）；未命中则记下"已掷过"、之后走逐件',
    },
  ]

  let seq = 0
  for (const w of wrecks) {
    seq += 1
    noteShipWreck(state, {
      galaxyId: w.gal,
      shipId: `wrecked-${seq}-${w.shipId}`,
      shipName: w.name,
      defId: w.shipId,
      durability: w.durability,
      armorPct: w.armorPct,
      fitted: loadoutOf(w.shipId, w.bySlot),
      ...(w.drones !== undefined ? { droneLoad: w.drones } : {}),
      ...(w.reinforce !== undefined ? { reinforceChance: w.reinforce } : {}),
      createdAtWallMs: Date.now(),
    })
    notes.push(
      `${w.note} —— 残骸名「${w.name}的残骸」（48 游戏小时：离线时间照样消耗，衰减到 0 即消失）`,
    )
  }
  state.shipWreckSeq = seq
  notes.push('残骸记录号游标设为 3（同星系多具时按"最新那具优先"排序）')

  // 打捞演示船：白鲨级 4×打捞器 MK2（与既有 b3 档同款），停在暗星坟场 ⇒ 开档即可捞
  const uid = addShipToFleet(state, 'sh-whiteshark')
  const demo = state.fleet[uid]!
  demo.customName = '残骸打捞演示'
  demo.fitted = {
    high: ['mod-salvager-2', 'mod-salvager-2', 'mod-salvager-2', 'mod-salvager-2', null],
    mid: [null, 'mod-shield-kin-2', null],
    low: [null, null],
  }
  demo.durability = 1
  demo.armorPct = 1
  state.shipId = uid
  for (const id of ['mod-salvager-1', 'mod-salvager-2', 'mod-salvager-3']) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
  }
  for (const s of Object.values(state.fleet)) {
    s.durability = 1
    s.armorPct = 1
  }
  notes.push('新增「残骸打捞演示」白鲨级并设为驾驶（高槽 4×打捞器 MK2）；打捞器 MK1/2/3 各一件入库；全舰耐久回满')

  // 打捞铺底：坟场给足普通残骸（用来对照"残骸优先于稀有池、也优先于普通池"）
  state.galaxyWrecks['galaxy-grave'] = { density: 60, rare: 0 }
  state.galaxyWrecks['galaxy-redring'] = { density: 30, rare: 0 }
  state.galaxyWrecks['galaxy-vault'] = { density: 40, rare: 0 }
  notes.push('三个验收星系预置普通残骸密度 60 / 30 / 40（对照：残骸立着时**不产普通残骸**）')

  notes.push(
    '看什么：① 打捞面板置顶的「舰船残骸 N 具」读数卡（船名 + 可回收件数 + 剩余小时）② 点「开始打捞」后事件日志逐条出' +
      '「打捞舰船残骸：捞回 ◯◯ ×N」③ 捞完一具后该卡消失、装备库/仓库里多出那些件 ④ 稀有池与普通残骸在残骸立着期间**一点不动**' +
      '⑤（穹顶墓园那具）命中的话日志会写「捞回了一艘还能修的船」、多出舰船页里那艘带伤的鹦鹉螺',
  )
  return notes
}

const INJECTORS: Record<string, (state: GameState) => string[]> = {
  /**
   * **损伤管制装置验收档**（`dc` · **2026-09-26 船长令**：「做完后给我一个存档 我要测试」）。
   *
   * 现场：装备库三档齐备 ＋ 损管修理组件 ×20 ＋ 四张蓝图；主控船**低槽有空位就自动装上 MK3**
   * （装不上则留装备库手动装）。**不改钱包、不改声望、不改星系状态**——只加"能立刻开测"的那几件。
   *
   * 试法（详见 `docs/test-saves/README.md` 同名条目）：
   * ① **免死窗口**：出击一张硬卡，让结构被打空 ⇒ 战斗内提示「损伤管制装置启动：结构锁定 1」＋
   *    日志「✦ 损伤管制装置启动：结构锁定在 1 点、持续 1 秒（消耗损管修理组件 ×1）」；
   *    这一秒内**结构不再掉**（同拍多段也破不了）；1 秒后照旧会死（丁案不强制撤退）⇒ 要看窗口就趁早撤。
   * ② **每场一次**：同一场再被打空 ⇒ **不再启动**（照常判负）。
   * ③ **组件消耗**：战后战报末尾应有「损伤管制装置启动 ×1（消耗损管修理组件 ×1）」，仓库组件 −1。
   * ④ **没组件不启动**：把损管修理组件卖掉/搬空再打一场 ⇒ 只记一条「⚠ 损伤管制装置未能启动：损管修理组件不足。」
   * ⑤ **同舰唯一**：装配页再装第二件损伤管制装置 ⇒ 被拒「损伤管制装置每舰只能装一件（已装 …）」。
   * ⑥ **撤退保险**：开某被占星系的「重复出击」⇒ 结构过半即自动轻损撤退（不掷弃船骰、不丢船）。
   */
  dc: (state: GameState): string[] => {
    const notes: string[] = []
    for (const id of ['mod-dc-1', 'mod-dc-2', 'mod-dc-3']) {
      state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    }
    notes.push('装备库：损伤管制装置 MK1 / MK2 / MK3 各 ×1（低槽件 · 同舰只能装一件）')
    state.warehouse.items['repairkit-dc'] = (state.warehouse.items['repairkit-dc'] ?? 0) + 20
    state.warehouse.items['bp-repairkit-dc'] = (state.warehouse.items['bp-repairkit-dc'] ?? 0) + 1
    for (const id of ['bp-dc-1', 'bp-dc-2', 'bp-dc-3']) {
      state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + 1
    }
    notes.push('物品仓库：损管修理组件 ×20（50 万/件）＋ 蓝图 bp-repairkit-dc 与 bp-dc-1~3 各 ×1')
    const ship = state.fleet[state.shipId]
    const low = ship?.fitted?.low
    const free = Array.isArray(low) ? low.findIndex((v) => v === null) : -1
    if (ship && low && free >= 0) {
      low[free] = 'mod-dc-3'
      state.moduleBay['mod-dc-3'] = Math.max(0, (state.moduleBay['mod-dc-3'] ?? 0) - 1)
      if (state.moduleBay['mod-dc-3'] === 0) delete state.moduleBay['mod-dc-3']
      notes.push(`主控船「${ship.name ?? state.shipId}」低槽第 ${free + 1} 位已装【损伤管制装置 MK3】（+50 三系结构减伤）`)
    } else if (ship && low && low.length > 0) {
      /**
       * 低槽满 ⇒ **就地替换最后一位**（把它退回装备库，无损、可逆）——本档只为"能立刻开测"，
       * 不动钱包/声望/星系，换下来的那件仍在装备库里，测完装回即可。
       */
      const idx = low.length - 1
      const replaced = low[idx]
      low[idx] = 'mod-dc-3'
      state.moduleBay['mod-dc-3'] = Math.max(0, (state.moduleBay['mod-dc-3'] ?? 0) - 1)
      if (state.moduleBay['mod-dc-3'] === 0) delete state.moduleBay['mod-dc-3']
      if (replaced !== null && replaced !== undefined) state.moduleBay[replaced] = (state.moduleBay[replaced] ?? 0) + 1
      notes.push(
        `主控船「${ship.name ?? state.shipId}」低槽已满 ⇒ **就地替换第 ${idx + 1} 位**：` +
          `${replaced ?? '（空位）'} → 【损伤管制装置 MK3】（换下来的那件已退回装备库，测完装回即可）`,
      )
    } else {
      notes.push('主控船没有可用的低槽 ⇒ 未自动装配：请到装配页手动装上 MK1~MK3')
    }
    notes.push('试法：出击一张硬卡把结构打空 ⇒ 看「结构锁定 1」提示与战报尾巴；细节见 docs/test-saves/README.md')
    return notes
  },
  /**
   * **势力图鉴验收档**（`faction` · **2026-09-26 船长令**：「**势力图鉴……玩家能在敌族图鉴里查看该势力的
   * 专属装备和舰船**」＋「按你推荐来」）。
   *
   * 现场：把**六个势力（A/C/D/E/G/H）的全部敌舰**标成"已遭遇"（`state.foeShipSeen`）⇒ 图鉴里六族全部解锁：
   * 敌人块显示逐舰级简报（与悬赏卡悬停同一份内容）、专属块列出该族专属装备/舰船/图纸。
   * **B 武装拾荒者与 F 制式巡逻的舰级不标** ⇒ 用来对照"未解锁"的样子（不过图鉴本来也不收这两族）。
   * **不动钱包/声望/星系/舰队**——只改这一处遭遇记录（该字段本就是玩家的探索痕迹）。
   *
   * 试法（详见 `docs/test-saves/README.md` 同名条目）：
   * ① 打开手册 ⇒ 左栏「蓝图图鉴」下方应有 **「势力图鉴」**；六张卡各写「已遭遇 N/M」；
   * ② 点开任一族 ⇒ 三块：**势力简介**（基调/外观/战斗风格/招牌手段/出没之处）· **敌人**（逐舰级一行）·
   *    **专属装备与舰船**（含「图纸」一栏）；
   * ③ 想看"未解锁"的样子：把 `state.foeShipSeen` 清空后另存一份（本档不含清空逻辑，避免误伤）。
   */
  faction: (state: GameState): string[] => {
    const notes: string[] = []
    const seen: Record<string, true> = { ...(state.foeShipSeen ?? {}) }
    let n = 0
    for (const s of FOE_SHIPS) {
      if (!FACTION_CODEX_ORDER.includes(s.family)) continue // 只标图鉴收录的六族
      if (seen[s.id] !== true) n += 1
      seen[s.id] = true
    }
    state.foeShipSeen = seen
    notes.push(`已把图鉴收录六族的敌舰全部标为「已遭遇」（新增 ${n} 条 · 合计 ${Object.keys(seen).length} 条）`)
    notes.push('手册 → 势力图鉴：六张卡应各写「已遭遇 N/M」、点开有三块（简介/敌人/专属装备与舰船）')
    notes.push('对照：B 武装拾荒者与 F 制式巡逻不收（图鉴里没有这两张卡）')
    return notes
  },
  /**
   * **战列舰实机测试档**（2026-09-24 船长：「你给我准备一个有战列舰和各种装备的存档」）：
   * 真战列（巨齿鲨 T4）+ 旗舰（邓氏鱼 T5）+ 巡洋对照，中低槽装满、备件与弹药齐全。
   */
  battleship: injectBattleship,
  /**
   * **周末入侵 · 旗舰战准备档**（2026-09-25 船长：「帮我准备一个旗舰战之前的存档」）：
   * 核心 + 外围全部 100% ⇒ 旗舰现身、战役未开打；4 艘满配编队 + 弹药/修理组件备足、
   * 调试模式已开（入侵仅调试可见）。开档点「战前准备」即进选船界面。
   */
  weekend: (state) => injectWeekend(state),
  /** 同上，但**血池只剩 1,000** ⇒ 一场就能打空（验「击沉旗舰 + 黑匣」）。 */
  weekendkill: (state) => injectWeekend(state, { hurt: true }),
  /**
   * **虫洞 · 劫掠电子舰现场档**（2026-09-17 船长：「准备一个在虫洞内面对该敌人的存档」）：
   * 第 4 层 · A 族 · 站在舰船信号上 ⇒ 迎战即打「海盗战团」（内含劫掠电子舰，首轮开火放捕获网）。
   */
  'wh-ewar': injectWormholeEwar,
  /**
   * **虫洞 · 孢子导弹巢「全体攻击」现场档**（2026-09-25 船长：问"动画是不是打全体"并要一个相关存档）：
   * 第 1 层 · C 族 · 站在舰船信号上 ⇒ 迎战即打「星髓游猎群」（星髓成虫 ×3），
   * 主控装孢子导弹巢、僚舰不装武器 ⇒ 一眼看清"一轮 3 条弹道"。
   */
  'wh-spore': injectWormholeSpore,
  // 虫洞·货仓装不下 / 超载（2026-09-13 船长要的实机档）
  'wh-bag': (s) => injectWormholeBag(s, false),
  'wh-overload': (s) => injectWormholeBag(s, true),
  /**
   * **虫洞·第 4 层星云现场**（2026-09-13 船长：「给我准备一个4层的存档，我打算实际测试」）。
   *
   * 为什么单开一档：星云机制**只在层 4 起出现**（`WORMHOLE_NEBULA_MIN_DEPTH = 4`），
   * 而老档要下到层 4 得连打三层守卫 + 三层搜打撤（十几分钟）⇒ 手工验不到。
   */
  'wh-layer4': injectWormholeLayer4,
  /**
   * **虫洞·全量验收档**（2026-09-14 · 船长：「修复后给我准备一个可以全部测试的存档」）：
   * 乱摆货仓（3 货柜 + 2 谜质 + 2 条老档宽条 + 8 件散货）+ 第 2 层墓场/遗迹/矿脉/舰船信号/谜质
   * ⇒ 一档验完"整理 / 换位 / 抓任意一格拖动"三处修复与整条链路。
   */
  'wh-all': injectWormholeAll,
  /**
   * **虫洞 · 后勤舰验收档**（2026-09-16 船长要的存档：「后勤舰添加特性，维修装置可以修理血量最少的队友」）：
   * - 编队 **4 艘**：主控 = **亡军后勤舰**（唯一 `subClass: 后勤舰` · 装维修装置）＋ 2× 长尾鲨（一艘装装置 = 只修自己
   *   的对照，一艘裸装）＋ 1× 玳瑁（重装）；
   * - **四艘按不同残血进场**（`durability`/`armorPct`）⇒ 一开打就能看见"后勤舰去修最缺血的那艘"；
   * - **入口格 = 舰船信号**（到达即交火，不用找）；
   * - 同层另有 **遗迹**（打捞完 → 70% 出货柜）· **矿脉** · **墓场**；
   * - 仓库：修理组件管够 · 两个新货柜（贵重品/军用）各 2 + 安全货柜 1（撤离后可连拆）·
   *   谜质精华与奢侈品三档若干（物品页/市场看得到）；**扫描页预置 2 处已发现虫洞**（看卡片"敌情行"）。
   */
  'wh-logi': injectWormholeLogi,
  /**
   * **谜质科技实验档**（2026-09-19 船长：「给我个拥有谜质和虫洞的存档，我打算实机测试不同科技的影响」）：
   * 谜质 ×2,000 + 信用点 +3B（点满全树 1,196 枚 / 约 1.43B）· 声望 60（过扫描虫洞门槛）·
   * **货仓刻意不带装置**（纯科技读数；仓库另备装置供对照）· 第 2 层站在「舰船信号」上 ＋
   * 同层遗迹/矿脉/谜质格 ＋ 工业线备料（货柜/虚空母矿/残骸）。
   */
  'mt-lab': injectMatterTechLab,

  /**
   * **一次性图纸 · 取消退书实测档**（2026-09-20 船长「给我一个存档实机测试」）：
   * 六种局面（单张随手取消 / 多张不同挨个撤退 / **同名两条线**（缺口主场景）/ 普通图纸对照 /
   * 名额已用尽对照 / 舰船一次性）＋ 备料（按图纸现算 ×5）＋ AI 核心 ×8。
   */
  'bp-cancel': injectBpCancel,

  /**
   * **虫洞 · 路径拦截验收档**（2026-09-16 · 船长「路径拦截」机制）：
   * 三条直线摆成三种形态（拦路者已知 / 未扫描 / 路径干净）⇒ 一档看完确认栏、地图描红与"甲案不指名"。
   */
  'wh-intercept': injectWormholeIntercept,
  // wormhole（2026-09-13）：虫洞验收档（4×巡洋 MK2 基准编队 + T4/T5 对照 + 补给）
  wormhole: injectWormhole,
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
  // 蓝图碎片·逆向解锁验收档（2026-09-19 船长：玩家反应依旧找不到入口）
  fragments: injectFragments,
  dfamily: injectDfamily,
  // gswarm（2026-09-12 P-20a 收口）：G 族等离子蜂群验收档（四艘同型对照船，只差抗性系）
  gswarm: injectGSwarm,
  // shipwreck（2026-09-26 船长令）：玩家舰船残骸验收档（四种验证面 + 打捞演示船就位）
  shipwreck: injectShipWreck,
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
