/**
 * **通讯文案的本地化单点**（2026-09-22 · 船长令「你继续本地化」）。
 *
 * 病根：通讯是**数据侧**文案 —— `CommsMessageDef.subject`（30 封）与势力/部门名（`commsFactions.ts`）
 * 都是纯中文，core 还会把发件人拼成「势力名 · 部门名」再交给界面（`comms.ts` 的 `resolveCommsSender`）
 * ⇒ 英文界面下整页中文（实测通讯页 49 处）。
 *
 * 口径（沿用 `ui/labelsText.ts` 的"中文即键"做法，**data/core 一个字节不动**）：
 * - 发件人：**按中文名映射**（协会/部门名是数据侧稳定中文名）⇒ `commsSenderText()`；
 * - 主题行：**按消息稳定 id 映射**（`CommsMessageDef.id` 是"已送达/已读记账"的稳定键）⇒ `commsSubjectText()`；
 * - 时间：`commsGameClock()` 是中文整句 ⇒ 这里用 core 导出的 `COMMS_DAY_MS` 自己算"第几天 + 时:分"，
 *   句子由 `ui.comms.044` 出。
 * ⚠ **查不到一律原样返回**（新剧本/新部门漏登记时看得见中文，不会静默变空）。
 * ⚠ 新增通讯/部门时**同步在下面两张表加一行**。
 *
 * 本批未覆盖：正文段落（`body`，约 90 行）与部门简介（`brief`，悬停说明）——正文另开一遍。
 */
import { COMMS_DAY_MS } from '@whale/core'
import { tr } from '../i18n/locale'

/** 势力 / 部门 / 小队名 → l10n id（键 = 数据侧中文名，`ui.comms.001~013`） */
const COMMS_NAME_ID: Record<string, string> = {
  深空工业协会: 'ui.comms.001',
  打捞队工会: 'ui.comms.002',
  信息库: 'ui.comms.003',
  检索重启: 'ui.comms.004',
  航行管制: 'ui.comms.005',
  基建部: 'ui.comms.006',
  测绘处: 'ui.comms.007',
  工业部: 'ui.comms.008',
  冶炼组: 'ui.comms.009',
  训练处: 'ui.comms.010',
  财务处: 'ui.comms.011',
  航线安全: 'ui.comms.012',
  老陈一队: 'ui.comms.013',
}

/**
 * 发件人写法（core 拼好的 `势力名 · 部门名`，或降级时的原文 id）→ 当前语言。
 * 按 ` · ` 拆开逐段映射（分隔符语言中立，照原样拼回；玩家自定义名一类查不到的原样保留）。
 */
export function commsSenderText(from: string): string {
  if (from === '') return from
  return from
    .split(' · ')
    .map((part) => {
      const id = COMMS_NAME_ID[part]
      return id !== undefined ? tr(id) : part
    })
    .join(' · ')
}

/** 消息 id → 主题行的 l10n id（键 = `CommsMessageDef.id`，`ui.comms.014~043`） */
const COMMS_SUBJECT_ID: Record<string, string> = {
  // ── 「第一次」13 封（`firstTaskMessages.ts`）──
  'first-scan': 'ui.comms.014',
  'first-mine': 'ui.comms.015',
  'first-refine': 'ui.comms.016',
  'first-bounty': 'ui.comms.017',
  'first-repair': 'ui.comms.018',
  'first-salvage': 'ui.comms.019',
  'first-skill': 'ui.comms.020',
  'first-ai': 'ui.comms.021',
  'first-produce': 'ui.comms.022',
  'first-order': 'ui.comms.023',
  'first-ship': 'ui.comms.024',
  'first-haul': 'ui.comms.025',
  'first-wormhole': 'ui.comms.026',
  // ── 开局与协会侧剧本（`messages.ts`）──
  'msg-briefing': 'ui.comms.027',
  'msg-welcome': 'ui.comms.028',
  'msg-survey-memo': 'ui.comms.029',
  'msg-cinder-warning': 'ui.comms.030',
  'msg-industry-shift': 'ui.comms.031',
  'msg-refinery-note': 'ui.comms.032',
  'msg-salvage-crew': 'ui.comms.033',
  'msg-site-thanks': 'ui.comms.034',
  'msg-auro-megastructure': 'ui.comms.035',
  'msg-exile-swarm': 'ui.comms.036',
  'msg-lowsec-rules': 'ui.comms.037',
  'msg-redring-outpost': 'ui.comms.038',
  'msg-wormhole-nebula': 'ui.comms.039',
  'msg-wormhole-unlock': 'ui.comms.040',
  'msg-ambush-retreat': 'ui.comms.041',
  'msg-first-ship': 'ui.comms.042',
  'msg-pirate-capture-web': 'ui.comms.043',
}

/** 主题行（有登记走当前语言；没登记回落数据侧原文） */
export function commsSubjectText(id: string, fallback: string): string {
  const l10nId = COMMS_SUBJECT_ID[id]
  return l10nId !== undefined ? tr(l10nId) : fallback
}

/** 送达时间（「第 N 天 HH:MM」的本地化版；算法与 core `commsGameClock` 同源） */
export function commsClockText(gameMs: number): string {
  const t = Math.max(0, Math.floor(gameMs))
  const day = Math.floor(t / COMMS_DAY_MS) + 1
  const rest = t % COMMS_DAY_MS
  const hh = String(Math.floor(rest / 3_600_000)).padStart(2, '0')
  const mm = String(Math.floor((rest % 3_600_000) / 60_000)).padStart(2, '0')
  return tr('ui.comms.044', { p1: day, p2: `${hh}:${mm}` })
}
