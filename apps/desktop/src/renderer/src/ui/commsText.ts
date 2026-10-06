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
 * ⚠ **新增通讯必须同时登记两张表**：主题行（`COMMS_SUBJECT_ID`）与**正文**（`COMMS_BODY_EN`）。
 * 正文那张表**按行数对齐**——行数不符时 `commsBodyText()` 整段回落中文（宁可整段中文，也不许错行串位）。
 * 2026-09-26 新增 `msg-blackbox-plug-unlock` 时就是按这条办的（船长亲笔三段，英文也落三段）。
 */
import { COMMS_DAY_MS } from '@whale/core'
import { L10N } from '@whale/data'
import type { CommsEntryView, CommsRewardLine } from '@whale/core'
import { isEn, paramText, tr } from '../i18n/locale'

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
  // 2026-09-30 船长令：实验室首访通讯的发件方（非官方 · 黑市）
  黑市: 'ui.comms.074',
  违禁品柜: 'ui.comms.075',
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
  'msg-wh-siege': 'ui.comms.067', // 围剿通报（2026-09-23 船长令：首次下到第 7 层）
  /* ⟪文案调整 2026-10-01⟫（船长报障「本地存档显示的是 '{p1} ×{p2}'」）：原先挂的是
     `ui.comms.072` —— 那是**奖励清单的模板**（`{p1} ×{p2}`，由 `commsRewardText()` 喂参），
     而本表是**无参**渲染（`commsSubjectText()` 只做 `tr(id)`）⇒ 主题行原样印出占位符。
     ⇒ 改用**专为此写的主题 id** `ui.comms.079`；`ui.comms.072` 回归本职、一字未动。 */
  'msg-blackbox-plug-unlock': 'ui.comms.079', // 首个黑匣解锁插件（2026-09-26 船长令）
  'msg-lab-contraband': 'ui.comms.076', // 首访实验室：黑市的违禁货通讯（2026-09-30 船长令）
}

// ⟪文案调整 2026-10-04⟫ 建站弹层和收件箱镜像共用同一组对白 id。
const COMMS_DIALOGUE_ID: Record<string, { subject: string; prefix: string; speaker: string; count: number }> = {
  'dlg-redring-intro': { subject: 'ui.commsDialogue.001', prefix: 'ui.commsRedintro', speaker: 'ui.commsSpeaker.001', count: 5 },
  'dlg-redring-done': { subject: 'ui.commsDialogue.002', prefix: 'ui.commsReddone', speaker: 'ui.commsSpeaker.001', count: 6 },
  'dlg-cinder-intro': { subject: 'ui.commsDialogue.003', prefix: 'ui.commsCinderintro', speaker: 'ui.commsSpeaker.002', count: 4 },
  'dlg-cinder-done': { subject: 'ui.commsDialogue.004', prefix: 'ui.commsCinderdone', speaker: 'ui.commsSpeaker.002', count: 6 },
}

export function commsDialogueText<T extends { id?: string; title: string; lines: readonly { speaker: string; text: string }[] }>(script: T): T {
  const spec = script.id ? COMMS_DIALOGUE_ID[script.id] : undefined
  if (!isEn() || !spec || spec.count !== script.lines.length) return script
  return {
    ...script,
    title: commsSenderText(script.title),
    lines: script.lines.map((line, i) => ({
      ...line,
      speaker: tr(spec.speaker),
      text: tr(`${spec.prefix}.${String(i + 1).padStart(3, '0')}`),
    })),
  }
}

/**
 * 主题行（有登记走当前语言；没登记回落数据侧原文）。
 *
 * ⚠ **两条路**（**2026-09-30 批 5 补第二条**）：
 * ① 静态表 `COMMS_SUBJECT_ID`：主题**不带参数**的通讯（13 封「第一次」＋协会剧本）；
 * ② **动态**：`subjectId` 是 core 现场给的一句模板（例：周末入侵那封 `core.weekend.010`
 *    「航线警告：{p1}入侵」，`{p1}` 还要再过 `p1Id` 翻族名）⇒ 走 `tr(subjectId, 参数)`。
 * 为什么必须补 ②：英文扫描实测通讯页那封入侵警告的主题一直是中文 —— 静态表里**没有**
 * `msg-weekend-warn`（它压根不是"一句话"，而是"模板 ＋ 参数"）。
 */
export function commsSubjectText(
  id: string,
  fallback: string,
  dynamic?: { subjectId?: string; params?: Readonly<Record<string, string | number>> },
): string {
  if (dynamic?.subjectId !== undefined) {
    const raw = dynamic.params ?? {}
    const out: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'parts') continue // 数组不进插值表（口径同 `locale.tsx` 的 `composeParts`）
      if (typeof v !== 'string' && typeof v !== 'number') continue
      out[k] = v
    }
    /**
     * `p{n}Id` ＝「第 n 槽那句话的 id」⇒ 先渲染成当前语言再喂进去
     * （口径同 `locale.tsx` 的 `paramText`；例：族名那句 `core.weekend.*`）。
     */
    for (const [k, v] of Object.entries(raw)) {
      if (!k.endsWith('Id') || typeof v !== 'string') continue
      const slot = k.slice(0, -2)
      if (out[slot] !== undefined) out[slot] = paramText(v)
    }
    return tr(dynamic.subjectId, out)
  }
  const l10nId = COMMS_SUBJECT_ID[id] ?? (id.startsWith('dlg:') ? COMMS_DIALOGUE_ID[id.slice(4)]?.subject : undefined)
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

// l10n-keep-start：下面三张表的**中文是键**（数据侧取值：立场 `CommsFactionAlignment`、内容类型 `CommsKind`、
// 跳转说明 `hint.text` 逐句独立）——渲染前一律过本文件的 `comms*Text()` 取当前语言，故不是漏译。
/** 立场片（数据侧 `CommsFactionAlignment`：官方 / 民间 / 系统） */
const COMMS_ALIGN_ID: Record<string, string> = {
  官方: 'ui.comms.045',
  民间: 'ui.comms.046',
  系统: 'ui.comms.047',
  // 2026-09-30 新增（黑市用）：枚举里本来就有这一档，只是此前没有势力用过、故缺一条映射
  中立: 'ui.comms.078',
}
/** 内容类型片（数据侧 `CommsKind`：剧情 / 提示 / 委托） */
const COMMS_KIND_ID: Record<string, string> = {
  剧情: 'ui.comms.048',
  提示: 'ui.comms.049',
  委托: 'ui.comms.050',
}
/** 跳转栏那句说明（数据侧 `hint.text`，逐句独立） */
const COMMS_HINT_ID: Record<string, string> = {
  [L10N['ui.comms.051']!.zh]: 'ui.comms.051',
  [L10N['ui.comms.052']!.zh]: 'ui.comms.052',
  '星图 · 点选未知信号开始扫描': 'ui.comms.053',
  '星图 · 出发前看清目标星系的安全等级。': 'ui.comms.054',
  '星图 · 残骸打捞页有各星系的残骸存量。': 'ui.comms.055',
  '星图 · 出港 · 「扫描虫洞」标签开始扫描': 'ui.comms.056',
  '星图 · 选「红环航道」查看建站交付。': 'ui.comms.057',
  '舰船页 · 「舰船仓库」可转入舰队或出售': 'ui.comms.058',
  '工业页 · 造一批修理组件，给船装上维修装置': 'ui.comms.059',
  '工业页可以同时开多台炉子。': 'ui.comms.060',
  '技能页可以先把精炼学排进队列。': 'ui.comms.061',
  '副站建成后泊位、维修、补给与换船全部开放。': 'ui.comms.062',
  '前往声望商店兑换': 'ui.Expedition.442',
  '出发前先去装配页检查一遍武器与防护。': 'ui.comms.063',
  '出发前在装配页把对空火力与装甲补齐。': 'ui.comms.064',
  '打之前先去装配页，把对空火力带上。': 'ui.comms.065',
  '想先看看这片星域长什么样？去星图认认路。': 'ui.comms.066',
  // 2026-09-24 船长令「跳到技能页并自动选中工程」：「第一次学习技能」那封信的「前往」改落「技能 · 工程」
  '到「技能」页的「工程」里训练 AI 核心操作学': 'ui.comms.068',
  // 2026-09-25 周末入侵两封（实例通讯）：预警跳星图 · 结算弹面板
  '星图 · 被占星系有红色发光与旗标': 'ui.comms.069',
  查看详细奖励: 'ui.comms.070',
  // 2026-09-30 首访实验室（黑市那封）：跳工业页实验室
  '工业页的实验室能造这两样。': 'ui.comms.077',
}
// l10n-keep-end

/** 立场 / 内容类型 / 跳转说明的本地化取词（查不到原样回落） */
export function commsAlignText(alignment: string): string {
  const id = COMMS_ALIGN_ID[alignment]
  return id !== undefined ? tr(id) : alignment
}
export function commsKindText(kind: string): string {
  const id = COMMS_KIND_ID[kind]
  return id !== undefined ? tr(id) : kind
}
export function commsHintText(text: string): string {
  const id = COMMS_HINT_ID[text]
  return id !== undefined ? tr(id) : text
}

/**
 * **通讯正文的英文**（本批：「第一次」13 封任务信 = 39 行；协会侧 17 封的 58 行与部门简介 `brief` 下一批）。
 *
 * 为什么英文正文放在渲染层：正文里嵌着**玩家可见的物品/技能/舰船名与数值**，要与中文原文**逐行对齐**
 * 整段替换；data / core 继续给中文兜底不动。
 * ⚠ **物品与技能名一律用游戏既有官方英文**（2026-09-22 用临时脚本从"内容 id → `packages/data/src/l10n.ts`
 * 英文表"导出对照后逐条核对）：Peridotite / Tritanium Alloy / Silvervein Supermetal /
 * Reinforced Mining Laser MK1 / Basic AI core / Skipjack-class Frigate / Flyingfish-class Courier /
 * Krill-class Mining Corvette / Civilian Hull Repair Unit / Civilian Repair Kit /
 * Accelerated Learning / AI Core Operation / Reprocessing / Refining。
 * ⟪文案调整 2026-09-30⟫ 船长令改名：沙猫级 → 磷虾级（本表英文舰名同步）。
 * **⟪文案调整 2026-10-02⟫ 32 条英文整体重写**（船长令「进行落码」）：中文侧在 10-01 两批里改过
 * （船长改稿落地 22 条 ＋ 9 封从零重写），英文没跟上 ⇒ 14 条段数不符（英文界面整封回落中文）、
 * 18 条段数同但内容是改稿前的。本批按**中文现行稿逐段重写**，段数与中文逐条相等。
 *   台账：`docs/roadmap.md` 2026-10-02「本地化尾巴清场」那条（含三处船长裁定）。
 * ⚠ **行数必须与中文逐行对齐**：`commsBodyText()` 在行数不符时**回落到中文**（宁可整段中文，也不许错行串位）。
 */
const COMMS_BODY_EN: Record<string, readonly string[]> = {
  'first-scan': [
    L10N['ui.firstScan.001']!.en,
    L10N['ui.firstScan.002']!.en,
    L10N['ui.firstScan.003']!.en,
  ],
  'first-mine': [
    L10N['ui.firstMine.001']!.en,
    L10N['ui.firstMine.002']!.en,
    L10N['ui.firstMine.003']!.en,
  ],
  'first-refine': [
    L10N['ui.firstRefine.001']!.en,
    L10N['ui.firstRefine.002']!.en,
    L10N['ui.firstRefine.003']!.en,
  ],
  'first-bounty': [
    L10N['ui.firstBounty.001']!.en,
    L10N['ui.firstBounty.002']!.en,
    L10N['ui.firstBounty.003']!.en,
  ],
  'first-repair': [
    L10N['ui.firstRepair.001']!.en,
    L10N['ui.firstRepair.002']!.en,
    L10N['ui.firstRepair.003']!.en,
  ],
  'first-salvage': [
    L10N['ui.firstSalvage.001']!.en,
    L10N['ui.firstSalvage.002']!.en,
    L10N['ui.firstSalvage.003']!.en,
  ],
  'first-skill': [
    L10N['ui.firstSkill.001']!.en,
    L10N['ui.firstSkill.002']!.en,
    L10N['ui.firstSkill.003']!.en,
  ],
  'first-ai': [
    L10N['ui.firstAi.001']!.en,
    L10N['ui.firstAi.002']!.en,
    L10N['ui.firstAi.003']!.en,
  ],
  'first-produce': [
    L10N['ui.firstProduce.001']!.en,
    L10N['ui.firstProduce.002']!.en,
    L10N['ui.firstProduce.003']!.en,
  ],
  'first-order': [
    L10N['ui.firstOrder.001']!.en,
    L10N['ui.firstOrder.002']!.en,
    L10N['ui.firstOrder.003']!.en,
  ],
  'first-ship': [
    L10N['ui.firstShip.001']!.en,
    L10N['ui.firstShip.002']!.en,
    L10N['ui.signalSpace.009']!.en,
  ],
  'first-haul': [
    L10N['ui.firstHaul.001']!.en,
    L10N['ui.firstHaul.002']!.en,
    L10N['ui.signalSpace.010']!.en,
  ],
  'first-wormhole': [
    L10N['ui.signalSpace.011']!.en,
    L10N['ui.signalSpace.012']!.en,
    L10N['ui.signalSpace.013']!.en,
  ],
  // ── 协会侧短札（2026-09-22 第四批；长设定的几封见文件末的挂账注释）──
  'msg-welcome': [
    L10N['ui.commsWelcome.001']!.en,
    L10N['ui.commsWelcome.002']!.en,
  ],
  'msg-survey-memo': [
    L10N['ui.commsSurvey.001']!.en,
    L10N['ui.commsSurvey.002']!.en,
    L10N['ui.commsSurvey.003']!.en,
  ],
  'msg-industry-shift': [
    L10N['ui.commsIndustry.001']!.en,
    L10N['ui.commsIndustry.002']!.en,
    L10N['ui.commsIndustry.003']!.en,
  ],
  'msg-refinery-note': [
    L10N['ui.commsSmelt.001']!.en,
    L10N['ui.commsSmelt.002']!.en,
    L10N['ui.commsSmelt.003']!.en,
  ],
  'msg-salvage-crew': [
    L10N['ui.commsSalvage.001']!.en,
    L10N['ui.commsSalvage.002']!.en,
    L10N['ui.commsSalvage.003']!.en,
    L10N['ui.commsSalvage.004']!.en,
  ],
  'msg-site-thanks': [
    L10N['ui.commsThanks.001']!.en,
    L10N['ui.commsThanks.002']!.en,
    L10N['ui.commsThanks.003']!.en,
  ],
  'msg-redring-outpost': [
    L10N['ui.commsOutpost.001']!.en,
    L10N['ui.commsOutpost.002']!.en,
    L10N['ui.commsOutpost.003']!.en,
    L10N['ui.commsOutpost.004']!.en,
  ],
  'msg-first-ship': [
    L10N['ui.commsFirstship.001']!.en,
    L10N['ui.commsFirstship.002']!.en,
    L10N['ui.commsFirstship.003']!.en,
    L10N['ui.commsFirstship.004']!.en,
  ],
  'msg-wh-siege': [
    L10N['ui.commsSiege.001']!.en,
    L10N['ui.commsSiege.002']!.en,
    L10N['ui.commsSiege.003']!.en,
  ],
  // ⟪文案调整 2026-10-04⟫ 已审三封正文中英同源，沿用现有逐段覆盖与强调索引。
  'msg-lab-contraband': [
    L10N['ui.commsContraband.001']!.en,
    L10N['ui.commsContraband.002']!.en,
    L10N['ui.commsContraband.003']!.en,
    L10N['ui.commsContraband.004']!.en,
    L10N['ui.commsContraband.005']!.en,
  ],
  // ── 长设定文 9 封（2026-09-26 三号补齐 · roadmap L3 尾巴；逐段与中文行数对齐）──
  /**
   * ⟪文案调整 2026-10-04⟫ 开局简报与任务完成信按唯一表逐段读取。
   */
  'msg-briefing': [
    L10N['ui.firstBriefing.001']!.en,
    L10N['ui.firstBriefing.002']!.en,
  ],
  'msg-lowsec-rules': [
    L10N['ui.commsLowsec.001']!.en,
    L10N['ui.commsLowsec.002']!.en,
    L10N['ui.commsLowsec.003']!.en,
  ],
  'msg-wormhole-unlock': [
    L10N['ui.signalSpace.005']!.en,
    L10N['ui.signalSpace.006']!.en,
    L10N['ui.signalSpace.007']!.en,
    L10N['ui.signalSpace.008']!.en,
  ],
  'msg-auro-megastructure': [
    L10N['ui.commsAuro.001']!.en,
    L10N['ui.commsAuro.002']!.en,
    L10N['ui.commsAuro.003']!.en,
    L10N['ui.commsAuro.004']!.en,
  ],
  'msg-exile-swarm': [
    L10N['ui.commsExile.001']!.en,
    L10N['ui.commsExile.002']!.en,
    L10N['ui.commsExile.003']!.en,
  ],
  'msg-wormhole-nebula': [
    L10N['ui.signalSpace.004']!.en,
    L10N['ui.commsNebula.002']!.en,
    L10N['ui.commsNebula.003']!.en,
  ],
  'msg-ambush-retreat': [
    L10N['ui.commsRetreat.001']!.en,
    L10N['ui.commsRetreat.002']!.en,
    L10N['ui.commsRetreat.003']!.en,
    L10N['ui.commsRetreat.004']!.en,
  ],
  'msg-pirate-capture-web': [
    L10N['ui.commsWeb.001']!.en,
    L10N['ui.commsWeb.002']!.en,
    L10N['ui.commsWeb.003']!.en,
    L10N['ui.commsWeb.004']!.en,
  ],
  /** 首匣 → 舰船插件：中文与英文正文同源，安装与出售禁令不变。 */
  'msg-blackbox-plug-unlock': [
    L10N['ui.commsPlug.001']!.en,
    L10N['ui.commsPlug.002']!.en,
    L10N['ui.commsPlug.003']!.en,
  ],
  'msg-cinder-warning': [
    L10N['ui.commsCinder.001']!.en,
    L10N['ui.commsCinder.002']!.en,
    L10N['ui.commsCinder.003']!.en,
  ],
}

// l10n-keep-start：下面这张表的**中文是键**（数据侧 `brief` 悬停说明原文，逐条独立）
/**
 * **部门/势力简介的英文**（本批：13 条 —— 悬停说明 `fromBrief`）。
 * 键 = 数据侧中文简介原文（逐条独立），与名称映射同一套"中文即键"口径。
 */
const COMMS_BRIEF_EN: Record<string, string> = {
  '协会的航道管理部门：登记呼号、发布航线与通行提示。':
    'The Association department for shipping lanes: registers callsigns and issues route and transit notices.',
  '协会的建站部门：负责前哨站立项、施工与并网。':
    'The Association department for construction: handles outpost proposals, works and grid hookup.',
  '协会的星域测绘部门：整理未知信号与已探明星系的资料。':
    'The Association department for surveying: keeps the records on unknown signals and charted systems.',
  '协会的产能管理部门：盯站内工位与生产线，专发产能提醒。':
    'The Association department for output: watches station berths and production lines, and sends production reminders.',
  '协会的精炼技术部门：给矿料与回收炉的产出算账。':
    'The Association department for refining: runs the numbers on ore and recycling output.',
  '协会的技能训练部门：主管技能队列与训练科目登记。':
    'The Association department for training: runs the skill queue and registers training subjects.',
  '协会的结算部门：管酬金、档位与建材结算。':
    'The Association department for settlement: handles pay, tiers and construction material accounts.',
  '协会的航线安全部门：发布危险星区与编队活动提示。':
    'The Association department for route safety: issues notices on dangerous systems and fleet activity.',
  '船自己的舰载信息库：自检后按条目回放记录，情报与建议都由它送达。':
    'The ship’s own onboard archive: after a self-check it replays its records entry by entry, and it is the sender for both intelligence and advice.',
  '信息库按条目重新载入记录的过程：把记下来的事一条条念给你听。':
    'The archive reloading its records entry by entry: reading back what it noted, one item at a time.',
  '章鱼人的官方行业组织，对外自称「协会」：管航道、建站点、定酬金，也训练新手飞行员。':
    'The official octopus trade body, calling itself “the Association”: it runs the lanes, builds the outposts, sets the pay, and trains new pilots.',
  '章鱼人的民间行会，与协会同族不同行：一帮在各星系转悠的老打捞，专捡没人要的残骸。':
    'A civilian octopus guild, same people as the Association but a different trade: old salvagers drifting between systems, picking up wreckage nobody else wants.',
  '常年在外圈转的打捞小队，残骸场里的门道比谁都熟。':
    'A salvage crew that works the outer systems year round, and knows the wreck fields better than anyone.',
}

/** 简介（悬停说明）：英文；查不到原样返回中文 */
export function commsBriefText(brief: string): string {
  if (!isEn()) return brief
  return COMMS_BRIEF_EN[brief] ?? brief
}
// l10n-keep-end

/** 正文段落（英文；查不到或行数不符 ⇒ 原样返回中文，绝不错行） */
export function commsBodyText(id: string, paragraphs: readonly string[]): readonly string[] {
  if (!isEn()) return paragraphs
  if (id.startsWith('dlg:')) {
    const spec = COMMS_DIALOGUE_ID[id.slice(4)]
    if (!spec || spec.count !== paragraphs.length) return paragraphs
    const script = commsDialogueText({ id: id.slice(4), title: '', lines: paragraphs.map((text) => ({ speaker: '', text })) })
    return script.lines.map((line) => `${line.speaker}: ${line.text}`)
  }
  const en = COMMS_BODY_EN[id]
  return en !== undefined && en.length === paragraphs.length ? en : paragraphs
}

/* ─────────────── 实例通讯（2026-09-25 · 周末入侵两封） ─────────────── */

/**
 * **实例通讯的参数解析**：`pNId`（参数本身也是一条文案）先渲染好再喂进外层句 ——
 * 与日志 `logText` 的两步渲染同一口径（`i18n/locale.tsx`）。
 */
export function commsInstanceParams(
  params?: Readonly<Record<string, string | number>>,
): Record<string, string | number> {
  const src = params ?? {}
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(src)) {
    if (k.endsWith('Id')) continue
    const ref = src[`${k}Id`]
    out[k] = typeof ref === 'string' ? paramText(ref) : v
  }
  return out
}

/**
 * **奖励清单**（结构化 → 当前语言的一句人话）：物品名由调用方给（走游戏既有物品表 ⇒ 已有官方译名），
 * 分隔符与信用点单位走 `ui.comms.071~073`。空清单 ⇒ `undefined`（调用方保留原文里的那一段）。
 */
export function commsRewardText(
  rewards: readonly CommsRewardLine[] | undefined,
  itemNameOf: (itemId: string) => string,
): string | undefined {
  if (rewards === undefined || rewards.length === 0) return undefined
  return rewards
    .map((r) =>
      r.isk !== undefined
        ? tr('ui.comms.071', { p1: r.isk.toLocaleString() })
        : tr('ui.comms.072', { p1: itemNameOf(r.itemId ?? ''), p2: r.qty ?? 1 }),
    )
    .join(tr('ui.comms.073'))
}

/** 主题行（实例通讯按 `subjectId` 现渲染带参数；表消息走既有 id 映射） */
export function commsEntrySubjectText(
  entry: CommsEntryView,
  itemNameOf: (itemId: string) => string = (id) => id,
): string {
  if (entry.subjectId === undefined) return commsSubjectText(entry.id, entry.subject)
  const params = commsInstanceParams(entry.textParams)
  const list = commsRewardText(entry.rewards, itemNameOf)
  if (list !== undefined) params['p3'] = list
  return tr(entry.subjectId, params)
}

/**
 * 正文段落（实例通讯按 `bodyIds` 逐段现渲染；奖励清单填进 `{p3}` —— **清单由界面按语言拼**，
 * 所以中英各自成句，而数据只有一份）。表消息仍走既有英译映射（行数不符回落中文）。
 */
export function commsEntryBodyText(
  entry: CommsEntryView,
  itemNameOf: (itemId: string) => string = (id) => id,
): readonly string[] {
  if (entry.bodyIds === undefined) return commsBodyText(entry.id, entry.paragraphs)
  const params = commsInstanceParams(entry.textParams)
  const list = commsRewardText(entry.rewards, itemNameOf)
  if (list !== undefined) params['p3'] = list
  return entry.bodyIds.map((id) => tr(id, params))
}
