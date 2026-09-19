/**
 * 手册 / 图鉴（2026-09-10 船长改版：顶部标签页 → 左侧导航栏；图鉴按类型分组，样式照仓库；加搜索栏）。
 *
 * - 弹层加宽为双栏大窗（左导航 168px + 右内容），导航 7 项：玩法速览 / 航行须知 / 物品 / 装备 / 舰船 / 蓝图 / 技能速查；
 * - 图鉴按类型分组：分组表与市场页「类型子分类」同源（见 ui/itemSubs.ts），每组 = 仓库同款小节
 *   （分类名 + 数量 + 卡片网格），空组隐藏；
 * - 内容区顶栏：搜索 + 图标/列表切换 + 命中计数；搜索按名称/分类/说明过滤（玩法速览与航行须知按词条过滤），
 *   **只过滤当前显示的那一页，但关键词跨页保留**（2026-09-17 船长；关掉手册再打开即清空）；
 * - 数据页支持「图标网格 / 列表」两种视图（默认网格，偏好存 localStorage）；
 * - 图标为统一科幻线性 SVG（Glyphs.tsx），按内容体系映射并带分类色调；
 * - 网格模式下点击卡片 → 弹出详情窗（完整字段）；点击窗口外任意位置关闭；列表视图保留完整字段。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { ITEM_KIND_LABELS, ITEM_KIND_ORDER, itemKindText, rackOf, SHIP_ROLE_LABELS, SLOT_LABELS, shipCategoryKeyOf, shipSizeLabel, visibleItemDefs } from '@whale/core'
import type { DroneClass, ItemKind, ShipRole } from '@whale/core'
// 图鉴 →「↖ 查看市场」的条目→商品映射（2026-09-14 船长）：单点在 `ui/marketJump.ts`
// （独立小模块的原因：体检要跨层调它，而本文件 import 了 `@whale/ui`、node 侧加载不了 CSS）
import { handMarketKeyOf } from '../ui/marketJump'
import { Panel } from '@whale/ui'
import type { GameEngine } from '../game/engine'
import { Glyph, toneOf } from '../ui/Glyphs'
import { BLUEPRINT_SUBS, MODULE_SUBS, RACK_SUBS, SHIP_SUBS, SHIP_TIER_SUBS, SUB_ALL, moduleSubKeyOf } from '../ui/itemSubs'
import type { SubOption } from '../ui/itemSubs'
import { RowGlyph } from '../ui/itemView'
import { combatBadges, InfoHover, itemCombatLines, itemInfoLines, ItemHover, ModuleHover, moduleInfoLines, moduleShortEffect, ShipHover, shipIndirectLines, shipInfoLines } from '../ui/shipInfo'
import { plainSkillDesc } from '../ui/skillText'
import { tr } from '../i18n/locale'

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
  { key: 'skills', label: tr("ui.Handbook.124") },
]
/** 各页搜索框占位词（按当前页给出，玩家一眼知道搜的是哪一页） */
const SEARCH_PLACEHOLDER: Record<Tab, string> = {
  guide: tr("ui.Handbook.125"),
  rules: tr("ui.Handbook.126"),
  items: tr("ui.Handbook.127"),
  modules: tr("ui.Handbook.128"),
  ships: tr("ui.Handbook.129"),
  blueprints: tr("ui.Handbook.130"),
  skills: tr("ui.Handbook.131"),
}
/** 分组计数量词（与仓库「N 种」同款） */
const COUNT_UNIT: Record<Tab, string> = {
  guide: '条',
  rules: '条',
  items: '种',
  modules: tr("ui.MarketPage.117"),
  ships: tr("ui.MarketPage.116"),
  blueprints: tr("ui.Handbook.017"),
  skills: '项',
}
const VIEW_KEY = 'whale-idle:handbook-view'

/** 蓝图门类（手册「蓝图图鉴」主筛选）：判据与分组键同源（有 `shipId` = 舰船蓝图、
 *  有 `itemId` = 消耗品蓝图、其余 = 装备蓝图） */
const BP_MAIN: SubOption[] = [
  { key: 'equip', label: tr("ui.ShipPage.115") },
  { key: 'ship', label: tr("ui.ShipPage.116") },
  { key: 'consume', label: tr("ui.ShipPage.114") },
]
/** 各图鉴筛选行的灰字前缀（同「我的舰队」那套「类别：」「级别：」写法，避免多个「全部」混淆） */
const FILTER_LABEL: Record<Tab, string> = {
  guide: '',
  rules: '',
  items: tr("ui.Handbook.003"),
  modules: '槽类',
  ships: '类别',
  blueprints: '门类',
  skills: tr("ui.Handbook.132"),
}

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/* ═══════════ 玩法速览 / 航行须知（2026-09-14 船长：按词条分页 + 正文拆段；见 docs/design/handbook-subnav-20260914.md） ═══════════
   一条解释 = 一个子页：标题 + 2~4 段，每段一行短小标题（小标题为空串 ⇒ 该段是引导句、不加标题）。
   ⚠ 本批**只做"拆段 + 加段首小标题"**：原句与全部数值一字未改（有一次性脚本逐条比对"去标点后逐字相同"）。 */

interface HandEntry {
  title: string
  /** 段落：`[小标题, 正文]` */
  paras: Array<[string, string]>
}

interface HandGroup {
  title: string
  entries: HandEntry[]
}

/** 一条词条的命中段数（`0` = 未命中，子栏置灰；搜索作用于**整章**，跨子页）。
 *  标题命中即整条算命中（返回全部段数，免得只因为标题命中就显示成 0）。 */
function handEntryHits(e: HandEntry, q: string): number {
  if (q === '') return 1
  if (e.title.toLowerCase().includes(q)) return e.paras.length
  return e.paras.filter(([, t]) => t.toLowerCase().includes(q)).length
}

const GUIDE_GROUPS: HandGroup[] = [
  {
    title: '生产循环',
    entries: [
      {
        title: '采矿',
        paras: [
          [tr("ui.Handbook.018"), tr("ui.Handbook.133")],
          [tr("ui.Handbook.019"), '练「采矿技术 / 采集器入门学」提产量、缩循环；「自动循环」与 AI 副船让矿机不停转。'],
        ],
      },
      {
        title: '装卸',
        paras: [
          ['自动卸货', tr("ui.Handbook.020")],
          [tr("ui.Handbook.021"), '货仓页也可手动卸货——空闲停靠的非驾驶船同样可以。出售仍只对当前驾驶船开放。'],
        ],
      },
      {
        title: '精炼',
        paras: [
          [tr("ui.Handbook.018"), tr("ui.Handbook.134")],
          ['用途', tr("ui.Handbook.135")],
          ['炉位', '炉位：主控亲自运转限 1 台（占主控工作位），每枚 AI 核心各驱动一台——AI 核心启用数受上限约束，细则见「AI 副船」。'],
          ['用料', tr("ui.Handbook.136")],
        ],
      },
      {
        title: tr("ui.Handbook.022"),
        paras: [
          [tr("ui.Handbook.023"), tr("ui.Handbook.137")],
          [tr("ui.Handbook.024"), tr("ui.Handbook.138")],
          [tr("ui.Handbook.025"), tr("ui.Handbook.026")],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.027"),
    entries: [
      {
        title: '远征讨伐',
        paras: [
          [tr("ui.Handbook.018"), tr("ui.Handbook.139")],
          [tr("ui.Handbook.028"), tr("ui.Handbook.140")],
          ['路程', tr("ui.Handbook.141")],
        ],
      },
      {
        title: tr("ui.App.003"),
        paras: [
          ['槽位与退回', '装备库里的模块装到高 / 中 / 低槽位（布局见船卡；受 CPU 约束），卸下自动退回装备库。'],
          [tr("ui.Handbook.029"), tr("ui.Handbook.142")],
          [tr("ui.Handbook.030"), '装配 CPU 预算是唯一硬约束（全部位合计 ≤ 船体 CPU；无人机放飞共用同一份预算）——低槽「协处理器」可为预算扩容（本件自身不占 CPU，卸下即收回：卸到超载会被拒绝，避免"装扩容件塞满再卸掉"套利）。'],
          [tr("ui.Handbook.031"), tr("ui.Handbook.032")],
          [tr("ui.Handbook.004"), tr("ui.Handbook.143")],
          ['机群战损', tr("ui.Handbook.144")],
        ],
      },
      {
        title: '耐久与维修',
        paras: [
          [tr("ui.Handbook.033"), tr("ui.Handbook.145")],
          [tr("ui.Handbook.034"), tr("ui.Handbook.146")],
          [tr("ui.Handbook.035"), tr("ui.Handbook.147")],
        ],
      },
    ],
  },
  {
    title: '残骸与回收',
    entries: [
      {
        title: tr("ui.Handbook.036"),
        paras: [
          [tr("ui.Handbook.018"), '驾驶船高槽装打捞器（无伤害件，升级只减周期）后，在星图「残骸打捞」选星系开捞：自动循环作业，满舱自动返航卸货后自动续捞（勾「本次返航卸货后停止」可做单趟）。'],
          [tr("ui.Handbook.037"), tr("ui.Handbook.038")],
        ],
      },
      {
        title: tr("ui.Handbook.039"),
        paras: [
          [tr("ui.Handbook.040"), tr("ui.Handbook.148")],
          [tr("ui.MapPage.058"), tr("ui.Handbook.149")],
          [tr("ui.Handbook.150"), '星图「残骸打捞」页会先标出该星系的这些内容。'],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.041"),
    entries: [
      {
        title: tr("ui.Handbook.042"),
        paras: [
          [tr("ui.Handbook.018"), '练「AI 核心操作学」（入门向）+ 买基础 AI 核心，可给闲置舰船指派自动采矿 / 打捞 / 掩护巡逻任务——核心效率越高越快。'],
          [tr("ui.Handbook.043"), tr("ui.Handbook.151")],
          [tr("ui.Handbook.044"), '舰船页「AI 指挥中心」可统一指派与取消这些作业。'],
        ],
      },
      {
        title: tr("ui.Handbook.045"),
        paras: [
          [tr("ui.Handbook.046"), tr("ui.Handbook.152")],
          ['返航落点', '采矿 / 打捞自动返航、悬赏的胜利返航都会停到最近已建成的站；手动召回仍回母港（星系扫描自 2026-09-15 起是无人扫描艇，不再牵动舰船与停靠）。'],
          [tr("ui.Handbook.047"), '未建成的工地不提供停靠与任何站内功能：人在现场可提交建材，或停靠空间站后一键「前往工地交付」——每趟装满货仓出航，到点清仓自动交付，并自动往返续运直到建站完成或仓库建材耗尽（途中可随时取消）。'],
        ],
      },
      {
        title: tr("ui.MapPage.006"),
        paras: [
          ['解锁', tr("ui.Handbook.153")],
          [tr("ui.Handbook.048"), '选一条两站航线即可开始自动往返货运——虚拟货物占满货仓（不影响真实货物），每段按货仓容量 × 航程结算报酬，到站自动续下一段。'],
          [tr("ui.Handbook.049"), '随时「停止运输」会立即返港停靠，无惩罚。'],
        ],
      },
      {
        title: tr("ui.Handbook.050"),
        paras: [
          [tr("ui.Handbook.051"), '深空工业协会是星域唯一的官方力量，舰船分部门出品：鲸盟（采矿工船）、掠食者（武装舰）、甲壳（装甲舰）、蜃楼（航运货舰）。'],
          [tr("ui.Handbook.052"), '舰船按舰体尺寸分五档：护卫舰、驱逐舰、巡洋舰、战列舰、旗舰——档位越高舰体越强，价格与协会声望门槛随之抬高。'],
          [tr("ui.Handbook.053"), tr("ui.Handbook.154")],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.054"),
    entries: [
      {
        title: tr("ui.App.033"),
        paras: [
          [tr("ui.Handbook.055"), tr("ui.Handbook.155")],
          [tr("ui.Handbook.156"), tr("ui.Handbook.157")],
        ],
      },
      {
        title: '随机事件',
        paras: [
          ['节奏', '深空偶发奇遇与市场风云：约 10~30 分钟一件，事件日志带 ✦，在线时弹小卡。'],
        ],
      },
    ],
  },
  {
    title: tr("ui.MatterTechTab.001"),
    entries: [
      {
        title: tr("ui.Handbook.056"),
        paras: [
          [tr("ui.Handbook.057"), tr("ui.Handbook.158")],
          [tr("ui.Handbook.058"), '进度满即发现一处虫洞存入库存，最多同时囤 5 处（「星图记录学」满级再 +10 ⇒ 15 处）；每处锁定一个敌族、从第 1 层开始探索，进入即消耗该处——'],
          [tr("ui.Handbook.059"), tr("ui.Handbook.060")],
        ],
      },
      {
        title: '编队与质量',
        paras: [
          ['编队', '最多带 4 艘船，旗舰过重进不去（会压塌虫洞入口）。'],
          [tr("ui.Handbook.159"), tr("ui.Handbook.160")],
          [tr("ui.Handbook.061"), '编队总质量越高、可探索的回合数越少——4 艘护卫舰 93 回合，4 艘巡洋舰 53 回合。'],
        ],
      },
      {
        title: tr("ui.Handbook.161"),
        paras: [
          [tr("ui.Handbook.162"), '洞内按节点推进（舰船信号 / 墓场与遗迹 / 矿脉 / 谜质 / 漂浮信标）：每层要走到下潜点并打赢层末守卫，才能继续深入。'],
          [tr("ui.Handbook.163"), '随时可以撤离，不消耗回合、不会触发战斗：货仓、货柜与随行战利品一起入港；交火中不能撤。'],
          [tr("ui.Handbook.062"), '船被打沉，该船与它带回的货一起丢；整队失联则本趟一无所得。'],
        ],
      },
      {
        title: '货仓与产出',
        paras: [
          [tr("ui.CargoPage.004"), '货仓格数按编队合计货仓折算（每 500 m³ = 1 格），打捞到的安全货柜、图纸货柜各占固定格数。'],
          [tr("ui.Handbook.063"), '洞内只产原矿「虚空母矿」，回港在精炼炉精炼出「虚空晶」。'],
          ['深浅曲线', '每深入一层收益 ×1.2、威胁 ×1.16——收益涨得比威胁快。'],
        ],
      },
    ],
  },
]

/** 「小贴士」子页的 key（它不是词条，单独占一页） */
const TIPS_KEY = '__tips'
const GUIDE_NOTES: string[] = [
  tr("ui.Handbook.164"),
  '物品仓库与装备库是空间站资产，弃船不丢；船上的货仓与装备会随船遗失。',
  '离线最长结算 8 小时：下次启动会自动结算并弹离线简报。',
]

/* ═══════════ 航行须知（2026-09-14 船长：同「玩法速览」，按词条分页 + 正文拆段） ═══════════ */

const RULE_SECTS: HandGroup[] = [
  {
    title: tr("ui.Handbook.064"),
    entries: [
      {
        title: tr("ui.Handbook.065"),
        paras: [
          ['标色', '星图星系标色：越高越安全。'],
          [tr("ui.Handbook.066"), tr("ui.Handbook.165")],
        ],
      },
      {
        title: tr("ui.Handbook.067"),
        paras: [
          [tr("ui.Handbook.068"), tr("ui.Handbook.069")],
          [tr("ui.MapPage.006"), '长途运输途中同样会遇袭——跑运输的舰船在航段里会被当作「停在出发星系」，含低安航段的航线在「长途运输」页会标出这一条。'],
          [tr("ui.Handbook.042"), tr("ui.Handbook.070")],
        ],
      },
      {
        title: tr("ui.Handbook.166"),
        paras: [
          ['谁先挨打', tr("ui.Handbook.167")],
        ],
      },
      {
        title: '触发节奏',
        paras: [
          [tr("ui.Handbook.071"), '进入低安作业 / 驻留约 5 分钟后才可能遇袭（入场缓冲；扫描虫洞例外——它一开扫就算暴露、无缓冲）。'],
          [tr("ui.Handbook.072"), '遇袭判定与随机事件共用时机——事件到点时可能撞上巡逻 / 伏击，也可能照常出事件。'],
        ],
      },
      {
        title: tr("ui.Handbook.073"),
        paras: [
          ['横幅二选一', '遭遇会弹出「伏击待决」横幅：可「⚔ 迎战」（进入实时战斗，自动打完）或「» 快速脱离」；60 秒未处置自动脱离。'],
        ],
      },
      {
        title: '离线时',
        paras: [
          ['直接结算', '离线（含离线结算）遭遇直接文字结算，不会凭空等你去点。'],
        ],
      },
      {
        title: '结局三档',
        paras: [
          [tr("ui.Handbook.074"), tr("ui.Handbook.075")],
          [tr("ui.Handbook.076"), tr("ui.Handbook.168")],
          ['被抢', '被抢：至多 30% 船上货物（无货则抢少量钱包）。'],
        ],
      },
      {
        title: tr("ui.Handbook.169"),
        paras: [
          [tr("ui.Handbook.077"), '遭遇了结后先自动修补：装甲或结构低于 50% 时，船会自己动手补到两者约 60%，或组件用尽。前提是它装着船体维修装置（中槽件），而且只吃与装置对应的那种修理组件——民用装置吃民用修理组件，MK1 / MK2 吃军用修理组件。'],
          [tr("ui.Handbook.078"), '没装维修装置、对应组件不足、或补完后结构仍低于 50%，才收手返港待命——驾驶船停下采掘 / 打捞 / 扫描虫洞并即时返航最近已建成站，副船中止任务召回（副船结构低于 50% 需修好才能再派）。'],
        ],
      },
      {
        title: '迎战也有保险',
        paras: [
          ['轻损即退', tr("ui.Handbook.079")],
        ],
      },
    ],
  },
  {
    title: '重要规则留档',
    entries: [
      {
        title: '采矿 ↔ 远征 转场',
        paras: [
          [tr("ui.Handbook.080"), '采矿中点悬赏「⇄ 转战出发」= 结束采矿（货随船）并从矿带星系出发；远征中点矿带「⇄ 转开采」= 取消远征（无战果、讨伐同步停）并回港开采。'],
          [tr("ui.Handbook.014"), tr("ui.Handbook.081")],
        ],
      },
      {
        title: '重复清剿',
        paras: [
          [tr("ui.Handbook.018"), '空闲时可开：胜利后自动返航回港（返航路程 = 单程），冷却结束自动再出发，往复巡回。'],
          [tr("ui.Handbook.082"), '货仓装不下缴获 / 耐久低于 50% 且修理组件耗尽 / 战败都会自动暂停。'],
        ],
      },
      {
        title: tr("ui.Handbook.083"),
        paras: [
          [tr("ui.Handbook.084"), tr("ui.Handbook.085")],
        ],
      },
      {
        title: '船只锁定',
        paras: [
          ['锁什么', '锁定只防误售：驾驶、AI 执勤、维修、改名都不受影响。'],
        ],
      },
      {
        title: '重复舰船',
        paras: [
          [tr("ui.Handbook.086"), tr("ui.Handbook.170")],
          [tr("ui.ShipPage.013"), tr("ui.Handbook.171")],
        ],
      },
      {
        title: '货仓与出售',
        paras: [
          [tr("ui.Handbook.087"), tr("ui.Handbook.088")],
          ['谁能卖', tr("ui.Handbook.172")],
        ],
      },
      {
        title: '星系扫描',
        paras: [
          [tr("ui.Handbook.057"), '星图上对「未知信号」（剪影星系）派出一艘无人深空扫描艇：窗口走完即点亮该星系，航线、矿带与悬赏情报全部解锁。窗口基准约 10 分钟，越危险的星系扫得越久；母港（起始星系）例外，十来秒就能扫完。'],
          [tr("ui.Handbook.089"), tr("ui.Handbook.173")],
          ['看进度', '进度在顶部活动窗 AI 徽标右侧那条扫描条上；扫完后条子会一直亮着，进「星图」看过才收起。'],
        ],
      },
      {
        title: '离线结算',
        paras: [
          [tr("ui.Handbook.090"), '离线最长结算 8 小时，重启自动结算并弹离线简报。'],
        ],
      },
    ],
  },
  {
    title: tr("ui.Handbook.091"),
    entries: [
      {
        title: '血条三层',
        paras: [
          [tr("ui.Handbook.092"), '每艘船血量分 护盾 → 装甲 → 结构 三层依次承受（破层溢出向下渗透）。'],
        ],
      },
      {
        title: tr("ui.Handbook.093"),
        paras: [
          [tr("ui.BattleScreen.002"), tr("ui.Handbook.174")],
          [tr("ui.battleViewCore.001"), '爆破弹药（导弹架）：盾 ×0.5 / 甲 ×1.5 / 结构 ×1（专职破甲）。'],
          [tr("ui.battleViewCore.002"), '能量弹药（激光炮）：盾 ×1.25 / 甲 ×1 / 结构 ×1（拆盾也强、无弱点）。'],
          ['界面提示', tr("ui.Handbook.175")],
        ],
      },
      {
        title: tr("ui.Handbook.176"),
        paras: [
          ['递减合成', tr("ui.Handbook.177")],
          [tr("ui.Handbook.094"), '每层受到的伤害 = 层伤害 × 克制倍率 ×（1 − 该层对应系抗性）——配装时看敌方主伤害类型，选对应层抗与弹种。'],
        ],
      },
    ],
  },
  {
    title: tr("ui.MatterTechTab.001"),
    entries: [
      {
        title: '进洞与离开',
        paras: [
          [tr("ui.Handbook.095"), '进洞占主控一个活动：探索期间采矿 / 扫描虫洞 / 打捞 / 远征 / 长途运输都开不了，进洞时会自动停掉正在进行的作业（星系扫描是另一条无人扫描艇，不受影响）。'],
          [tr("ui.Handbook.096"), tr("ui.Handbook.097")],
        ],
      },
      {
        title: tr("ui.Handbook.098"),
        paras: [
          [tr("ui.Handbook.099"), tr("ui.Handbook.178")],
          ['途中被拦', '点一个地点前往时，若两点连线上挡着一处还没清掉的敌人，舰船会在半路被拦下并就地开战：这次移动的 1 回合照扣、不额外扣回合，位置停在被拦的那一格，打完再由玩家决定往哪走——绕开或先清掉挡路的敌人，都可以避免被拦。'],
          ['踩中埋伏', '走进一个还没扫描过的地点、里面正好是敌人时，舰船会被对方发现：先出提示，玩家确认后才进入战斗（这一场躲不掉，打完才能继续探索）。'],
          [tr("ui.Handbook.062"), '船被打沉：该船与它带回的货一起丢失；整队失联＝本趟没有产出。'],
        ],
      },
      {
        title: tr("ui.Handbook.100"),
        paras: [
          ['用途', '货仓右侧的备用格区（4×8 = 32 格），用来腾位置或暂存待丢的东西。'],
          ['规则', '里面有东西时不能进行其他操作，离开货仓页前必须放回货仓或丢掉。'],
        ],
      },
      {
        title: '谜质储存器',
        paras: [
          [tr("ui.Handbook.101"), '洞内采到的谜质储存器在货仓里占 2×2 格。'],
          [tr("ui.Handbook.179"), '本趟虫洞内生效、离开即消失；拖进临时空间就会失效。'],
        ],
      },
    ],
  },
  {
    title: '目标档案',
    entries: [
      {
        title: tr("ui.Handbook.102"),
        paras: [
          [tr("ui.Handbook.103"), tr("ui.Handbook.104")],
          ['线索', '目前没有任何可执行线索，完成方法未知。'],
          [tr("ui.Handbook.180"), tr("ui.Handbook.105")],
        ],
      },
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

/** 详情窗用：把当前表格单元喂给 {@link handMarketKeyOf}（映射单点在 `ui/marketJump.ts`，
 *  体检那条跨层契约也读同一个函数——**不许在这里另写一份映射**） */
function marketKeyOf(engine: GameEngine, cell: GridCell): string | null {
  return handMarketKeyOf(engine.ctx, cell.tab, cell.key)
}

/** 详情内容（按页签/数据类型给出完整字段） */
function DetailBody({ engine, cell }: { engine: GameEngine; cell: GridCell }) {
  const r = cell.raw
  const rows: Array<[string, ReactNode]> = []

  if (cell.tab === 'items') {
    const kind = String(r.kind ?? '')
    // 2026-09-10 船长：无人机把归类子属性并入「种类」（无人机 · 侦察机）——走 core 单点
    rows.push([
      tr("ui.Handbook.005"),
      itemKindText({ kind: kind as ItemKind, droneClass: r.droneClass as DroneClass | undefined }),
    ])
    rows.push([tr("ui.Handbook.006"), `${Number(r.unitM3 ?? 0)} m³`])
    // V10.5：弹药/无人机补充伤害契约（与其它界面统一由 shipInfo 生成）
    const itemId = String(r.id ?? '')
    const itemDef = itemId ? engine.ctx.items.get(itemId) : undefined
    if (itemDef && (itemDef.kind === 'ammo' || itemDef.kind === 'drone')) {
      for (const line of itemCombatLines(itemDef)) rows.push([line.k, line.v])
    }
    const refine = (r.refine as Array<{ mineralId: string; perOre: number }> | undefined) ?? []
    if (refine.length > 0) {
      rows.push([
        tr("ui.Handbook.007"),
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
      rows.push([tr("ui.Handbook.008"), tr("ui.Handbook.106", { p1: slotName(String(r.slot ?? '')), p2: Math.round(Number(r.bonus ?? 0) * 100) })])
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
      rows.push([tr("ui.Handbook.002"), tr("ui.Handbook.181")])
      rows.push(['获取方式', Number(r.priceIsk ?? 0) <= 0 ? tr("ui.Handbook.107") : tr("ui.Handbook.108")])
    } else {
      const cls = shipCategoryKeyOf(r as unknown as { role?: ShipRole; shieldHp?: number; armorHp?: number })
      rows.push([tr("ui.Handbook.009"), `${roleName(cls)} · ${shipSizeLabel(Number(r.tier ?? 0))} T${Number(r.tier ?? 0)}`])
      rows.push([tr("ui.Handbook.010"), `${Number(r.cargoM3 ?? 0).toLocaleString('zh-CN')} m³`])
      rows.push([tr("ui.Handbook.011"), tr("ui.shipInfo.130", { p1: Number(r.cycleSeconds ?? 0), p2: Number(r.oreUnitsPerCycle ?? 0) })])
      rows.push([tr("ui.Handbook.012"), `${Math.round(Number(r.agility ?? 0) * 100)}%`])
      if (Number(r.priceIsk ?? 0) <= 0) rows.push(['获取方式', tr("ui.Handbook.107")])
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
      productName = tr("ui.Handbook.109", { p1: itemDef?.name ?? itemId })
      if (itemDef) {
        for (const l of itemInfoLines(itemDef, (id) => engine.ctx.items.get(id)?.name)) prodRows.push([l.k, l.v])
        if (itemDef.description) prodRows.push([tr("ui.Handbook.110"), itemDef.description])
      }
    } else if (moduleId !== undefined) {
      const modDef = engine.ctx.modules.get(moduleId)
      productName = tr("ui.Handbook.111", { p1: modDef?.name ?? moduleId })
      if (modDef) {
        // V17：统一行——各家族真实进公式参数（工业加成 / 武器卡 / 容量+缺口抗性 / 加力推进）
        for (const l of moduleInfoLines(modDef)) prodRows.push([l.k, l.v])
        if (modDef.description) prodRows.push([tr("ui.Handbook.110"), modDef.description])
      }
    } else {
      const shipDef = engine.ctx.ships.get(shipId ?? '')
      productName = tr("ui.Handbook.112", { p1: shipDef?.name ?? shipId ?? '' })
      if (shipDef) {
        // V10.5：统一行（定位/货舱/采集/动力 + 盾甲结构抗性与槽位）；V17 战斗数值已生效
        for (const l of shipInfoLines(shipDef)) prodRows.push([l.k, l.v])
        // 2026-09-12 船长：舰船蓝图详情同样可见间接属性（与图鉴·舰船分支同口径）
        for (const l of shipIndirectLines(shipDef)) prodRows.push([l.k, l.v])
        if (shipDef.description) prodRows.push([tr("ui.Handbook.110"), shipDef.description])
      }
    }
    rows.push([tr("ui.MarketPage.016"), productName])
    for (const [k, v] of prodRows) rows.push([k, v])
    rows.push([
      tr("ui.MarketPage.018"),
      <span key="mats" className="app-detail-mats">
        {materials.map((m) => (
          <span key={m.itemId} className="app-detail-mat">
            {engine.ctx.items.get(m.itemId)?.name ?? m.itemId} ×{m.count.toLocaleString('zh-CN')}
          </span>
        ))}
      </span>,
    ])
    rows.push(['耗时', `约 ${Math.round(Number(r.buildSeconds ?? 0) / 60)} 分钟（受工业理论缩短）`])
  } else if (cell.tab === 'skills') {
    rows.push([tr("ui.Handbook.132"), String(r.group ?? '')])
    rows.push(['训练难度', tr("ui.Handbook.113", { p1: Number(r.rank ?? 0) })])
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
  onGotoMarket,
}: {
  engine: GameEngine
  cell: GridCell
  onClose: () => void
  /** 图鉴 → 市场（2026-09-14 船长）：传该条目在市场的商品键；**缺省 = 不渲染按钮**（无入口时也不假装能跳） */
  onGotoMarket?: (goodKey: string) => void
}) {
  const tone = toneOf(cell.glyph)
  const marketKey = onGotoMarket ? marketKeyOf(engine, cell) : null
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
          {/* 「↖ 查看市场」：只跳转、不下单（与舰船页/物品页/货舱页/组装机同一个 `onGotoMarket` 入口）
              —— 到市场页会自动搜到该商品并展开它的行情详情。⚠ 点它**同时关掉手册**：
              手册是覆盖层，不关就会盖在刚切过去的市场页上面、聚焦也看不见。 */}
          {marketKey !== null && onGotoMarket ? (
            <button
              className="app-btn is-small app-detail-goto"
              title={tr("ui.CargoPage.003")}
              onClick={() => {
                onClose()
                onGotoMarket(marketKey)
              }}
            >
              {tr("ui.CargoPage.001")}
            </button>
          ) : null}
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

export function Handbook({
  engine,
  onClose,
  onGotoMarket,
}: {
  engine: GameEngine
  onClose: () => void
  /** 图鉴条目 → 市场（2026-09-14 船长）；由 App 透传与舰船页/物品页/工业页同一个入口 */
  onGotoMarket?: (goodKey: string) => void
}) {
  const [tab, setTab] = useState<Tab>('guide')
  const [view, setView] = useState<ViewMode>(readView)
  const [detail, setDetail] = useState<GridCell | null>(null)
  const [query, setQuery] = useState('')
  /* 图鉴筛选（2026-09-13 船长）：一级 `mainKey`，二级 `subKey`；都**不落盘**——关上手册再打开即重置
     （与市场「切类型即回全部子类」同一哲学）。`SUB_ALL` = 全部 / 全部子类。 */
  const [mainKey, setMainKey] = useState<string>(SUB_ALL)
  const [subKey, setSubKey] = useState<string>(SUB_ALL)
  /** 说明类（玩法速览 / 航行须知）当前停留的**子页**（= 词条标题；空串 = 默认第一条，`TIPS_KEY` = 小贴士页） */
  const [pageKey, setPageKey] = useState<string>('')

  function changeView(v: ViewMode): void {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // 本地存储不可用：忽略
    }
  }
  /**
   * 切页：清空**详情与筛选**；**关键词保留**（2026-09-17 船长：「**手册里进行搜索后，切换导航页搜索会重置**」）。
   *
   * 口径（当日两答）：① **关键词跨页保留**——搜索框里的词切页后原样留着，并作用于新页
   * （新页没命中就显示「没有匹配…」提示，导航计数也按该页命中数显示）；② **关掉手册再打开即清空**
   * （不落 localStorage，与筛选同哲学）。筛选（一级/二级/子页）仍按 2026-09-13 的裁定**切页归零**
   * （「与市场『切类型即回全部子类』同一哲学」）。
   *
   * ⚠ 原先这里还带一句 `setQuery('')`（原注释："各页关键词互不相关，避免换了页却没结果的困惑"）——
   * 那是经办人自定的口径，不是船长裁定，本日按船长指示删除。**别再往回加**（护栏 = `content:check`
   * 「手册搜索跨页保留契约」）。
   */
  function changeTab(t: Tab): void {
    setTab(t)
    setDetail(null)
    setMainKey(SUB_ALL)
    setSubKey(SUB_ALL)
    setPageKey('')
  }
  /** 选一级分类：二级随之归零（与组装机「换一级标签即回全部子类」同款） */
  function pickMain(k: string): void {
    setMainKey(k)
    setSubKey(SUB_ALL)
  }

  const q = query.trim().toLowerCase()
  const hitCell = (c: GridCell): boolean =>
    q === '' ||
    c.name.toLowerCase().includes(q) ||
    c.sub.toLowerCase().includes(q) ||
    String(c.raw.description ?? '').toLowerCase().includes(q)
  /* 说明类（玩法速览 / 航行须知）：搜索作用于**整章**（跨子页命中，见 handEntryHits）。
     `cur` 是当前该显示的**一页**：玩家点的子页；点的那条被关键词滤掉时自动落到第一条命中的（搜索即跳页）。 */
  const sects: HandGroup[] = tab === 'guide' ? GUIDE_GROUPS : tab === 'rules' ? RULE_SECTS : []
  const flat = sects.flatMap((g) => g.entries.map((e) => ({ g, e })))
  const matched = flat.filter((x) => handEntryHits(x.e, q) > 0)
  const onTips = tab === 'guide' && pageKey === TIPS_KEY
  const cur = onTips ? null : (matched.find((x) => x.e.title === pageKey) ?? matched[0] ?? null)
  /* 翻页序列（2026-09-14 船长追加：页底「上一条 / 下一条」）：按当前章的**阅读顺序**连续走，跨组不打断；
     搜索时只在命中项之间走（与"搜索即跳页"同一套口径）。「小贴士」排在「玩法速览」最后一条之后。 */
  const tipsHit = q === '' || GUIDE_NOTES.some((n) => n.toLowerCase().includes(q))
  const pageSeq: Array<{ key: string; label: string }> = [
    ...matched.map((x) => ({ key: x.e.title, label: x.e.title })),
    ...(tab === 'guide' && tipsHit ? [{ key: TIPS_KEY, label: tr("ui.Handbook.114") }] : []),
  ]
  const pageIdx = pageSeq.findIndex((p) => p.key === (onTips ? TIPS_KEY : (cur?.e.title ?? '')))
  const prevPage = pageIdx > 0 ? pageSeq[pageIdx - 1]! : null
  const nextPage = pageIdx >= 0 && pageIdx < pageSeq.length - 1 ? pageSeq[pageIdx + 1]! : null

  /* ── 网格单元（glyph 名即色调键；raw 带完整数据供详情窗） ──
   *  ⚠ 物品图鉴走**玩家可见目录**（`visibleItemDefs`）：未上线物品（标 `ItemDef.unreleased`）
   *  不进图鉴——首版直接遍历 `engine.items` 全目录，未上线矿会连名字带描述一起被搜出来（2026-09-13 实测）。 */
  const itemCells: GridCell[] = visibleItemDefs(engine.ctx).map((item) => ({
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
    // 2026-09-16 船长：类别键走 `shipCategoryKeyOf` —— 装甲线 = `role: 'armored'` **或**武装舰里装甲占比 > 护盾占比
    // （牛鲨级突击巡洋舰 + E 族专属舰；丙案「只在武装舰里判」）。图标/文字/分组/筛选四处同源这一处。
    const cls = shipCategoryKeyOf(ship)
    return {
      key: ship.id,
      tab: 'ships',
      glyph: cls,
      name: ship.name,
      sub: `${roleName(cls)} · ${shipSizeLabel(ship.tier)} T${ship.tier} · ${ship.cargoM3.toLocaleString('zh-CN')} m³`,
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
    sub: tr("ui.Handbook.115", { p1: s.group, p2: s.rank }),
    raw: s as unknown as RawData,
  }))

  /* ── 分组（顺序表与市场页类型子分类同源；空组隐藏） ── */
  const filtered = (cells: GridCell[]): GridCell[] => cells.filter(hitCell)
  const showCells = (cells: GridCell[], t: Tab): CellGroup[] => groupCells(cells, groupKeyOf, orderOf(t))
  /** 分组键：物品按大类 / 装备按槽类 / 舰船按舰族 / 蓝图按产物门类（装备蓝图再按产物槽类） / 技能按技能组 */
  function groupKeyOf(c: GridCell): string {
    if (c.tab === 'items') return String(c.raw.kind ?? '')
    if (c.tab === 'modules') return moduleSubKeyOf(String(c.raw.slot ?? ''))
    if (c.tab === 'ships') return String(c.glyph) // 舰船类别键（`shipCategoryKeyOf` 的产物；见 shipCells）
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
    if (t === 'modules') return MODULE_SUBS.map((s) => ({ key: s.key, label: s.label })).concat([{ key: '', label: tr("ui.Handbook.116") }])
    if (t === 'ships') return SHIP_SUBS.map((s) => ({ key: s.key, label: s.label }))
    if (t === 'blueprints') return BLUEPRINT_SUBS.map((s) => ({ key: s.key, label: s.label })).concat([{ key: '', label: tr("ui.Handbook.116") }])
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

  /* ── 图鉴筛选（2026-09-13 船长：「对手册中的各个图鉴添加筛选，如果有子分类的，主筛选选择之后出现子分类筛选」；
        集中提问后定：**只做一级的页签 = 物品 / 技能**（无天然第二层），二级只在装备 / 舰船 / 蓝图三页；
        控件复用组装机那一套 `app-task-tabs` + `app-tasktab` 胶囊；与搜索取「与」 ── */

  /** 主筛选（一级）可选项——与各页的**分组键同一套判据**：装备＝槽类、舰船＝角色、蓝图＝门类 */
  function mainOptions(t: Tab): SubOption[] {
    if (t === 'items') return ITEM_KIND_ORDER.map((k) => ({ key: k, label: kindName(k) }))
    if (t === 'modules') return RACK_SUBS
    if (t === 'ships') return SHIP_SUBS
    if (t === 'blueprints') return BP_MAIN
    if (t === 'skills') return engine.groups.map((g) => ({ key: g, label: g }))
    return []
  }
  /** 子筛选（二级）可选项——**只有装备 / 舰船 / 蓝图三页有**，且**必须选了主类才出现**
   *  （「全部」不带子筛选，与组装机「全部标签不带子筛选」同款；2026-09-13 船长口径：
   *  「如果有子分类的，主筛选选择之后出现子分类筛选」）；
   *  蓝图的子级随所选门类变化（装备→槽类 / 舰船→级别 / 消耗品→无，与市场页 `BLUEPRINT_SUBS` 同表同键） */
  function subOptions(t: Tab, main: string): SubOption[] {
    if (main === SUB_ALL) return []
    if (t === 'modules') return MODULE_SUBS
    if (t === 'ships') return SHIP_TIER_SUBS
    if (t === 'blueprints') return main === 'equip' ? RACK_SUBS : main === 'ship' ? SHIP_TIER_SUBS : []
    return []
  }
  /** 主筛选判定（判据与 `groupKeyOf` 逐条对齐，避免"筛出来的条目和分组标题不一致"） */
  function mainPasses(c: GridCell, t: Tab, main: string): boolean {
    if (main === SUB_ALL) return true
    if (t === 'items') return String(c.raw.kind ?? '') === main
    if (t === 'modules') {
      const mod = engine.ctx.modules.get(c.key)
      return mod !== undefined && rackOf(mod) === main
    }
    if (t === 'ships') return String(c.glyph) === main // 同上：类别键（不是 raw.role）
    if (t === 'blueprints') {
      if (c.raw.shipId !== undefined) return main === 'ship'
      if (c.raw.itemId !== undefined) return main === 'consume'
      return main === 'equip'
    }
    return String(c.raw.group ?? '') === main // skills
  }
  /** 子筛选判定（物品与技能无二级，恒真） */
  function subPassesCell(c: GridCell, t: Tab, sub: string): boolean {
    if (sub === SUB_ALL) return true
    if (t === 'modules') return moduleSubKeyOf(String(c.raw.slot ?? '')) === sub
    if (t === 'ships') return `t${String(c.raw.tier ?? '')}` === sub
    if (t === 'blueprints') {
      if (c.raw.shipId !== undefined) {
        const ship = engine.ctx.ships.get(String(c.raw.shipId))
        return ship !== undefined && `t${ship.tier}` === sub
      }
      const mod = engine.ctx.modules.get(String(c.raw.moduleId ?? ''))
      return mod !== undefined && rackOf(mod) === sub
    }
    return true
  }

  const mainOpts = isCodex ? mainOptions(tab) : []
  const subOpts = isCodex ? subOptions(tab, mainKey) : []
  /** 搜索或筛选任一生效（命中计数与空态文案据此切换措辞） */
  const narrowed = q !== '' || mainKey !== SUB_ALL || subKey !== SUB_ALL
  const groups: CellGroup[] = isCodex
    ? showCells(
        filtered(codexCells[tab]).filter((c) => mainPasses(c, tab, mainKey) && subPassesCell(c, tab, subKey)),
        tab,
      )
    : []
  const codexHit = isCodex ? groups.reduce((n, g) => n + g.cells.length, 0) : 0

  /** 左侧导航计数：图鉴类 = 条目数（搜索时显示命中数；**不含筛选**——筛选是当前页的临时收窄），说明类 = 词条数 */
  function navCount(t: Tab): number {
    if (t === 'guide') return GUIDE_GROUPS.reduce((n, g) => n + g.entries.filter((e) => handEntryHits(e, q) > 0).length, 0)
    if (t === 'rules') return RULE_SECTS.reduce((n, g) => n + g.entries.filter((e) => handEntryHits(e, q) > 0).length, 0)
    return codexCells[t].filter(hitCell).length
  }
  /** 当前页命中计数文案（搜索/筛选态与全量态） */
  const countText = (): string => {
    if (tab === 'guide' || tab === 'rules') {
      const n = navCount(tab)
      return q === '' ? `${n} ${COUNT_UNIT[tab]}` : tr("ui.Handbook.182", { n: n, p2: COUNT_UNIT[tab] })
    }
    return narrowed ? tr("ui.Handbook.183", { codexHit: codexHit, p2: COUNT_UNIT[tab] }) : `${codexHit} ${COUNT_UNIT[tab]}`
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
                    <span className="app-dim"> · {item.unitM3} {tr("ui.Handbook.117")}</span>
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
              const cls = shipCategoryKeyOf(ship)
              return (
                <ShipHover key={ship.id} as="li" ship={ship} className="app-hand-entry">
                  <div className="app-inv-name">
                    <RowGlyph glyph={cls} /> {ship.name}
                    <span className="app-chip is-dim">T{ship.tier}</span>
                    <span className={`app-chip app-role-chip is-${cls}`}>{roleName(cls)}</span>
                    {ship.priceIsk <= 0 ? <span className="app-chip">{tr("ui.Handbook.118")}</span> : null}
                  </div>
                  <div className="app-dim">
                    {tr("ui.ShipPage.019")} {ship.cargoM3.toLocaleString('zh-CN')} {tr("ui.ShipPage.020")} {ship.cycleSeconds} {tr("ui.ShipPage.021")} {ship.oreUnitsPerCycle} 单位 ·
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
                ? tr("ui.Handbook.109", { p1: engine.ctx.items.get(bp.itemId!)?.name ?? bp.itemId! })
                : tr("ui.Handbook.111", { p1: engine.ctx.modules.get(bp.moduleId!)?.name ?? bp.moduleId! })
              return (
                <InfoHover
                  key={bp.id}
                  as="li"
                  title={bp.name}
                  lines={[
                    { k: tr("ui.MarketPage.016"), v: product },
                    { k: tr("ui.MarketPage.018"), v: mats },
                    { k: tr("ui.MarketPage.019"), v: tr("ui.Handbook.119", { p1: (bp.buildSeconds / 60).toFixed(0) }) },
                  ]}
                  note={bp.description}
                  className="app-hand-entry"
                >
                  <div className="app-inv-name">
                    <RowGlyph glyph="blueprint" /> {bp.name}
                  </div>
                  <div className="app-dim">{tr("ui.Handbook.013")}{product}</div>
                  <div className="app-hand-sub">
                    材料 {mats} · 耗时 {(bp.buildSeconds / 60).toFixed(0)} {tr("ui.Handbook.120")}
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
                    { k: tr("ui.MarketPage.016"), v: tr("ui.Handbook.112", { p1: engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId }) },
                    { k: tr("ui.MarketPage.018"), v: mats },
                    { k: tr("ui.MarketPage.019"), v: tr("ui.Handbook.119", { p1: (bp.buildSeconds / 60).toFixed(0) }) },
                  ]}
                  note={bp.description}
                  className="app-hand-entry"
                >
                  <div className="app-inv-name">
                    <RowGlyph glyph="blueprint" /> {bp.name}
                  </div>
                  <div className="app-dim">{tr("ui.Handbook.013")}{engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId}（舰船）</div>
                  <div className="app-hand-sub">
                    材料 {mats} · 耗时 {(bp.buildSeconds / 60).toFixed(0)} {tr("ui.Handbook.120")}
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

  /** 页底翻页条（船长 2026-09-14 追加）：连着读完一章更顺；到头的那一侧留空位（保持按钮位置稳定） */
  function renderPager(): ReactNode {
    if (prevPage === null && nextPage === null) return null
    return (
      <div className="app-hand-pager">
        {prevPage !== null ? (
          <button className="app-btn is-small app-hand-pager-btn" onClick={() => setPageKey(prevPage.key)}>
            {tr("ui.Handbook.121")} {prevPage.label}
          </button>
        ) : (
          <span />
        )}
        {nextPage !== null ? (
          <button className="app-btn is-small app-hand-pager-btn" onClick={() => setPageKey(nextPage.key)}>
            {nextPage.label} · 下一条 ›
          </button>
        ) : (
          <span />
        )}
      </div>
    )
  }

  /** 说明类页面：**一条解释 = 一页**（2026-09-14 船长：按词条分页 + 正文拆段，不再挤成一整段）
   *  上面子栏（`.app-hand-subnav`）选页；正文由 `.app-hand-para`（段首小标题 + 正文）堆成；页底可翻页。 */
  function renderPage(): ReactNode {
    if (onTips) {
      return (
        <div className="app-hand-guide">
          <div className="app-hand-sect">
            <div className="app-bay-title">{tr("ui.Handbook.114")}</div>
            <ul className="app-hand-notes">
              {GUIDE_NOTES.filter((n) => q === '' || n.toLowerCase().includes(q)).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          {renderPager()}
        </div>
      )
    }
    if (cur === null) {
      return <div className="app-dim app-inv-empty">{tr("ui.SkillsPage.006")}{query.trim()}{tr("ui.Handbook.122")}</div>
    }
    return (
      <div className="app-hand-guide">
        <div className="app-hand-sect">
          <div className="app-bay-title">{cur.g.title}</div>
          <div className="app-hand-cards">
            <div className="app-hand-card">
              <div className="app-hand-card-title">{cur.e.title}</div>
              {cur.e.paras.map(([head, body]) => (
                <div key={head + body} className="app-hand-para">
                  {head !== '' ? <div className="app-hand-para-head">{head}</div> : null}
                  <div className="app-hand-card-body">{body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {renderPager()}
      </div>
    )
  }

  const codexEmpty = isCodex && codexHit === 0

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-hand-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{tr("ui.Handbook.123")}</span>
          <button className="app-btn is-small" onClick={onClose}>
            {tr("ui.App.086")}
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
          {/* 子页面导航（2026-09-14 船长：给「玩法速览 / 航行须知」的解释分页）
              组名作分组小标题、每个词条一个按钮；搜索时右侧显示该条命中段数、未命中置灰（搜索仍作用于整章）。 */}
          {tab === 'guide' || tab === 'rules' ? (
            <nav className="app-hand-subnav">
              {sects.map((g) => (
                <div key={g.title} className="app-hand-subgroup">
                  <div className="app-hand-subgroup-title">{g.title}</div>
                  {g.entries.map((e) => {
                    const hits = handEntryHits(e, q)
                    return (
                      <button
                        key={e.title}
                        className={`app-hand-subitem${cur?.e === e ? ' is-active' : ''}${hits === 0 ? ' is-dim' : ''}`}
                        onClick={() => setPageKey(e.title)}
                        title={hits === 0 ? tr("ui.Handbook.184") : undefined}
                      >
                        <span>{e.title}</span>
                        {q !== '' ? <span className="app-hand-subitem-hits">{hits}</span> : null}
                      </button>
                    )
                  })}
                </div>
              ))}
              {tab === 'guide' ? (
                <button
                  className={`app-hand-subitem app-hand-subsolo${onTips ? ' is-active' : ''}`}
                  onClick={() => setPageKey(TIPS_KEY)}
                >
                  <span>{tr("ui.Handbook.114")}</span>
                </button>
              ) : null}
            </nav>
          ) : null}
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
                    {tr("ui.Handbook.015")}
                  </button>
                  <button className={`app-hand-viewbtn${view === 'list' ? ' is-active' : ''}`} onClick={() => changeView('list')}>
                    {tr("ui.Handbook.016")}
                  </button>
                </div>
              ) : null}
              <span className="app-dim">{countText()}</span>
            </div>
            {/* 图鉴筛选（2026-09-13 船长）：一级常显；**装备 / 舰船 / 蓝图**选了主类才出二级
                （「全部」时不占位，同组装机「全部标签不带子筛选」）；固定在列表上方不随滚动 */}
            {isCodex && mainOpts.length > 0 ? (
              <div className="app-fleet-toolbar app-hand-filters">
                <div className="app-fleet-row">
                  <span className="app-dim">{FILTER_LABEL[tab]}：</span>
                  <div className="app-task-tabs app-fleet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={mainKey === SUB_ALL}
                      className={`app-tasktab${mainKey === SUB_ALL ? ' is-active' : ''}`}
                      onClick={() => pickMain(SUB_ALL)}
                    >
                      {tr("ui.IndustryPage.001")}
                    </button>
                    {mainOpts.map((o) => (
                      <button
                        key={o.key}
                        role="tab"
                        aria-selected={mainKey === o.key}
                        className={`app-tasktab${mainKey === o.key ? ' is-active' : ''}`}
                        onClick={() => pickMain(o.key)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                {subOpts.length > 0 ? (
                  <div className="app-fleet-row">
                    <span className="app-dim">细分：</span>
                    <div className="app-task-tabs app-fleet-tabs" role="tablist">
                      <button
                        role="tab"
                        aria-selected={subKey === SUB_ALL}
                        className={`app-tasktab${subKey === SUB_ALL ? ' is-active' : ''}`}
                        onClick={() => setSubKey(SUB_ALL)}
                      >
                        {tr("ui.IndustryPage.064")}
                      </button>
                      {subOpts.map((o) => (
                        <button
                          key={o.key}
                          role="tab"
                          aria-selected={subKey === o.key}
                          className={`app-tasktab${subKey === o.key ? ' is-active' : ''}`}
                          onClick={() => setSubKey(o.key)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="app-hand-scroll">
              {tab === 'guide' || tab === 'rules' ? renderPage() : null}
              {isCodex ? (
                codexEmpty ? (
                  <div className="app-dim app-inv-empty">
                    {q !== ''
                      ? `没有匹配「${query.trim()}」的条目——试试清空搜索或换个关键词。`
                      : tr("ui.Handbook.185")}
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
      {detail !== null ? (
        <CellDetail engine={engine} cell={detail} onClose={() => setDetail(null)} onGotoMarket={onGotoMarket} />
      ) : null}
    </div>
  )
}
