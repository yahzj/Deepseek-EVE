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
import { ITEM_KIND_LABELS, ITEM_KIND_ORDER, itemKindText, rackOf, SHIP_ROLE_LABELS, SLOT_LABELS, shipSizeLabel, visibleItemDefs } from '@whale/core'
import type { DroneClass, ItemKind } from '@whale/core'
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

/** 蓝图门类（手册「蓝图图鉴」主筛选）：判据与分组键同源（有 `shipId` = 舰船蓝图、
 *  有 `itemId` = 消耗品蓝图、其余 = 装备蓝图） */
const BP_MAIN: SubOption[] = [
  { key: 'equip', label: '装备蓝图' },
  { key: 'ship', label: '舰船蓝图' },
  { key: 'consume', label: '消耗品蓝图' },
]
/** 各图鉴筛选行的灰字前缀（同「我的舰队」那套「类别：」「级别：」写法，避免多个「全部」混淆） */
const FILTER_LABEL: Record<Tab, string> = {
  guide: '',
  rules: '',
  items: '分类',
  modules: '槽类',
  ships: '类别',
  blueprints: '门类',
  skills: '技能组',
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
          ['怎么开', '出港页「矿带开采」选带出击：原矿进驾驶船货仓，到港自动整仓卸入物品仓库。'],
          ['怎么变快', '练「采矿技术 / 采矿护卫舰操作」提产量、缩循环；「自动循环」与 AI 副船让矿机不停转。'],
        ],
      },
      {
        title: '装卸',
        paras: [
          ['自动卸货', '任何舰船进港（停靠母港或已建成副站）都会自动整仓卸入物品仓库（无限容量、不随船）。'],
          ['手动与例外', '货仓页也可手动卸货——空闲停靠的非驾驶船同样可以。出售仍只对当前驾驶船开放。'],
        ],
      },
      {
        title: '精炼',
        paras: [
          ['怎么开', '工业页把原矿炼成原材料（「产出倍率」由精炼学与高级回收处理提升：基础 120%、技能最高 165%——无技能时炼矿净收益约为原料价值两成）。'],
          ['用途', '原材料是制造原料，也可卖出。'],
          ['炉位', '炉位：主控亲自运转限 1 台（占主控工作位），每枚 AI 核心各驱动一台——AI 核心启用数受上限约束，细则见「AI 副船」。'],
          ['用料', '原料不锁定，每批到点从货仓 + 仓库实时扣取。'],
        ],
      },
      {
        title: '制造与蓝图',
        paras: [
          ['买图与学习', '市场可购到所有装备与舰船（协会保底艇、异星原型科技除外）的蓝图书：购图到「蓝图书架」学习一次即永久可造，再到工业页组装机按图备料开工，到点自动入库（装备进装备库、舰船进舰船仓库）。'],
          ['图纸与现货', '图纸价格随产物档位升高、在市场上出现得也稀罕；赶时间可以继续直接买成品现货，两条渠道并存。'],
          ['产线归谁', '产线由主控（全局限 1 条、占主控不可离港）或一枚 AI 核心驱动（占用 AI 核心上限，见「AI 副船」）。'],
        ],
      },
    ],
  },
  {
    title: '战斗与生存',
    entries: [
      {
        title: '远征讨伐',
        paras: [
          ['怎么开', '星图「悬赏情报」选目标「出发」即开战：按火力结算，胜利得奖金 / 战利品 / 声望后自动返航（途中不可召回；停靠最近已建成站，无副站 = 母港）。'],
          ['失利', '失利扣耐久、可能弃船，同样自动返航（途中可召回）。'],
          ['路程', '去程已取消（选「出发」即开战）：打完自动返航，返航路程 = 目标↔落点单程；母港本地的悬赏固定约 2 分钟返港。'],
        ],
      },
      {
        title: '装配',
        paras: [
          ['槽位与退回', '装备库里的模块装到高 / 中 / 低槽位（布局见船卡；受 CPU 约束），卸下自动退回装备库。'],
          ['叠加规则', '抗性按递减方式合成（同一层装得越多越接近上限 90%，基础抗高的船提升越小）；伤害 / 射速 / 容量可以多装全量叠加（只受 CPU 限制），命中 / 闪避 / 抗性 / 速度同类多装收益递减（第 2 件约剩八成七、第 3 件约剩五成七）。「动力」影响弃船避险与跃迁充能。'],
          ['CPU 预算', '装配 CPU 预算是唯一硬约束（全部位合计 ≤ 船体 CPU；无人机放飞共用同一份预算）——低槽「协处理器」可为预算扩容（本件自身不占 CPU，卸下即收回：卸到超载会被拒绝，避免"装扩容件塞满再卸掉"套利）。'],
          ['中槽推进器', '中槽「矢量推进器」是周期点火：开场即点火、持续 60 秒，随后冷却 60 秒——点火期间战斗机动显著提升、开火命中略降（失稳代价同样只在点火期生效），冷却期间两者都回到基础值；战斗界面底部显示推进器倒计时。'],
          ['无人机', '无人机在装配页「无人机舱」装入清单（舱容 = 无人机舱 + 甲板扩展，与装配共用 CPU），战斗只放飞已装入的；卸下甲板扩展使机舱变小时，超出的无人机会自动退回仓库；战术导控阵列增伤。'],
          ['机群战损', '敌方近防炮会击落机群——战斗内机群可能全部损坏，战后按回收率找回一部分（基础 20%，「无人机回收学」满级 50%），回收名额优先给价值更高的机型；未回收的才自清单永久损失，战报里会列出这次回收了哪些、净损失哪些；侦察机靠闪避、攻坚机靠厚甲、哨戒机默认被近防炮放过（其余机型全被打光后就轮到它）。'],
        ],
      },
      {
        title: '耐久与维修',
        paras: [
          ['三层血的留存', '战斗磨损「结构」（= 耐久）与装甲：损伤跨场保留，结构归零弃船（货随船失）；护盾损失不保留（战斗中被动回充、脱战回满）。'],
          ['怎么修', '恢复：空间站付费维修，或货仓带「修理组件」野外应急（民用 / 军用两档，市场可买、工业页可自制；重复清剿会自动消耗）。'],
          ['战中续命', '想战中续命，可挂「船体维修装置」——每 5 秒自动修复装甲与结构，每跳吃掉一枚修理组件。'],
        ],
      },
    ],
  },
  {
    title: '残骸与回收',
    entries: [
      {
        title: '打捞残骸',
        paras: [
          ['怎么开', '驾驶船高槽装打捞器（无伤害件，升级只减周期）后，在星图「残骸打捞」选星系开捞：自动循环作业，满舱自动返航卸货后自动续捞（勾「本次返航卸货后停止」可做单趟）。'],
          ['低安风险', '低安星系打捞作业中可能遇袭，规则见「航行须知」。'],
        ],
      },
      {
        title: '回收残骸',
        paras: [
          ['在哪拆', '打捞的残骸在工业页开箱拆解：回收卡按敌群列出这批残骸的「保底原材料」，随 星系危险度 × 敌群威胁 上浮。'],
          ['特色掉落', '另有概率特色掉落——同卡的「特色掉落」栏写出的该敌群增幅装备（含关底穹顶守卫直出 MK3 武器）与高威胁蓝图碎片（MK3 装备只经碎片解锁）。'],
          ['提前看', '星图「残骸打捞」页会先标出该星系的这些内容。'],
        ],
      },
    ],
  },
  {
    title: '副船与扩张',
    entries: [
      {
        title: 'AI 副船',
        paras: [
          ['怎么开', '练「AI 核心操作学」（入门向）+ 买基础 AI 核心，可给闲置舰船指派自动采矿 / 打捞 / 掩护巡逻任务——核心效率越高越快。'],
          ['上限', '同时启用的 AI 核心总数受 AI 核心上限技能约束（Lv0 无法启用），AI 副船与站内精炼炉 / 回收炉 / 制造线共用该上限；站内产业可另练「工业自动化」扩容工业专用工位（每级 +2 枚、不占副船名额）。'],
          ['在哪指派', '舰船页「AI 指挥中心」可统一指派与取消这些作业。'],
        ],
      },
      {
        title: '副空间站',
        paras: [
          ['建成之后', '建成的副站并入协会基地网络：市场买卖、精炼与残骸回收、组装机制造线、维修补给、换驾驶卸货全部可用——设施与仓库和母港共享（同一市场与仓库）。'],
          ['返航落点', '采矿 / 打捞自动返航、悬赏与扫描的胜利返航都会停到最近已建成的站；手动召回仍回母港。'],
          ['工地', '未建成的工地不提供停靠与任何站内功能：人在现场可提交建材，或停靠空间站后一键「前往工地交付」——每趟装满货仓出航，到点清仓自动交付，并自动往返续运直到建站完成或仓库建材耗尽（途中可随时取消）。'],
        ],
      },
      {
        title: '长途运输',
        paras: [
          ['解锁', '建成至少一座副站后，星图「长途运输」页签开放。'],
          ['怎么跑', '选一条两站航线即可开始自动往返货运——虚拟货物占满货仓（不影响真实货物），每段按货仓容量 × 航程结算报酬，到站自动续下一段。'],
          ['停下', '随时「停止运输」会立即返港停靠，无惩罚。'],
        ],
      },
      {
        title: '势力与舰船',
        paras: [
          ['协会与部门', '深空工业协会是星域唯一的官方力量，舰船分部门出品：鲸盟（采矿工船）、掠食者（武装舰）、甲壳（重装舰）、蜃楼（航运货舰）。'],
          ['五个档位', '舰船按舰体尺寸分五档：护卫舰、驱逐舰、巡洋舰、战列舰、旗舰——档位越高舰体越强，价格与协会声望门槛随之抬高。'],
          ['子型号', '同档之内还有子型号（炮舰、无人机母舰等）与更精贵的奇货版本。'],
        ],
      },
    ],
  },
  {
    title: '市场与世界',
    entries: [
      {
        title: '交易',
        paras: [
          ['三个标签', '市场页：常驻供应 / 稀有订单 / 限定奇货三个标签，挂单与市价买卖；卖出成交收贸易税（练贸易技能减免）。'],
          ['撮合与冲击', '市场全程挂单簿撮合，收购价低于供应价；集中买卖会带动价格短时偏离（冲击动量），原矿 / 原材料另受库存池调节。'],
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
    title: '虫洞探索',
    entries: [
      {
        title: '发现虫洞',
        paras: [
          ['怎么扫', '在星图「扫描虫洞」选项卡开始扫描（主控活动，深空工业协会声望 40 解锁）：扫描窗口基准 12 小时，受「信号分析学 / 星图测绘学 / 信号过滤学」与「星际奇遇学」（满级 −20%）缩短。'],
          ['发现之后', '进度满即发现一处虫洞存入库存，最多同时囤 5 处（「星图记录学」满级再 +10 ⇒ 15 处）；每处锁定一个敌族、从第 1 层开始探索，进入即消耗该处——'],
          ['三种处置', '也可以派副船自动探索（约 5 分钟，收益约为亲自探索的四成，参与舰受损但不丢船），或直接放弃。'],
        ],
      },
      {
        title: '编队与质量',
        paras: [
          ['编队', '最多带 4 艘船，旗舰过重进不去（会压塌虫洞入口）。'],
          ['折算质量', '带入舰船按级别折算质量（护卫舰 500 / 驱逐舰 1,500 / 巡洋舰 3,500 / 战列舰 7,000）。'],
          ['回合代价', '编队总质量越高、可探索的回合数越少——4 艘护卫舰 56 回合，4 艘巡洋舰 32 回合。'],
        ],
      },
      {
        title: '搜打撤',
        paras: [
          ['推进', '洞内按节点推进（舰船信号 / 墓场与遗迹 / 矿脉 / 谜质 / 漂浮信标）：每层要走到下潜点并打赢层末守卫，才能继续深入。'],
          ['撤离', '撤离自第 2 层起要打一场撤离战，交火中不能撤。'],
          ['全损', '船被打沉，该船与它带回的货一起丢。'],
        ],
      },
      {
        title: '背包与产出',
        paras: [
          ['背包', '背包格数按编队合计货仓折算（每 500 m³ = 1 格），打捞到的安全货柜、图纸货柜各占固定格数。'],
          ['产出链', '洞内只产原矿「虚空母矿」，回港在精炼炉精炼出「虚空晶」。'],
          ['深浅曲线', '每深入一层收益 ×1.2、威胁 ×1.16——收益涨得比威胁快。'],
        ],
      },
    ],
  },
]

/** 「小贴士」子页的 key（它不是词条，单独占一页） */
const TIPS_KEY = '__tips'
const GUIDE_NOTES: string[] = [
  '技能训练与采矿 / 远征并行：训练队列永不停歇，先排要练的技能即可。',
  '物品仓库与装备库是空间站资产，弃船不丢；船上的货仓与装备会随船遗失。',
  '离线最长结算 8 小时：下次启动会自动结算并弹离线简报。',
]

/* ═══════════ 航行须知（2026-09-14 船长：同「玩法速览」，按词条分页 + 正文拆段） ═══════════ */

const RULE_SECTS: HandGroup[] = [
  {
    title: '低安安全（安全等级 = 星系风险）',
    entries: [
      {
        title: '安全等级',
        paras: [
          ['标色', '星图星系标色：越高越安全。'],
          ['三档', '安全等级 ≥ 0.5 为高安，0 至 0.5 之间为中安，≤ 0 为低安——只有低安会遇到巡逻拦截与海盗伏击，安全等级越低越危险、越频繁。'],
        ],
      },
      {
        title: '什么会遇袭',
        paras: [
          ['只打「停留与就地作业」', '低安只对「停留与就地作业」动手：矿带采掘中、打捞作业中、扫描期间、掩护巡逻驻留都可能撞见巡逻拦截或海盗伏击。'],
          ['长途运输', '长途运输途中同样会遇袭——跑运输的舰船在航段里会被当作「停在出发星系」，含低安航段的航线在「长途运输」页会标出这一条。'],
          ['AI 副船', 'AI 副船同样适用。'],
        ],
      },
      {
        title: '承担者',
        paras: [
          ['谁先挨打', '同一低安星系我方有船在场时，停泊 / 停留的船优先成为目标（区域事件一次，事件后该星系冷却一段时间）。'],
        ],
      },
      {
        title: '触发节奏',
        paras: [
          ['入场缓冲', '进入低安作业 / 驻留约 5 分钟后才可能遇袭（入场缓冲；扫描例外——扫描即暴露、无缓冲）。'],
          ['与随机事件共用时机', '遇袭判定与随机事件共用时机——事件到点时可能撞上巡逻 / 伏击，也可能照常出事件。'],
        ],
      },
      {
        title: '在线时',
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
          ['击退', '击退：缴获少量信用点。'],
          ['受损', '受损：敌方火力越强挨得越狠——先扣装甲、装甲吃穿才伤结构（底线 5%，绝不弃船）。'],
          ['被抢', '被抢：至多 30% 船上货物（无货则抢少量钱包）。'],
        ],
      },
      {
        title: '受损后先修再判',
        paras: [
          ['先自动修补', '遭遇了结后先自动修补：装甲或结构低于 50% 时，就地用修理组件（货舱优先、仓库兜底）补到两者约 60%，或组件用尽。'],
          ['修不动就撤', '组件不足、或补完后结构仍低于 50%，才收手返港待命——驾驶船停下采掘 / 打捞 / 扫描并即时返航最近已建成站，副船中止任务召回（副船结构低于 50% 需修好才能再派）。'],
        ],
      },
      {
        title: '迎战也有保险',
        paras: [
          ['轻损即退', '低安遭遇点「⚔ 迎战」时，本场结构损失过半即自动脱离（轻损退出，不给缴获也不额外扣损），随后同样按上面的撤退规则返港——不会把船打到弃船。'],
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
          ['怎么转', '采矿中点悬赏「⇄ 转战出发」= 结束采矿（货随船）并从矿带星系出发；远征中点矿带「⇄ 转开采」= 取消远征（无战果、讨伐同步停）并回港开采。'],
          ['确认', '均需两次确认。'],
        ],
      },
      {
        title: '重复清剿',
        paras: [
          ['怎么开', '空闲时可开：胜利后自动返航回港（返航路程 = 单程），冷却结束自动再出发，往复巡回。'],
          ['何时自动暂停', '货仓装不下缴获 / 耐久低于 50% 且修理组件耗尽 / 战败都会自动暂停。'],
        ],
      },
      {
        title: '战斗撤退',
        paras: [
          ['怎么撤', '交火中可「⚑ 撤退」（活动栏或战场内，两次确认）：轻损脱离、无弃船风险、立刻回港并停止讨伐（自动撤退与超时判负仍需航程返港）。'],
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
          ['同型多艘', '同型可买多艘：第 2 艘起默认带「#N」。'],
          ['改名', '可自由改名（10 字内、允许重名），改名后全界面显示自定义名。'],
        ],
      },
      {
        title: '货仓与出售',
        paras: [
          ['卸货', '任何舰船到港即自动卸货入仓库；货仓页可手动卸货——空闲停靠的非驾驶船同样可卸。'],
          ['谁能卖', '出售与装船只对当前驾驶船，且需停靠空间站（母港或已建成副站——共用同一市场与仓库）。'],
        ],
      },
      {
        title: '离线结算',
        paras: [
          ['8 小时', '离线最长结算 8 小时，重启自动结算并弹离线简报。'],
        ],
      },
    ],
  },
  {
    title: '战斗 · 伤害克制速查',
    entries: [
      {
        title: '血条三层',
        paras: [
          ['承受顺序', '每艘船血量分 护盾 → 装甲 → 结构 三层依次承受（破层溢出向下渗透）。'],
        ],
      },
      {
        title: '伤害克制矩阵',
        paras: [
          ['动能弹', '动能弹：盾 ×1.5 / 甲 ×0.5 / 结构 ×1（专职拆盾）。'],
          ['爆炸弹', '爆炸弹（高爆 / 导弹）：盾 ×0.5 / 甲 ×1.5 / 结构 ×1（专职破甲）。'],
          ['能量', '能量（等离子弹 / 激光）：盾 ×1.25 / 甲 ×1 / 结构 ×1（拆盾也强、无弱点）。'],
          ['界面提示', '弹药 chip 颜色 = 对应克制层色（盾蓝 / 甲红 / 结构黄），悬停可见矩阵。'],
        ],
      },
      {
        title: '抗性合成',
        paras: [
          ['递减合成', '各层抗性按递减方式合成（上限 90%）。'],
          ['减伤公式', '每层受到的伤害 = 层伤害 × 克制倍率 ×（1 − 该层对应系抗性）——配装时看敌方主伤害类型，选对应层抗与弹种。'],
        ],
      },
    ],
  },
  {
    title: '虫洞探索',
    entries: [
      {
        title: '进洞与离开',
        paras: [
          ['占主控', '进洞占主控一个活动：探索期间采矿 / 扫描 / 打捞 / 远征 / 长途运输都开不了，进洞时会自动停掉正在进行的作业。'],
          ['临时离开', '关掉虫洞界面＝临时离开——主控立刻释放、洞内进度原样保存并冻结，回来时要求主控空闲。'],
        ],
      },
      {
        title: '回合与全损',
        paras: [
          ['回合开销', '到达一个地点耗 1 回合，同一地点每多打一波、每多捡一堆各 +1 回合；回合耗尽只能撤离。'],
          ['全损', '船被打沉：该船与它带回的货一起丢失；整队失联＝本趟没有产出。'],
        ],
      },
      {
        title: '临时空间',
        paras: [
          ['用途', '货仓右侧的备用格区（4×8 = 32 格），用来腾位置或暂存待丢的东西。'],
          ['规则', '里面有东西时不能进行其他操作，离开背包页前必须放回货仓或丢掉。'],
        ],
      },
      {
        title: '谜质储存器',
        paras: [
          ['占格', '洞内采到的谜质储存器在货仓里占 2×2 格。'],
          ['时效', '本趟虫洞内生效、离开即消失；拖进临时空间就会失效。'],
        ],
      },
    ],
  },
  {
    title: '目标档案',
    entries: [
      {
        title: '寻找人类',
        paras: [
          ['你的身份', '人类已全体失踪——你是一艘前人类时代的舰船 AI。'],
          ['线索', '目前没有任何可执行线索，完成方法未知。'],
          ['方向', '以这座章鱼宇宙人统治的母港为起点，往未知的前方继续航行，壮大自身规模，应对各种危险，或许终会有所发现。'],
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
  } else if (cell.tab === 'skills') {
    rows.push(['技能组', String(r.group ?? '')])
    rows.push(['训练难度', `${Number(r.rank ?? 0)}（数值越大整条线练得越慢）`])
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
              title="前往市场查看该物品的订单（价格/挂单/买入）"
              onClick={() => {
                onClose()
                onGotoMarket(marketKey)
              }}
            >
              ↖ 查看市场
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
  /** 切页：清空关键词、详情与筛选（各页关键词/分类互不相关，避免"换了页却没结果"的困惑） */
  function changeTab(t: Tab): void {
    setTab(t)
    setQuery('')
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
    ...(tab === 'guide' && tipsHit ? [{ key: TIPS_KEY, label: '小贴士' }] : []),
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
    if (t === 'ships') return String(c.raw.role ?? 'industrial') === main
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
      return q === '' ? `${n} ${COUNT_UNIT[tab]}` : `匹配 ${n} ${COUNT_UNIT[tab]}`
    }
    return narrowed ? `匹配 ${codexHit} ${COUNT_UNIT[tab]}` : `${codexHit} ${COUNT_UNIT[tab]}`
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

  /** 页底翻页条（船长 2026-09-14 追加）：连着读完一章更顺；到头的那一侧留空位（保持按钮位置稳定） */
  function renderPager(): ReactNode {
    if (prevPage === null && nextPage === null) return null
    return (
      <div className="app-hand-pager">
        {prevPage !== null ? (
          <button className="app-btn is-small app-hand-pager-btn" onClick={() => setPageKey(prevPage.key)}>
            ‹ 上一条 · {prevPage.label}
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
            <div className="app-bay-title">小贴士</div>
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
      return <div className="app-dim app-inv-empty">没有匹配「{query.trim()}」的词条——换个关键词试试。</div>
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
                        title={hits === 0 ? '当前关键词在这一条里没有命中' : undefined}
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
                  <span>小贴士</span>
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
                    图标
                  </button>
                  <button className={`app-hand-viewbtn${view === 'list' ? ' is-active' : ''}`} onClick={() => changeView('list')}>
                    列表
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
                      全部
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
                        全部子类
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
                      : '当前筛选下没有条目——换个分类，或点「全部」看全表。'}
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
