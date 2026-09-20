/**
 * **成就徽章表**（船长 2026-09-18「顺便打算制作成就系统，每个重要任务就会给予一个成就徽章，
 * 不过等做完这个之后再考虑，先挂机，可以预留接口」＋ 2026-09-20「继续之前的成就系统」。
 *
 * **第一批 = 徽章框架 · 共 63 枚**（设计稿 `docs/design/achievements-20260920.md`）：
 * - **13 枚任务徽章**：`FIRST_TASKS` 的 13 条「第一次」任务，各 1 枚（达到即发）。
 * - **48 枚链徽章**：12 条一般「次数链」× **1 / 4 / 7 / 10 级**各 1 枚。
 * - **2 枚探索家徽章**：「宇宙探索家」`scan` 链**上限只有 5 级**（`CHAIN_TIERS.scan = [5,8,12,16,20]`）
 *   ⇒ 按船长 2026-09-20 裁定**只做 1 级与 5 级**两枚（不套 1/4/7/10）。
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
 * `⟪未完成 2026-09-20⟫` **第二批（里程碑成就）未做**：届时在 `AchievementCategory` 增 `'milestone'` 一类、
 * 在本表追加条目即可，`kind` 判别与发放/界面/存档都能原样复用（设计稿 §3.4）。
 * **第一批（任务 ＋ 链共 63 枚）已完成并合入 main ⇒ 不再挂未完成记号**（约定 §十一之二：完成即删记号）。
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
        name: `${chain.name} · ${level} 级`,
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

/** **全部徽章**（顺序 = 任务徽章在前、链徽章按任务表顺序；界面按此序展示） */
export const ACHIEVEMENTS: readonly AchievementDef[] = [...taskAchievements(), ...chainAchievements()]

/** 按 id 取一枚徽章 */
export function achievementOf(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id)
}

/** 某条链的全部徽章（界面按链分组时用） */
export function achievementsOfChain(chainId: string): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => a.source.kind === 'chain' && a.source.chainId === chainId)
}
