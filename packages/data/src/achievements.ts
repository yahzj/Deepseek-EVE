/**
 * **成就徽章表**（船长 2026-09-18「顺便打算制作成就系统，每个重要任务就会给予一个成就徽章，
 * 不过等做完这个之后再考虑，先挂机，可以预留接口」＋ 2026-09-20「继续之前的成就系统」。
 *
 * **第一批 = 徽章框架 · 共 63 枚**（设计稿 `docs/design/achievements-20260920.md`）：
 * - **13 枚任务徽章**：`FIRST_TASKS` 的 13 条「第一次」任务，各 1 枚（达到即发）
 *   —— 卡名＝任务标题（「第一次扫描」等），**与任务中心同名**是有意的：它纪念的就是那件事。
 * - **50 枚链徽章**（共 13 条链）：12 条一般「次数链」× **1 / 4 / 7 / 10 级**各 1 枚 = 48 枚。
 * - **2 枚探索家徽章**：「宇宙探索家」`scan` 链**上限只有 5 级**（`CHAIN_TIERS.scan = [5,8,12,16,20]`）
 *   ⇒ 按船长 2026-09-20 裁定**只做 1 级与 5 级**两枚（不套 1/4/7/10）。
 *
 * **卡名口径**（船长 2026-09-20 改版：「**宇宙探索家 · 1 级这种非常难看，可以采用见习探索家这种**」）：
 * - **链徽章** = **档位词 ＋ 行当**（`chainBadgeName`）⇒ `见习探索家` / `传奇赏金猎人`；
 *   ⚠ **不带级别数字**——档位词已表达进阶；「链名 · N 级」那句旧写法只留在**说明**里。
 * - **任务徽章** = 任务标题（船长裁定：不改名）。
 * - 展示改版的完整口径见工作文档 `docs/design/achievement-display-20260920.md`。
 *
 * **图案与配色**（船长：「**图案相同，用颜色区分**」）：
 * - `pattern` = SVG 线稿的图案键（渲染层 `ui/AchievementsGlyph.tsx` 一根线稿一枚底纹）；
 *   **同一条链的 4 枚共用一个 `pattern`**，靠 `tone` 区分档位。
 * - `tone` 取**本仓既有语汇**（`ui/Glyphs.tsx` 的「同造型 · 按档位分色」成例：AI 核心 / 图纸货柜），
 *   不新造颜色：1 级青绿 `#7fd4a8`（AI 核心·伽马）· 4 级琥珀 `#ffca58`（图纸货柜·中层 / AI 核心·贝塔）·
 *   7 级炽橙 `#ff9d5c`（AI 核心·阿尔法）· 10 级品红紫 `#e07bff`（图纸货柜·深层）。
 *   探索家那 2 枚按**首尾**取色（1 级 = 青绿、5 级 = 品红紫），与四档梯子同向。
 *
 * ⚠ **纯展示**（船长 2026-09-20 裁定）：徽章**不发任何 ISK / 物品 / 数值加成**，只作荣誉记录。
 * ⚠ **本表只描述"是什么"**：发放与判定在 `core/achievements.ts`（**按 `source` 认领，不认 id 前缀**）；
 * 这里写错 `source` ⇒ 体检判红 + 引擎忽略。
 * **两批均已完成并合入 main**（第一批 = 任务 ＋ 链 63 枚；第二批 = 里程碑 18 枚 ⇒ 共 **81 枚**），
 * ⇒ 本表**不挂任何 `⟪未完成⟫` 记号**（约定 §十一之二：完成即删记号）。
 */
import type { AchievementCategory, AchievementDef } from '@whale/core'
import { CHAIN_TIERS, FIRST_TASKS } from '@whale/core'

/** 档位 → 颜色（四档梯子；与 `ui/Glyphs.tsx` 既有语汇同源） */
const TONE_L1 = '#7fd4a8'
const TONE_L4 = '#ffca58'
const TONE_L7 = '#ff9d5c'
const TONE_L10 = '#e07bff'

/** 一般链的档位（船长的 1/4/7/10）；探索家单独走 1/5 */
const STANDARD_LEVELS: readonly number[] = [1, 4, 7, 10]
/** 档位 → 颜色 */
const STANDARD_TONES: Readonly<Record<number, string>> = {
  1: TONE_L1,
  4: TONE_L4,
  7: TONE_L7,
  10: TONE_L10,
}
/** 探索家链：上限 5 级 ⇒ 只 1 级与 5 级两枚，按首尾取色 */
const EXPLORER_CHAIN_ID = 'explorer'
const EXPLORER_LEVELS: readonly number[] = [1, 5]
const EXPLORER_TONES: Readonly<Record<number, string>> = { 1: TONE_L1, 5: TONE_L10 }

/**
 * **档位词**（链徽章名的前半；船长 2026-09-20「比如宇宙探索家 · 1 级这种非常难看，
 * 可以采用见习探索家这种」）。
 *
 * ⚠ **刻意不带级别数字**：档位词本身已表达进阶（见习 → 资深 → 王牌 → 传奇）；
 * 级别仍可在徽章**说明**与悬停里读到 ⇒ 卡面不必再挂一个「· N 级」。
 */
const TIER_WORDS: readonly string[] = ['见习', '资深', '王牌', '传奇']
/**
 * **链级别 → 档位词**（两套都写死，**不按门槛推导**）。
 *
 * ⚠ 为什么不推导：一般链的顶档是 **10 级**、探索家那条只有 **5 级**——
 * 两者是**各自链的顶档**，不是同一个门槛。若拿「`level >= 4` 就算资深」这类
 * 统一门槛去套，探索家的 5 级会被判成「资深探索家」（首尾取色的口径就错了）。
 * 故按链把三档词写全：一般链 1/4/7/10 ⇒ 见习/资深/王牌/传奇；
 * 探索家 1/5 ⇒ **见习 / 传奇**（首尾两档，与它那两枚的配色同向）。
 */
const STANDARD_TIER_WORDS: Readonly<Record<number, string>> = {
  1: TIER_WORDS[0]!,
  4: TIER_WORDS[1]!,
  7: TIER_WORDS[2]!,
  10: TIER_WORDS[3]!,
}
const EXPLORER_TIER_WORDS: Readonly<Record<number, string>> = {
  1: TIER_WORDS[0]!,
  5: TIER_WORDS[3]!,
}

/**
 * **链 → 行当**（链徽章名的后半）。**链名本身一字不动**（船长 2026-09-20 裁定）：
 * 任务中心等处仍显示「宇宙探索家」「学而不厌」；本表只服务徽章名。
 *
 * 为什么另立一张而不是直接拼链名：13 条链的**词性并不统一**——
 * 9 条是人称（深空采掘者 / 维修技师 / 赏金猎人…，拼档位词通顺），
 * 4 条是成语或事业名（`scholar` 学而不厌 / `dispatch` 舰队调度 /
 * `freight` 星际货运 / `lineboss` 产线主管）⇒「见习学而不厌」「见习舰队调度」不通。
 * 故这 4 条单配行当；其余 9 条沿用链名。
 *
 * ⚠ `abyss` 取「深渊行者」而非「深渊探索者」：后者与「资深」连写会成
 * 「资深深渊探索者」（两个「深」叠字）。施工时逐条核对过 13 × 4 个组合，仅此一条有此问题。
 */
const CHAIN_RANK: Readonly<Record<string, string>> = {
  explorer: '探索家',
  digger: '采掘者',
  scavenger: '拾荒者',
  mechanic: '维修师',
  hunter: '赏金猎人',
  refiner: '精炼师',
  lineboss: '产线主管',
  marketeer: '市场老手',
  shipwright: '造船厂主',
  scholar: '学者',
  dispatch: '调度官',
  freight: '货运长',
  abyss: '深渊行者',
}

/**
 * **链徽章的卡名** = 档位词 ＋ 行当（例：`见习探索家` · `传奇赏金猎人`）。
 *
 * 档位词按**该链自己的档位表**取（探索家走 1/5 那套）；行当查不到时回退链名本身
 * （新增链若忘了配行当，卡名退化成"档位词 + 链名"而不是空串或崩掉）。
 */
function chainBadgeName(chainId: string, chainName: string, level: number): string {
  const table = chainId === EXPLORER_CHAIN_ID ? EXPLORER_TIER_WORDS : STANDARD_TIER_WORDS
  const word = table[level] ?? TIER_WORDS[0]!
  return word + (CHAIN_RANK[chainId] ?? chainName)
}

/** 任务徽章的说明（船长 2026-09-20：「纯展示」⇒ 只讲"这枚纪念了什么"） */
function taskNote(title: string): string {
  return `达成「${title}」时获得的纪念徽章。`
}

/**
 * **13 枚任务徽章**（由 `FIRST_TASKS` 派生 ⇒ 任务表增删时本表自动跟随，不会漏配）。
 * `pattern` 统一走 `'first'`（同一张"任务纪念"底纹），靠 `tone` 与名称区分。
 */
function taskAchievements(): AchievementDef[] {
  return FIRST_TASKS.map((task) => ({
    id: `ach-first-${task.id.slice('first-'.length)}`,
    name: task.title,
    note: taskNote(task.title),
    category: 'first-task' as AchievementCategory,
    pattern: 'first',
    tone: TONE_L1,
    source: { kind: 'task' as const, taskId: task.id },
  }))
}

/**
 * **50 枚链徽章**（12 条一般链 × 4 档 ＋ 探索家 2 档）——同样由任务表派生，
 * 链的展示名直接取任务表里那条链的 `name`（唯一来源，避免两处写两个名字）。
 *
 * ⚠ 卡名走 `chainBadgeName`（档位词 ＋ 行当），**不是**「链名 · N 级」（船长 2026-09-20 改）；
 * 「链名」仍用在**说明**里 —— 说明要讲"是哪条链的哪一档"，那里带级别才说得清。
 */
function chainAchievements(): AchievementDef[] {
  const out: AchievementDef[] = []
  for (const task of FIRST_TASKS) {
    const chain = task.chain
    if (!chain) continue
    const isExplorer = chain.id === EXPLORER_CHAIN_ID
    const levels = isExplorer ? EXPLORER_LEVELS : STANDARD_LEVELS
    const tones = isExplorer ? EXPLORER_TONES : STANDARD_TONES
    const top = (CHAIN_TIERS[chain.tierKey] ?? []).length
    for (const level of levels) {
      // 上限不足的档位直接跳过（探索家 5 级封顶 ⇒ 7/10 级那两枚本就不该存在）
      if (level > top && !isExplorer) continue
      out.push({
        id: `ach-chain-${chain.id}-${level}`,
        name: chainBadgeName(chain.id, chain.name, level),
        note: `「${chain.name}」进度达到 ${level} 级时获得的纪念徽章。`,
        category: 'chain' as AchievementCategory,
        pattern: chain.id,
        tone: tones[level] ?? TONE_L1,
        source: { kind: 'chain' as const, chainId: chain.id, level },
      })
    }
  }
  return out
}

/**
 * **里程碑徽章的配色**：统一取本仓既有语汇里的**金**（`#f4c95d`，与市场「稀有」档、
 * 装配页金色强调同源）——与链徽章的**四档梯子**分开：链徽章靠颜色分档（同图案），
 * 里程碑靠**图案**分家族（同颜色）⇒ 两类一眼可辨。
 */
const TONE_MILESTONE = '#f4c95d'

/** 一条里程碑定义（数据表内部用；`stat` 取值见 core `FirstStatKey`） */
interface MilestoneSpec {
  /** 短名（拼进 id，`ach-mile-<slug>`） */
  slug: string
  name: string
  /** 图案键（渲染层 `ach-mile-<slot>` 一根线稿一族的底纹） */
  slot: string
  /** 计数键（core `FirstStatKey`） */
  stat: string
  target: number
  /** 说明模板（只讲规格：哪条量、到多少；`{n}` = 阈值 ＋ 量词） */
  note: string
  /** 阈值单位后缀（数字后面的量词）。留空 = 裸数字 */
  unit: string
}

/**
 * **18 枚里程碑成就**（第二批 · 船长 2026-09-20「开始第二批」）。
 *
 * 六个家族，阈值依据**实测**（不是拍的）：
 * - **深渊层深** 2/3/4/5 层 —— 4 船真档编队 12 趟实测**平均到达 2.90 层**、最深见 4~5 层
 *   ⇒ 阶梯落在真实可达范围内（层 5 属顶配编队才够得着的尖顶档，是有意的梯度）；
 * - **层末守卫** 2/4 个 —— 与层深阶梯同向（要打到第 N 层，须先清掉沿途 N 个守卫）；
 * - **稀有残骸的额外战利品** 1/5/20/60/150 件 —— 稀有残骸「每烧满 30 m³ 必给一次」⇒ 一次 = 一件
 *   （⚠ 玩家可见文案一律写「额外战利品」，**不写"高级箱"**——那是施工期工作名，见 `content:check` 陈旧术语契约）；
 * - **AI 核心** 1/2/3/4 类 —— 四类核心（基础/伽马/贝塔/阿尔法）**到手过**的类数；
 * - **副空间站** 1/2 座 —— 全游戏共 2 座可建；
 * - **谜质科技** 23 项全满级 —— 节点表实测 23 个节点。
 *
 * ⚠ **纯展示**（与第一批同口径）：不发任何奖励；判据只读终身计数 ⇒ **老档零迁移**
 * （新键缺省 0，载入后第一拍按现状补发，见 `core/achievements.ts`）。
 */
function milestoneAchievements(): AchievementDef[] {
  const specs: MilestoneSpec[] = [
    /* ── 深渊层深（4 枚）── 只计**手动**虫洞：自动探索不经过 `wormholeDescend`（船长裁定） */
    { slug: 'wh-depth-2', slot: 'depth', name: '初入深渊', stat: 'whMaxDepth', target: 2, unit: ' 层', note: '在虫洞中到达第 {n}。' },
    { slug: 'wh-depth-3', slot: 'depth', name: '深渊宿将', stat: 'whMaxDepth', target: 3, unit: ' 层', note: '在虫洞中到达第 {n}。' },
    { slug: 'wh-depth-4', slot: 'depth', name: '深渊之主', stat: 'whMaxDepth', target: 4, unit: ' 层', note: '在虫洞中到达第 {n}。' },
    { slug: 'wh-depth-5', slot: 'depth', name: '深渊彼岸', stat: 'whMaxDepth', target: 5, unit: ' 层', note: '在虫洞中到达第 {n}。' },
    /* ── 层末守卫（2 枚）── 累计打掉的守卫数 */
    { slug: 'wh-boss-2', slot: 'guard', name: '斩层者', stat: 'whBossClears', target: 2, unit: ' 个', note: '累计击破 {n}层末守卫。' },
    { slug: 'wh-boss-4', slot: 'guard', name: '守关终结者', stat: 'whBossClears', target: 4, unit: ' 个', note: '累计击破 {n}层末守卫。' },
    /* ── 稀有残骸的额外战利品（5 枚）── 每烧满 30 m³ 必给一次 = 一件
       ⚠ 文案口径（2026-09-16 起，`content:check` 的「陈旧术语契约」当场抓过我一次）：
       **不得写"高级箱"**（那是施工期工作名）——叙述一律写「额外战利品」。 */
    { slug: 'box-1', slot: 'cache', name: '初启箱庭', stat: 'rareBoxes', target: 1, unit: ' 件', note: '累计取得 {n}稀有残骸额外战利品。' },
    { slug: 'box-5', slot: 'cache', name: '拾荒老手', stat: 'rareBoxes', target: 5, unit: ' 件', note: '累计取得 {n}稀有残骸额外战利品。' },
    { slug: 'box-20', slot: 'cache', name: '拾荒名匠', stat: 'rareBoxes', target: 20, unit: ' 件', note: '累计取得 {n}稀有残骸额外战利品。' },
    { slug: 'box-60', slot: 'cache', name: '拾荒巨匠', stat: 'rareBoxes', target: 60, unit: ' 件', note: '累计取得 {n}稀有残骸额外战利品。' },
    { slug: 'box-150', slot: 'cache', name: '箱庭之主', stat: 'rareBoxes', target: 150, unit: ' 件', note: '累计取得 {n}稀有残骸额外战利品。' },
    /* ── AI 核心（4 枚）── 四类核心里**到手过**的类数 */
    { slug: 'core-1', slot: 'core', name: '初识核心', stat: 'aiCoreKinds', target: 1, unit: ' 类', note: '获得过 {n} AI 核心。' },
    { slug: 'core-2', slot: 'core', name: '双子核', stat: 'aiCoreKinds', target: 2, unit: ' 类', note: '获得过 {n} AI 核心。' },
    { slug: 'core-3', slot: 'core', name: '三核共鸣', stat: 'aiCoreKinds', target: 3, unit: ' 类', note: '获得过 {n} AI 核心。' },
    { slug: 'core-4', slot: 'core', name: '四核同心', stat: 'aiCoreKinds', target: 4, unit: ' 类', note: '获得过 {n} AI 核心。' },
    /* ── 副空间站（2 枚）── 建成并入网的站数 */
    { slug: 'site-1', slot: 'outpost', name: '拓荒者', stat: 'sitesBuilt', target: 1, unit: ' 座', note: '建成 {n}副空间站。' },
    { slug: 'site-2', slot: 'outpost', name: '双站总督', stat: 'sitesBuilt', target: 2, unit: ' 座', note: '建成 {n}副空间站。' },
    /* ── 谜质科技（1 枚）── 满级节点数 = 全表节点数（23）时达成 */
    { slug: 'tech-tree', slot: 'tech', name: '谜质通晓', stat: 'matterTechMaxed', target: 23, unit: ' 项', note: '谜质科技树 {n}研究全部满级。' },
  ]
  return specs.map((s) => ({
    id: `ach-mile-${s.slug}`,
    name: s.name,
    note: s.note.replace('{n}', `${s.target}${s.unit}`),
    category: 'milestone' as AchievementCategory,
    pattern: `mile-${s.slot}`,
    tone: TONE_MILESTONE,
    source: { kind: 'milestone' as const, stat: s.stat, target: s.target },
  }))
}

/** **全部徽章**（顺序 = 任务徽章 → 链徽章 → 里程碑；界面按此序铺同一张网格） */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  ...taskAchievements(),
  ...chainAchievements(),
  ...milestoneAchievements(),
]

/** 按 id 取一枚徽章 */
export function achievementOf(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id)
}

/** 某条链的全部徽章（界面按链分组时用） */
export function achievementsOfChain(chainId: string): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => a.source.kind === 'chain' && a.source.chainId === chainId)
}
