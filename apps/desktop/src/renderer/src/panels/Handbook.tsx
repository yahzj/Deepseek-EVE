/**
 * 手册 / 图鉴（2026-09-10 船长改版：顶部标签页 → 左侧导航栏；图鉴按类型分组，样式照仓库；加搜索栏）。
 *
 * - 弹层加宽为双栏大窗（左导航 168px + 右内容），导航 7 项：玩法速览 / 航行须知 / 物品 / 装备 / 舰船 / 蓝图 / 技能速查；
 * - 图鉴按类型分组：分组表与市场页「类型子分类」同源（见 ui/itemSubs.ts），每组 = 仓库同款小节
 *   （分类名 + 数量 + 卡片网格），空组隐藏；
 * - 内容区顶栏：搜索 + 图标/列表切换 + 命中计数；搜索只作用于当前页（按名称/分类/说明过滤，
 *   玩法速览与航行须知按词条过滤），切页自动清空关键词；
 * - 数据页支持「图标网格 / 列表」两种视图（默认网格，偏好存 localStorage）；
 * - 图标为统一科幻线性 SVG（Glyphs.tsx），按内容体系映射并带分类色调；
 * - 网格模式下点击卡片 → 弹出详情窗（完整字段）；点击窗口外任意位置关闭；列表视图保留完整字段。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { ITEM_KIND_LABELS, ITEM_KIND_ORDER, itemKindText, rackOf, SHIP_ROLE_LABELS, SLOT_LABELS, shipSizeLabel } from '@whale/core'
import type { DroneClass, ItemKind } from '@whale/core'
import { Panel } from '@whale/ui'
import type { GameEngine } from '../game/engine'
import { Glyph, toneOf } from '../ui/Glyphs'
import { BLUEPRINT_SUBS, MODULE_SUBS, SHIP_SUBS, moduleSubKeyOf } from '../ui/itemSubs'
import { RowGlyph } from '../ui/itemView'
import { combatBadges, InfoHover, itemCombatLines, itemInfoLines, ItemHover, ModuleHover, moduleInfoLines, moduleShortEffect, ShipHover, shipIndirectLines, shipInfoLines } from '../ui/shipInfo'
import { plainSkillDesc } from '../ui/skillText'

/** 宽类型标签索引（详情窗数据来自 raw，键是 string） */
const kindName = (k: string): string => (ITEM_KIND_LABELS as Record<string, string>)[k] ?? k
const slotName = (k: string): string => (SLOT_LABELS as Record<string, string>)[k] ?? k
const roleName = (k: string): string => (SHIP_ROLE_LABELS as Record<string, string>)[k] ?? k

type Tab = 'guide' | 'rules' | 'items' | 'modules' | 'ships' | 'blueprints' | 'skills'
type ViewMode = 'grid' | 'list'
/** 详情行数据 */
type RawData = Record<string, unknown>

/** 左侧导航（顺序即展示顺序） */
const NAV: Array<{ key: Tab; label: string }> = [
  { key: 'guide', label: '玩法速览' },
  { key: 'rules', label: '航行须知' },
  { key: 'items', label: '物品图鉴' },
  { key: 'modules', label: '装备图鉴' },
  { key: 'ships', label: '舰船图鉴' },
  { key: 'blueprints', label: '蓝图图鉴' },
  { key: 'skills', label: '技能速查' },
]
/** 各页搜索框占位词（按当前页给出，玩家一眼知道搜的是哪一页） */
const SEARCH_PLACEHOLDER: Record<Tab, string> = {
  guide: '搜索玩法速览…',
  rules: '搜索航行须知…',
  items: '搜索物品图鉴…',
  modules: '搜索装备图鉴…',
  ships: '搜索舰船图鉴…',
  blueprints: '搜索蓝图图鉴…',
  skills: '搜索技能速查…',
}
/** 分组计数量词（与仓库「N 种」同款） */
const COUNT_UNIT: Record<Tab, string> = {
  guide: '条',
  rules: '条',
  items: '种',
  modules: '件',
  ships: '艘',
  blueprints: '张',
  skills: '项',
}
const VIEW_KEY = 'whale-idle:handbook-view'

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/* ═══════════ 玩法速览（2026-09-10 船长定：5 组 15 条 + 小贴士；见 docs/design/handbook-guide-rework-20260909.md） ═══════════ */

interface GuideGroup {
  title: string
  rows: Array<[string, string]>
}

const GUIDE_GROUPS: GuideGroup[] = [
  {
    title: '生产循环',
    rows: [
      ['采矿', '出港页「矿带开采」选带出击：矿石进驾驶船货仓，到港自动整仓卸入物品仓库。练「采矿技术 / 采矿护卫舰操作」提产量、缩循环；「自动循环」与 AI 副船让矿机不停转。'],
      ['装卸', '任何舰船进港（停靠母港或已建成副站）都会自动整仓卸入物品仓库（无限容量、不随船）；货仓页也可手动卸货——空闲停靠的非驾驶船同样可以。出售仍只对当前驾驶船开放。'],
      ['精炼', '工业页把矿石炼成矿物（「产出倍率」由精炼学与高级回收处理提升：基础 120%、技能最高 165%——无技能时炼矿净收益约为原料价值两成）；矿物是制造原料，也可卖出。炉位：主控亲自运转限 1 台（占主控工作位），每枚 AI 核心各驱动一台——AI 核心启用数受上限约束，细则见「AI 副船」；原料不锁定，每批到点从货仓 + 仓库实时扣取。'],
      ['制造与蓝图', '市场可购到所有装备与舰船（协会保底艇、异星原型科技除外）的蓝图书：购图到「蓝图书架」学习一次即永久可造，再到工业页组装机 / 船坞按图备料开工——制造免费，只耗材料与时间，到点自动入库 / 入坞。图纸价格随产物档位升高、在市场上出现得也稀罕；赶时间可以继续直接买成品现货，两条渠道并存。产线由主控（全局限 1 条、占主控不可离港）或一枚 AI 核心驱动（占用 AI 核心上限，见「AI 副船」）。'],
    ],
  },
  {
    title: '战斗与生存',
    rows: [
      ['远征讨伐', '星图「悬赏情报」选目标「出发」即开战：按火力结算，胜利得奖金 / 战利品 / 声望后自动返航（途中不可召回；停靠最近已建成站，无副站 = 母港）；失利扣耐久、可能弃船，同样自动返航（途中可召回）。去程并入返航（只计返航路程）；母港本地的悬赏固定约 2 分钟返港。'],
      ['装配', '装备库里的模块装到高 / 中 / 低槽位（布局见船卡；受 CPU 约束），卸下自动退回装备库。抗性按递减方式合成（同一层装得越多越接近上限 90%，基础抗高的船提升越小）；伤害 / 射速 / 容量可以多装全量叠加（只受 CPU 限制），命中 / 闪避 / 抗性 / 速度同类多装收益递减（第 2 件约剩八成七、第 3 件约剩五成七）。「动力」影响弃船避险与跃迁充能。装配 CPU 预算是**唯一硬约束**（全部位合计 ≤ 船体 CPU；无人机放飞共用同一份预算）——**低槽「协处理器」可为预算扩容**（本件自身不占 CPU，卸下即收回：卸到超载会被拒绝，避免"装扩容件塞满再卸掉"套利）。中槽「矢量推进器」是周期点火：开场即点火、持续 60 秒，随后冷却 60 秒——点火期间战斗机动显著提升、开火命中略降（失稳代价同样只在点火期生效），冷却期间两者都回到基础值；战斗界面底部显示推进器倒计时。无人机在装配页「无人机舱」装入清单（舱容 = 无人机舱 + 甲板扩展，与装配共用 CPU），战斗只放飞已装入的；卸下甲板扩展使机舱变小时，超出的无人机会自动退回仓库；战术导控阵列增伤。敌方近防炮会击落机群——战斗内机群可能全部损坏，战后按回收率找回一部分（基础 20%，「无人机回收学」满级 50%），**回收名额优先给价值更高的机型**；未回收的才自清单永久损失，战报里会列出这次回收了哪些、净损失哪些；侦察机靠闪避、攻坚机靠厚甲、哨戒机默认被近防炮放过（其余机型全被打光后就轮到它）。'],
      ['耐久与维修', '战斗磨损「结构」（= 耐久）与装甲：损伤跨场保留，结构归零弃船（货随船失）；护盾损失不保留（战斗中被动回充、脱战回满）。恢复：空间站付费维修，或货仓带「修理组件」野外应急（民用 / 军用两档，市场可买、工业页可自制；重复清剿会自动消耗）。想战中续命，可挂「船体维修装置」——每 5 秒自动修复装甲与结构，每跳吃掉一枚修理组件。'],
    ],
  },
  {
    title: '残骸与回收',
    rows: [
      ['打捞残骸', '驾驶船高槽装打捞器（无伤害件，升级只减周期）后，在星图「残骸打捞」选星系开捞：自动循环作业，满舱自动返航卸货后自动续捞（勾「本次返航卸货后停止」可做单趟）；低安星系打捞作业中可能遇袭，规则见「航行须知」。'],
      ['回收残骸', '打捞的残骸在工业页开箱拆解：回收卡按敌群列出这批残骸的「保底矿物」，随 星系危险度 × 敌群威胁 上浮；另有概率特色掉落——同卡的「特色掉落」栏写出的该敌群增幅装备（含关底穹顶守卫直出 MK3 武器）与高威胁蓝图碎片（MK3 装备只经碎片解锁）。星图「残骸打捞」页会先标出该星系的这些内容。'],
    ],
  },
  {
    title: '副船与扩张',
    rows: [
      ['AI 副船', '练「AI 核心操作学」（入门向）+ 买基础 AI 核心，可给闲置舰船指派自动采矿 / 打捞 / 掩护巡逻任务——核心效率越高越快；同时启用的 AI 核心总数受 AI 核心上限技能约束（Lv0 无法启用），AI 副船与站内精炼炉 / 回收炉 / 制造线共用该上限；站内产业可另练「工业自动化」扩容工业专用工位（每级 +2 枚、不占副船名额）。舰船页「AI 指挥中心」可统一指派与取消这些作业。'],
      ['副空间站', '建成的副站并入协会基地网络：市场买卖、精炼与残骸回收、组装机制造线、维修补给、换驾驶卸货全部可用——设施与仓库和母港共享（同一市场与仓库）；采矿 / 打捞自动返航、悬赏与扫描的胜利返航都会停到最近已建成的站；手动召回仍回母港。未建成的工地不提供停靠与任何站内功能：人在现场可提交建材，或停靠空间站后一键「前往工地交付」——每趟装满货仓出航，到点清仓自动交付，并自动往返续运直到建站完成或仓库建材耗尽（途中可随时取消）。'],
      ['长途运输', '建成至少一座副站后，星图「长途运输」页签开放：选一条两站航线即可开始自动往返货运——虚拟货物占满货仓（不影响真实货物），每段按货仓容量 × 航程结算报酬，到站自动续下一段；随时「停止运输」会立即返港停靠，无惩罚。'],
      ['势力与舰船', '深空工业协会是星域唯一的官方力量，舰船分部门出品：鲸盟（采矿工船）、掠食者（武装舰）、甲壳（重装舰）、蜃楼（航运货舰）。舰船按舰体尺寸分五档：护卫舰、驱逐舰、巡洋舰、主力舰、旗舰——档位越高舰体越强，价格与协会声望门槛随之抬高；同档之内还有子型号（炮舰、无人机母舰等）与更精贵的奇货版本。'],
    ],
  },
  {
    title: '市场与世界',
    rows: [
      ['交易', '市场页：常驻供应 / 稀有订单两栏，挂单与市价买卖；卖出成交收贸易税（练贸易技能减免）。市场全程挂单簿撮合，收购价低于供应价；集中买卖会带动价格短时偏离（冲击动量），矿石 / 矿物另受库存池调节。'],
      ['随机事件', '深空偶发奇遇与市场风云：约 10~30 分钟一件，事件日志带 ✦，在线时弹小卡。'],
    ],
  },
]

const GUIDE_NOTES: string[] = [
  '技能训练与采矿 / 远征并行：训练队列永不停歇，先排要练的技能即可。',
  '物品仓库与装备库是空间站资产，弃船不丢；船上的货仓与装备会随船遗失。',
  '离线最长结算 8 小时：下次启动会自动结算并弹离线简报。',
]

/* ═══════════ 航行须知（文案保持原样，仅改为按小节渲染） ═══════════ */

interface RuleSect {
  title: string
  rows: Array<[string, string]>
}

const RULE_SECTS: RuleSect[] = [
  {
    title: '低安安全（安全等级 = 星系风险）',
    rows: [
      ['安全等级', '星图星系标色：越高越安全。sec ≥ 0.5 高安；0 < sec < 0.5 中安；sec ≤ 0 低安——只有低安会遇到巡逻拦截与海盗伏击（中安与高安不会），安全等级越低越危险、越频繁。'],
      ['什么会遇袭', '低安只对「停留与就地作业」动手：矿带采掘中、打捞作业中、扫描期间、掩护巡逻驻留都可能撞见巡逻拦截或海盗伏击；**长途运输途中同样会遇袭**——跑运输的舰船在航段里会被当作「停在出发星系」，含低安航段的航线在「长途运输」页会标出这一条。AI 副船同样适用。'],
      ['承担者', '同一低安星系我方有船在场时，停泊 / 停留的船优先成为目标（区域事件一次，事件后该星系冷却一段时间）。'],
      ['触发节奏', '进入低安作业 / 驻留约 5 分钟后才可能遇袭（入场缓冲；扫描例外——扫描即暴露、无缓冲）；遇袭判定与随机事件共用时机——事件到点时可能撞上巡逻 / 伏击，也可能照常出事件。'],
      ['在线时', '遭遇会弹出「伏击待决」横幅：可「⚔ 迎战」（进入实时战斗，自动打完）或「» 快速脱离」；60 秒未处置自动脱离。'],
      ['离线时', '离线（含离线结算）遭遇直接文字结算，不会凭空等你去点。'],
      ['结局三档', '击退：缴获少量 ISK；受损：敌方火力越强挨得越狠——先扣装甲、装甲吃穿才伤结构（底线 5%，绝不弃船）；被抢：至多 30% 船上货物（无货则抢少量钱包）。'],
      ['受损后先修再判', '遭遇了结后**先自动修补**：装甲或结构低于 50% 时，就地用**修理组件**（货舱优先、仓库兜底）补到两者约 60%，或组件用尽；**组件不足**、或**补完后结构仍低于 50%**，才收手返港待命——驾驶船停下采掘 / 打捞 / 扫描并即时返航最近已建成站，副船中止任务召回（副船结构低于 50% 需修好才能再派）。'],
      ['迎战也有保险', '低安遭遇点「⚔ 迎战」时，本场结构损失过半即自动脱离（轻损退出，不给缴获也不额外扣损），随后同样走上面的撤退口径——不会把船打到弃船。'],
    ],
  },
  {
    title: '重要规则留档',
    rows: [
      ['采矿 ↔ 远征 转场', '采矿中点悬赏「⇄ 转战出发」= 结束采矿（货随船）并从矿带星系出发；远征中点矿带「⇄ 转开采」= 取消远征（无战果、讨伐同步停）并回港开采。均需两次确认。'],
      ['重复清剿', '空闲时可开：胜利后自动返航回港（去程并入返航），冷却结束自动再出发，往复巡回；货仓装不下缴获 / 耐久低于 50% 且修理组件耗尽 / 战败都会自动暂停。'],
      ['战斗撤退', '交火中可「⚑ 撤退」（活动栏或战场内，两次确认）：轻损脱离、无弃船风险、立刻回港并停止讨伐（自动撤退与超时判负仍需航程返港）。'],
      ['船只锁定', '锁定只防误售：驾驶、AI 执勤、维修、改名都不受影响。'],
      ['重复舰船', '同型可买多艘：第 2 艘起默认带「#N」；可自由改名（10 字内、允许重名），改名后全界面显示自定义名。'],
      ['货仓与出售', '任何舰船到港即自动卸货入仓库；货仓页可手动卸货——空闲停靠的非驾驶船同样可卸。出售与装船只对当前驾驶船，且需停靠空间站（母港或已建成副站——共用同一市场与仓库）。'],
      ['离线结算', '离线最长结算 8 小时，重启自动结算并弹离线简报。'],
    ],
  },
  {
    title: '战斗 · 伤害克制速查',
    rows: [
      ['血条三层', '每艘船血量分 护盾 → 装甲 → 结构 三层依次承受（破层溢出向下渗透）。'],
      ['伤害克制矩阵', '动能弹：盾 ×1.5 / 甲 ×0.5 / 结构 ×1（专职拆盾）；爆炸弹（高爆 / 导弹）：盾 ×0.5 / 甲 ×1.5 / 结构 ×1（专职破甲）；能量（等离子弹 / 激光）：盾 ×1.25 / 甲 ×1 / 结构 ×1（拆盾也强、无弱点）。弹药 chip 颜色 = 对应克制层色（盾蓝 / 甲红 / 结构黄），悬停可见矩阵。'],
      ['抗性合成', '各层抗性按递减方式合成（上限 90%）：每层受到的伤害 = 层伤害 × 克制倍率 ×（1 − 该层对应系抗性）——配装时看敌方主伤害类型，选对应层抗与弹种。'],
    ],
  },
  {
    title: '目标档案',
    rows: [
      ['寻找人类', '人类已全体失踪——你是一艘前人类时代的舰船 AI。目前没有任何可执行线索，完成方法未知；在这座章鱼宇宙人统治的母港继续航行，或许终会有所发现。'],
    ],
  },
]

/* ═══════════ 网格渲染 ═══════════ */

interface GridCell {
  key: string
  tab: Tab
  glyph: string
  name: string
  sub: string
  /** 完整数据（详情窗用） */
  raw: RawData
}

/** 一个分组（仓库同款小节）：分类名 + 数量 + 卡片 */
interface CellGroup {
  key: string
  label: string
  cells: GridCell[]
}

/** 按分组表切分卡片（表内顺序在前，未收录的键兜底追加，避免新增内容漏出图鉴） */
function groupCells(
  cells: GridCell[],
  keyOf: (c: GridCell) => string,
  order: readonly { key: string; label: string }[],
): CellGroup[] {
  const byKey = new Map<string, GridCell[]>()
  for (const c of cells) {
    const k = keyOf(c)
    const arr = byKey.get(k)
    if (arr) arr.push(c)
    else byKey.set(k, [c])
  }
  const out: CellGroup[] = []
  for (const o of order) {
    const arr = byKey.get(o.key)
    if (arr && arr.length > 0) {
      out.push({ key: o.key, label: o.label, cells: arr })
      byKey.delete(o.key)
    }
  }
  for (const [k, arr] of byKey) out.push({ key: k, label: k, cells: arr })
  return out
}

function IconGrid({ cells, onPick }: { cells: GridCell[]; onPick: (c: GridCell) => void }) {
  return (
    <div className="app-hand-grid">
      {cells.map((c) => {
        const tone = toneOf(c.glyph)
        return (
          <button key={c.key} className="app-hand-cell" onClick={() => onPick(c)} style={{ '--tone': tone } as React.CSSProperties}>
            <span className="app-hand-cell-icon">
              <Glyph name={c.glyph} size={30} color={tone} />
            </span>
            <span className="app-hand-cell-name">{c.name}</span>
            <span className="app-hand-cell-sub">{c.sub}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════ 详情窗 ═══════════ */

/** 详情内容（按页签/数据类型给出完整字段） */
function DetailBody({ engine, cell }: { engine: GameEngine; cell: GridCell }) {
  const r = cell.raw
  const rows: Array<[string, ReactNode]> = []

  if (cell.tab === 'items') {
    const kind = String(r.kind ?? '')
    // 2026-09-10 船长：无人机把归类子属性并入「种类」（无人机 · 侦察机）——走 core 单点
    rows.push([
      '种类',
      itemKindText({ kind: kind as ItemKind, droneClass: r.droneClass as DroneClass | undefined }),
    ])
    rows.push(['单位体积', `${Number(r.unitM3 ?? 0)} m³`])
    // V10.5：弹药/无人机补充伤害契约（与其它界面统一由 shipInfo 生成）
    const itemId = String(r.id ?? '')
    const itemDef = itemId ? engine.ctx.items.get(itemId) : undefined
    if (itemDef && (itemDef.kind === 'ammo' || itemDef.kind === 'drone')) {
      for (const line of itemCombatLines(itemDef)) rows.push([line.k, line.v])
    }
    const refine = (r.refine as Array<{ mineralId: string; perOre: number }> | undefined) ?? []
    if (refine.length > 0) {
      rows.push([
        '精炼配方',
        refine
          .map((row) => `${engine.ctx.items.get(row.mineralId)?.name ?? row.mineralId} ×${row.perOre}`)
          .join('　'),
      ])
    }
  } else if (cell.tab === 'modules') {
    const modId = String(r.id ?? '')
    const modDef = modId ? engine.ctx.modules.get(modId) : undefined
    if (modDef) {
      // V17：统一行——各家族真实进公式参数（工业加成 / 武器卡 / 容量+缺口抗性 / 加力推进）
      for (const line of moduleInfoLines(modDef)) rows.push([line.k, line.v])
    } else {
      rows.push(['槽位', `${slotName(String(r.slot ?? ''))} · 加成 ${Math.round(Number(r.bonus ?? 0) * 100)}%`])
    }
  } else if (cell.tab === 'ships') {
    const shipId = String(r.id ?? '')
    const shipDef = shipId ? engine.ctx.ships.get(shipId) : undefined
    if (shipDef) {
      // V10.5：统一行（定位/货舱/采集/动力 + 盾甲结构抗性与槽位）；V17 战斗数值已生效
      for (const line of shipInfoLines(shipDef)) rows.push([line.k, line.v])
      // 2026-09-12 船长：「手册图鉴里的舰船信息可以查看舰船的间接属性」⇒ 追加间接属性行
      // （最大速度/跃迁速度/质量/锁定范围/信号半径/扫描分辨率/跃迁充能；与装配页同一数据源）。
      // ⚠ 行以 `k` 作 React key ⇒ `shipIndirectLines` 的键不得与 `shipInfoLines` 重名（当前无重名）。
      for (const line of shipIndirectLines(shipDef)) rows.push([line.k, line.v])
      rows.push(['说明', '已生效战斗数值：抗性按递减方式合成（上限 90%）'])
      rows.push(['获取方式', Number(r.priceIsk ?? 0) <= 0 ? '仅可制造（市场无成品现货：舰船蓝图船厂定制；已拥有的可二手出售）' : '市场流通'])
    } else {
      const role = String(r.role ?? 'industrial')
      rows.push(['定位 / 档次', `${roleName(role)} · ${shipSizeLabel(Number(r.tier ?? 0))} T${Number(r.tier ?? 0)}`])
      rows.push(['货舱容量', `${Number(r.cargoM3 ?? 0).toLocaleString('zh-CN')} m³`])
      rows.push(['采集性能', `${Number(r.cycleSeconds ?? 0)} 秒 × ${Number(r.oreUnitsPerCycle ?? 0)} 单位/循环`])
      rows.push(['动力（机动 / 跃迁充能）', `${Math.round(Number(r.agility ?? 0) * 100)}%`])
      if (Number(r.priceIsk ?? 0) <= 0) rows.push(['获取方式', '仅可制造（市场无成品现货：舰船蓝图船厂定制；已拥有的可二手出售）'])
    }
  } else if (cell.tab === 'blueprints') {
    const materials = (r.materials as Array<{ itemId: string; count: number }> | undefined) ?? []
    const moduleId = r.moduleId !== undefined ? String(r.moduleId) : undefined
    const itemId = r.itemId !== undefined ? String(r.itemId) : undefined
    const shipId = r.shipId !== undefined ? String(r.shipId) : undefined
    // 产物 + 产物属性行 + 产物介绍（2026-09-08 船长定：蓝图详情须同显产物属性与介绍——
    // 与图鉴 modules/ships/items 分支同一数据源；弹药蓝图产物此前误落舰船分支，一并修正）
    let productName = ''
    const prodRows: Array<[string, ReactNode]> = []
    if (itemId !== undefined) {
      const itemDef = engine.ctx.items.get(itemId)
      productName = `${itemDef?.name ?? itemId}（弹药）`
      if (itemDef) {
        for (const l of itemInfoLines(itemDef, (id) => engine.ctx.items.get(id)?.name)) prodRows.push([l.k, l.v])
        if (itemDef.description) prodRows.push(['产物介绍', itemDef.description])
      }
    } else if (moduleId !== undefined) {
      const modDef = engine.ctx.modules.get(moduleId)
      productName = `${modDef?.name ?? moduleId}（装备）`
      if (modDef) {
        // V17：统一行——各家族真实进公式参数（工业加成 / 武器卡 / 容量+缺口抗性 / 加力推进）
        for (const l of moduleInfoLines(modDef)) prodRows.push([l.k, l.v])
        if (modDef.description) prodRows.push(['产物介绍', modDef.description])
      }
    } else {
      const shipDef = engine.ctx.ships.get(shipId ?? '')
      productName = `${shipDef?.name ?? shipId ?? ''}（舰船）`
      if (shipDef) {
        // V10.5：统一行（定位/货舱/采集/动力 + 盾甲结构抗性与槽位）；V17 战斗数值已生效
        for (const l of shipInfoLines(shipDef)) prodRows.push([l.k, l.v])
        // 2026-09-12 船长：舰船蓝图详情同样可见间接属性（与图鉴·舰船分支同口径）
        for (const l of shipIndirectLines(shipDef)) prodRows.push([l.k, l.v])
        if (shipDef.description) prodRows.push(['产物介绍', shipDef.description])
      }
    }
    rows.push(['产物', productName])
    for (const [k, v] of prodRows) rows.push([k, v])
    rows.push([
      '材料需求',
      <span key="mats" className="app-detail-mats">
        {materials.map((m) => (
          <span key={m.itemId} className="app-detail-mat">
            {engine.ctx.items.get(m.itemId)?.name ?? m.itemId} ×{m.count.toLocaleString('zh-CN')}
          </span>
        ))}
      </span>,
    ])
    rows.push(['耗时', `约 ${Math.round(Number(r.buildSeconds ?? 0) / 60)} 分钟（受工业理论缩短）`])
    rows.push(['制造', '免费（只耗材料与时间）'])
  } else if (cell.tab === 'skills') {
    rows.push(['技能组', String(r.group ?? '')])
    rows.push(['训练难度', `rank ${Number(r.rank ?? 0)}（数值越大整条线练得越慢）`])
  }

  return (
    <div className="app-detail-body">
      {rows.map(([k, v]) => (
        <div key={k} className="app-detail-row">
          <span className="app-detail-key">{k}</span>
          <span className="app-detail-val">{v}</span>
        </div>
      ))}
      {String(r.description ?? '') !== '' ? (
        <div className="app-detail-desc">{plainSkillDesc(String(r.description))}</div>
      ) : null}
    </div>
  )
}

function CellDetail({
  engine,
  cell,
  onClose,
}: {
  engine: GameEngine
  cell: GridCell
  onClose: () => void
}) {
  const tone = toneOf(cell.glyph)
  return (
    <div className="app-detail-mask" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div
        className="app-detail"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        style={{ '--tone': tone } as React.CSSProperties}
      >
        <div className="app-detail-head">
          <span className="app-hand-cell-icon">
            <Glyph name={cell.glyph} size={44} color={tone} />
          </span>
          <div className="app-detail-title">
            <div className="app-detail-name">{cell.name}</div>
            <div className="app-detail-sub">{cell.sub}</div>
          </div>
        </div>
        <DetailBody engine={engine} cell={cell} />
        <div className="app-dim app-detail-tip">点击窗口外部任意位置关闭</div>
      </div>
    </div>
  )
}

/** 一个分组小节（仓库同款：分类名 + 数量 + 卡片/列表） */
function GroupSection({
  label,
  unit,
  count,
  children,
}: {
  label: string
  unit: string
  count: number
  children: ReactNode
}) {
  return (
    <Panel title={label} right={<span className="app-dim">{count} {unit}</span>}>
      {children}
    </Panel>
  )
}

export function Handbook({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('guide')
  const [view, setView] = useState<ViewMode>(readView)
  const [detail, setDetail] = useState<GridCell | null>(null)
  const [query, setQuery] = useState('')

  function changeView(v: ViewMode): void {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // 本地存储不可用：忽略
    }
  }
  /** 切页：清空关键词与详情（各页关键词互不相关，避免"换了页却没结果"的困惑） */
  function changeTab(t: Tab): void {
    setTab(t)
    setQuery('')
    setDetail(null)
  }

  const q = query.trim().toLowerCase()
  const hitCell = (c: GridCell): boolean =>
    q === '' ||
    c.name.toLowerCase().includes(q) ||
    c.sub.toLowerCase().includes(q) ||
    String(c.raw.description ?? '').toLowerCase().includes(q)
  const hitRow = ([k, v]: [string, string]): boolean =>
    q === '' || k.toLowerCase().includes(q) || v.toLowerCase().includes(q)

  /* ── 网格单元（glyph 名即色调键；raw 带完整数据供详情窗） ── */
  const itemCells: GridCell[] = engine.items.map((item) => ({
    key: item.id,
    tab: 'items',
    glyph: item.kind,
    name: item.name,
    sub: `${kindName(item.kind)} · ${item.unitM3} m³`,
    raw: item as unknown as RawData,
  }))
  const moduleCells: GridCell[] = engine.modules.map((mod) => ({
    key: mod.id,
    tab: 'modules',
    glyph: mod.slot,
    name: mod.name,
    sub: `${slotName(mod.slot)} · ${moduleShortEffect(mod)}`,
    raw: mod as unknown as RawData,
  }))
  const shipCells: GridCell[] = engine.ships.map((ship) => {
    const role = ship.role ?? 'industrial'
    return {
      key: ship.id,
      tab: 'ships',
      glyph: role,
      name: ship.name,
      sub: `${roleName(role)} · ${shipSizeLabel(ship.tier)} T${ship.tier} · ${ship.cargoM3.toLocaleString('zh-CN')} m³`,
      raw: ship as unknown as RawData,
    }
  })
  const bpCells: GridCell[] = [
    ...engine.blueprints.map((bp) => ({
      key: bp.id,
      tab: 'blueprints' as Tab,
      glyph: 'blueprint',
      name: bp.name,
      sub:
        bp.itemId !== undefined
          ? // 产物门类取**产物自己的**大类（2026-09-11 船长：「弹药蓝图改为消耗品蓝图」——
            // 此前一律写死「弹药」，2 张修理组件蓝图被错标成弹药）
            `${kindName(engine.ctx.items.get(bp.itemId)?.kind ?? 'ammo')} · ${engine.ctx.items.get(bp.itemId)?.name ?? bp.itemId}`
          : `装备 · ${engine.ctx.modules.get(bp.moduleId ?? '')?.name ?? bp.moduleId ?? ''}`,
      raw: bp as unknown as RawData,
    })),
    ...engine.shipBlueprints.map((bp) => ({
      key: bp.id,
      tab: 'blueprints' as Tab,
      glyph: 'blueprint',
      name: bp.name,
      sub: `舰船 · ${engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId}`,
      raw: bp as unknown as RawData,
    })),
  ]
  const skillCells: GridCell[] = engine.skills.map((s) => ({
    key: s.id,
    tab: 'skills',
    glyph: `group-${s.group}`,
    name: s.name,
    sub: `${s.group} · 难度 ${s.rank}`,
    raw: s as unknown as RawData,
  }))

  /* ── 分组（顺序表与市场页类型子分类同源；空组隐藏） ── */
  const filtered = (cells: GridCell[]): GridCell[] => cells.filter(hitCell)
  const showCells = (cells: GridCell[], t: Tab): CellGroup[] => groupCells(cells, groupKeyOf, orderOf(t))
  /** 分组键：物品按大类 / 装备按槽类 / 舰船按舰族 / 蓝图按产物门类（装备蓝图再按产物槽类） / 技能按技能组 */
  function groupKeyOf(c: GridCell): string {
    if (c.tab === 'items') return String(c.raw.kind ?? '')
    if (c.tab === 'modules') return moduleSubKeyOf(String(c.raw.slot ?? ''))
    if (c.tab === 'ships') return String(c.raw.role ?? 'industrial')
    if (c.tab === 'blueprints') {
      // 2026-09-10 船长：装备蓝图按**产物模块的槽类**分高/中/低档（与市场页子分类同源单点）
      // 2026-09-11 船长：「舰船部分按舰船级别划分」——舰船蓝图由 1 组拆成 T1~T5 五组（键 t<级别>，同表）
      if (c.raw.shipId !== undefined) {
        const ship = engine.ctx.ships.get(String(c.raw.shipId))
        return ship ? `t${ship.tier}` : ''
      }
      if (c.raw.itemId !== undefined) return 'supply'
      const mod = engine.ctx.modules.get(String(c.raw.moduleId ?? ''))
      return mod ? rackOf(mod) : ''
    }
    return String(c.raw.group ?? '') // skills
  }
  /** 分组顺序表（与市场页同源；装备未收录槽位归「其它」） */
  function orderOf(t: Tab): Array<{ key: string; label: string }> {
    if (t === 'items') return ITEM_KIND_ORDER.map((k) => ({ key: k, label: kindName(k) }))
    if (t === 'modules') return MODULE_SUBS.map((s) => ({ key: s.key, label: s.label })).concat([{ key: '', label: '其它' }])
    if (t === 'ships') return SHIP_SUBS.map((s) => ({ key: s.key, label: s.label }))
    if (t === 'blueprints') return BLUEPRINT_SUBS.map((s) => ({ key: s.key, label: s.label })).concat([{ key: '', label: '其它' }])
    return engine.groups.map((g) => ({ key: g, label: g })) // skills
  }

  const codexCells: Record<'items' | 'modules' | 'ships' | 'blueprints' | 'skills', GridCell[]> = {
    items: itemCells,
    modules: moduleCells,
    ships: shipCells,
    blueprints: bpCells,
    skills: skillCells,
  }
  const isCodex = tab === 'items' || tab === 'modules' || tab === 'ships' || tab === 'blueprints' || tab === 'skills'
  const groups: CellGroup[] = isCodex ? showCells(filtered(codexCells[tab]), tab) : []
  const codexHit = isCodex ? groups.reduce((n, g) => n + g.cells.length, 0) : 0

  /** 左侧导航计数：图鉴类 = 条目数（搜索时显示命中数），说明类 = 词条数 */
  function navCount(t: Tab): number {
    if (t === 'guide') return GUIDE_GROUPS.reduce((n, g) => n + g.rows.filter(hitRow).length, 0)
    if (t === 'rules') return RULE_SECTS.reduce((n, s) => n + s.rows.filter(hitRow).length, 0)
    return codexCells[t].filter(hitCell).length
  }
  /** 当前页命中计数文案（搜索态与全量态） */
  const countText = (): string => {
    if (tab === 'guide' || tab === 'rules') {
      const n = navCount(tab)
      return q === '' ? `${n} ${COUNT_UNIT[tab]}` : `匹配 ${n} ${COUNT_UNIT[tab]}`
    }
    return q === '' ? `${codexHit} ${COUNT_UNIT[tab]}` : `匹配 ${codexHit} ${COUNT_UNIT[tab]}`
  }

  /* ── 列表视图：按分组渲染同一批卡片（沿用原有完整字段行） ── */
  function renderList(g: CellGroup): ReactNode {
    const ids = new Set(g.cells.map((c) => c.key))
    if (tab === 'items') {
      return (
        <ul className="app-hand-list">
          {engine.items
            .filter((item) => ids.has(item.id))
            .map((item) => {
              const refine = (item.refine ?? [])
                .map((r) => `${engine.ctx.items.get(r.mineralId)?.name ?? r.mineralId}×${r.perOre}`)
                .join(' + ')
              return (
                <ItemHover
                  key={item.id}
                  as="li"
                  item={item}
                  nameOf={(pid) => engine.ctx.items.get(pid)?.name}
                  className="app-hand-entry"
                >
                  <div className="app-inv-name">
                    <RowGlyph glyph={item.kind} /> {item.name}
                    <span className="app-chip is-dim">{itemKindText(item)}</span>
                    <span className="app-dim"> · {item.unitM3} m³/单位</span>
                  </div>
                  <div className="app-dim">{item.description}</div>
                  {refine ? <div className="app-hand-sub">精炼（产出倍率 100%）→ {refine}</div> : null}
                </ItemHover>
              )
            })}
        </ul>
      )
    }
    if (tab === 'modules') {
      return (
        <ul className="app-hand-list">
          {engine.modules
            .filter((mod) => ids.has(mod.id))
            .map((mod) => (
              <ModuleHover key={mod.id} as="li" mod={mod} className="app-hand-entry">
                <div className="app-inv-name">
                  <RowGlyph glyph={mod.slot} /> {mod.name}
                  <span className="app-chip is-dim">{slotName(mod.slot)}</span>
                  <span className="app-gold"> {moduleShortEffect(mod)}</span>
                </div>
                <div className="app-dim">{mod.description}</div>
              </ModuleHover>
            ))}
        </ul>
      )
    }
    if (tab === 'ships') {
      return (
        <ul className="app-hand-list">
          {engine.ships
            .filter((ship) => ids.has(ship.id))
            .map((ship) => {
              const role = ship.role ?? 'industrial'
              return (
                <ShipHover key={ship.id} as="li" ship={ship} className="app-hand-entry">
                  <div className="app-inv-name">
                    <RowGlyph glyph={role} /> {ship.name}
                    <span className="app-chip is-dim">T{ship.tier}</span>
                    <span className={`app-chip app-role-chip is-${role}`}>{roleName(role)}</span>
                    {ship.priceIsk <= 0 ? <span className="app-chip">仅可制造</span> : null}
                  </div>
                  <div className="app-dim">
                    货舱 {ship.cargoM3.toLocaleString('zh-CN')} m³ · 循环 {ship.cycleSeconds} 秒 × {ship.oreUnitsPerCycle} 单位 ·
                    动力 {Math.round(ship.agility * 100)}%
                  </div>
                  <div className="app-hand-sub">
                    <span className="app-combat-badges">{combatBadges(ship)}</span>
                    <span className="app-dim">（战斗数值已启用 · 悬停查看完整面板）</span>
                  </div>
                  <div className="app-hand-sub">{ship.description}</div>
                </ShipHover>
              )
            })}
        </ul>
      )
    }
    if (tab === 'blueprints') {
      return (
        <ul className="app-hand-list">
          {engine.blueprints
            .filter((bp) => ids.has(bp.id))
            .map((bp) => {
              const mats = bp.materials.map((m) => `${engine.ctx.items.get(m.itemId)?.name ?? m.itemId}×${m.count}`).join(' + ')
              const isAmmo = bp.itemId !== undefined
              const product = isAmmo
                ? `${engine.ctx.items.get(bp.itemId!)?.name ?? bp.itemId!}（弹药）`
                : `${engine.ctx.modules.get(bp.moduleId!)?.name ?? bp.moduleId!}（装备）`
              return (
                <InfoHover
                  key={bp.id}
                  as="li"
                  title={bp.name}
                  lines={[
                    { k: '产物', v: product },
                    { k: '材料需求', v: mats },
                    { k: '制造', v: `${(bp.buildSeconds / 60).toFixed(0)} 分 · 免费` },
                  ]}
                  note={bp.description}
                  className="app-hand-entry"
                >
                  <div className="app-inv-name">
                    <RowGlyph glyph="blueprint" /> {bp.name}
                  </div>
                  <div className="app-dim">产物：{product}</div>
                  <div className="app-hand-sub">
                    材料 {mats} · 耗时 {(bp.buildSeconds / 60).toFixed(0)} 分 · 免费
                  </div>
                  <div className="app-dim">{bp.description}</div>
                </InfoHover>
              )
            })}
          {engine.shipBlueprints
            .filter((bp) => ids.has(bp.id))
            .map((bp) => {
              const mats = bp.materials.map((m) => `${engine.ctx.items.get(m.itemId)?.name ?? m.itemId}×${m.count}`).join(' + ')
              return (
                <InfoHover
                  key={bp.id}
                  as="li"
                  title={bp.name}
                  lines={[
                    { k: '产物', v: `${engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId}（舰船）` },
                    { k: '材料需求', v: mats },
                    { k: '制造', v: `${(bp.buildSeconds / 60).toFixed(0)} 分 · 免费` },
                  ]}
                  note={bp.description}
                  className="app-hand-entry"
                >
                  <div className="app-inv-name">
                    <RowGlyph glyph="blueprint" /> {bp.name}
                  </div>
                  <div className="app-dim">产物：{engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId}（舰船）</div>
                  <div className="app-hand-sub">
                    材料 {mats} · 耗时 {(bp.buildSeconds / 60).toFixed(0)} 分 · 免费
                  </div>
                  <div className="app-dim">{bp.description}</div>
                </InfoHover>
              )
            })}
        </ul>
      )
    }
    return (
      <ul className="app-hand-list">
        {engine.skills
          .filter((s) => ids.has(s.id))
          .map((s) => (
            <li key={s.id} className="app-hand-entry">
              <div className="app-inv-name">
                {s.name}
                <span className="app-chip is-dim">难度 {s.rank}</span>
              </div>
              <div className="app-dim">{plainSkillDesc(s.description)}</div>
            </li>
          ))}
      </ul>
    )
  }

  /** 说明类页面的小节渲染（分组标题 + 每条一张卡；空组隐藏）
   *  2026-09-10 船长：原平铺两列过于紧凑 → 每条词条独立成卡（词条名作卡内标题、正文另起一行） */
  function renderSects(sects: RuleSect[]): ReactNode {
    const shown = sects
      .map((s) => ({ ...s, rows: s.rows.filter(hitRow) }))
      .filter((s) => s.rows.length > 0)
    if (shown.length === 0) {
      return <div className="app-dim app-inv-empty">没有匹配「{query.trim()}」的词条——换个关键词试试。</div>
    }
    return (
      <div className="app-hand-guide">
        {shown.map((s) => (
          <div key={s.title} className="app-hand-sect">
            <div className="app-bay-title">{s.title}</div>
            <div className="app-hand-cards">
              {s.rows.map(([k, v]) => (
                <div key={k} className="app-hand-card">
                  <div className="app-hand-card-title">{k}</div>
                  <div className="app-hand-card-body">{v}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {tab === 'guide' ? (
          <div className="app-hand-sect">
            <div className="app-bay-title">小贴士</div>
            <ul className="app-hand-notes">
              {GUIDE_NOTES.filter((n) => q === '' || n.toLowerCase().includes(q)).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    )
  }

  const codexEmpty = isCodex && codexHit === 0

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-hand-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">手册 · 图鉴</span>
          <button className="app-btn is-small" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <div className="app-hand-split">
          {/* 左侧导航（2026-09-10 船长：顶部标签行改侧边导航） */}
          <nav className="app-hand-nav">
            {NAV.map((t) => (
              <button
                key={t.key}
                className={`app-hand-navitem${tab === t.key ? ' is-active' : ''}`}
                onClick={() => changeTab(t.key)}
              >
                <span>{t.label}</span>
                <span className="app-dim">{navCount(t.key)}</span>
              </button>
            ))}
          </nav>
          <div className="app-hand-main">
            <div className="app-hand-topbar">
              <input
                className="app-head-search"
                type="search"
                placeholder={SEARCH_PLACEHOLDER[tab]}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {isCodex ? (
                <div className="app-hand-viewbar">
                  <button className={`app-hand-viewbtn${view === 'grid' ? ' is-active' : ''}`} onClick={() => changeView('grid')}>
                    图标
                  </button>
                  <button className={`app-hand-viewbtn${view === 'list' ? ' is-active' : ''}`} onClick={() => changeView('list')}>
                    列表
                  </button>
                </div>
              ) : null}
              <span className="app-dim">{countText()}</span>
            </div>
            <div className="app-hand-scroll">
              {tab === 'guide' ? renderSects(GUIDE_GROUPS) : null}
              {tab === 'rules' ? renderSects(RULE_SECTS) : null}
              {isCodex ? (
                codexEmpty ? (
                  <div className="app-dim app-inv-empty">
                    没有匹配「{query.trim()}」的条目——试试清空搜索或换个关键词。
                  </div>
                ) : (
                  groups.map((g) => (
                    <GroupSection key={g.key} label={g.label} unit={COUNT_UNIT[tab]} count={g.cells.length}>
                      {view === 'grid' ? (
                        <IconGrid cells={g.cells} onPick={setDetail} />
                      ) : (
                        renderList(g)
                      )}
                    </GroupSection>
                  ))
                )
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {detail !== null ? <CellDetail engine={engine} cell={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  )
}
