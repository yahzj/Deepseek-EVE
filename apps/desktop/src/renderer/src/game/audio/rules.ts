/**
 * **音效纯规则**（不碰 DOM、不碰存储；`tools/audio-check.ts` 直接跑这些函数的确定性用例）。
 *
 * 分三块：
 * 1. 音量与偏好：总音量 × 分类音量 × 单音效增益；被静音时恒 0；
 * 2. 触发匹配：`state.logs` 的 `(kind, textId)` → 语义 id；素材文件名 → 语义 id；
 * 3. 生产进度：只读精炼炉 `batchesDone` / 实验室 `finishAtGameMs` 的增量（本批"批次完成"音效来源）。
 */
import { SFX_CATEGORIES, SFX_CUES, SFX_CUE_IDS } from './cues'
import type { SfxCategory, SfxCueId } from './cues'

/* ═══════════════ 音量与偏好 ═══════════════ */

export interface SfxCategoryVolumes {
  alarm: number
  combat: number
  progress: number
  ui: number
  music: number
  ambient: number
}

export interface SfxPrefs {
  muted: boolean
  master: number
  categories: SfxCategoryVolumes
  /**
   * 战斗重复音的**音高随机幅度（音分）**：0 = 关；默认 100（= ±1 个半音，船长 2026-11-02 口径
   * 「1200 音分的单位里上下浮动 100 音分」）。只作用于带 `pitchJitter` 标记的 cue。
   */
  pitchJitterCents: number
}

/** 音高随机幅度上限（音分）：= 1 个半音 */
export const PITCH_JITTER_MAX_CENTS = 100

/**
 * **淡变时长（毫秒）——音频层唯一来源**（2026-11-04 调音效台批次）：
 * - BGM 场景切换 2.5s 自动交叉淡入淡出（船长原话「否则切歌突兀」）；
 * - 环境底噪保持 1.5s（原值，跟 BGM 同款引擎）；
 * - 同曲调音量/静音 250ms 短淡变（拖滑条不跟着慢淡变）。
 * `music.ts` / `ambient.ts` / `loops.ts` 与 `tools/audio-check.ts` 共用这三个常量。
 */
export const BGM_CROSSFADE_MS = 2500
export const AMBIENT_CROSSFADE_MS = 1500
export const VOLUME_FADE_MS = 250

/**
 * 默认偏好（**船长 2026-11-05 指定**：总音量 100%、初始不静音；
 * 音乐 15% / 环境 50% / 警报 70% / 战斗 100% / 生产 50% / 界面 50%；战斗音高 ±100 音分）。
 * 已存过偏好的档沿用存档值，这里只影响首次安装与「恢复默认」。
 */
export function defaultSfxPrefs(): SfxPrefs {
  return {
    muted: false,
    master: 1,
    categories: { music: 0.15, ambient: 0.5, alarm: 0.7, combat: 1, progress: 0.5, ui: 0.5 },
    pitchJitterCents: PITCH_JITTER_MAX_CENTS,
  }
}

/** 音量钳制（0～1；非有限数按 0 处理，避免 NaN 静默污染） */
export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

/** 音高抖动幅度钳制（0～100 音分，取整数） */
export function clampPitchJitter(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(PITCH_JITTER_MAX_CENTS, Math.max(0, Math.round(v)))
}

/** 宽容读取本机存下的 JSON（坏了按默认；逐字段钳制，不因一个坏字段整份作废） */
export function parseSfxPrefs(raw: string | null | undefined): SfxPrefs {
  const def = defaultSfxPrefs()
  if (typeof raw !== 'string' || raw === '') return def
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return def
  }
  if (typeof parsed !== 'object' || parsed === null) return def
  const o = parsed as Record<string, unknown>
  const rawCats = (typeof o.categories === 'object' && o.categories !== null ? o.categories : {}) as Record<string, unknown>
  const categories = { ...def.categories }
  for (const c of SFX_CATEGORIES) {
    const v = rawCats[c]
    if (typeof v === 'number') categories[c] = clampVolume(v)
  }
  return {
    muted: o.muted === true,
    master: typeof o.master === 'number' ? clampVolume(o.master) : def.master,
    categories,
    pitchJitterCents:
      typeof o.pitchJitterCents === 'number' ? clampPitchJitter(o.pitchJitterCents) : def.pitchJitterCents,
  }
}

/** 实际播放增益 = 总音量 × 分类音量 × 单音效增益（静音恒 0；音量都为 0 时也是 0） */
export function effectiveGain(cueId: SfxCueId, prefs: SfxPrefs): number {
  if (prefs.muted) return 0
  const cue = SFX_CUES[cueId]
  if (!cue) return 0
  const cat = clampVolume(prefs.categories[cue.category])
  const master = clampVolume(prefs.master)
  return clampVolume(master * cat * cue.gain)
}

/**
 * 播放速率 = 音高随机。`±cents` 音分对应频率比 `2^(±cents/1200)`（1200 音分 = 1 个八度）。
 * `cents <= 0` 或随机源异常 ⇒ 1（原调）。调用方需同时把 `preservesPitch` 设为 false 才会真的变调
 * （浏览器默认 true = 只变速不变调，2026-11-02 实测）。
 */
export function pitchRateFor(cents: number, random: () => number): number {
  const limit = clampPitchJitter(cents)
  if (limit <= 0) return 1
  const raw = random()
  const unit = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) * 2 - 1 : 0
  return Math.pow(2, (unit * limit) / 1200)
}

/** 同一音效的最短间隔判定（上次播放时刻缺省 = 可以播） */
export function shouldPlay(lastAtMs: number | undefined, nowMs: number, minGapMs: number): boolean {
  if (lastAtMs === undefined) return true
  return nowMs - lastAtMs >= Math.max(0, minGapMs)
}

/** 分类名 id（音效台/设置展示用） */
export function categoryIds(): readonly SfxCategory[] {
  return SFX_CATEGORIES
}

/* ═══════════════ 触发匹配：日志 ═══════════════ */

/**
 * 一条日志规则的形状：
 * - `cue`：命中的语义音效；
 * - `minParam`：**可选参数闸**——该 `textParams` 键的数值必须 > 0 才播。
 *   用于"停炉/停工日志"：只有真的做完过批次（p2 / p5 = 已完成批数）才算"生产完成"，
 *   起炉即停（0 批）不播。
 */
export interface LogCueRule {
  cue: SfxCueId
  minParam?: string
}

/**
 * 日志 → 音效的**精确 id 规则**（2026-11-02 按现实日志核实；只读日志，不改 core）。
 *
 * 三条纪律：
 * 1. **不按 kind 兜底**：`trade` 类里混着"制造开始/挂单/撤单/提示"等非成交日志（且有些没 textId），
 *    按分类兜底会大面积误报 ⇒ 成交类也只认精确 id（下表的 `trade-done` 白名单）；
 * 2. **加规则前先确认这条日志真的会在该事件发生**：文案见 `packages/data/src/l10n/table.ts`，
 *    写入点用 `rg "core\.⟨域⟩\.⟨号⟩" packages/core/src` 定位；`npm run audio:check` 会扫
 *    "规则 id 是否出现在 core 的 addLog 附近"，防再出现「文案表有、日志没写过」的死规则；
 * 3. **尾批要能从日志补到**：精炼炉/回收炉"最后一炉"在**同一次推进里**完成并移除（进度快照看不到），
 *    实验室默认"一批一线"交付后也立刻移除 ⇒ 这些用它们的**批产/停炉日志**补，见下。
 */
export const LOG_CUE_RULES: Readonly<Record<string, LogCueRule>> = {
  // 训练完成（core 的训练队列）
  'core.engine.002': { cue: 'skill-done' },
  // 星系扫描完成（首次 / 补扫）与发现信号空间
  'core.explore.008': { cue: 'scan-done' },
  'core.explore.009': { cue: 'scan-done' },
  'core.explorationStatus.001': { cue: 'scan-done' },
  // 建成：首座空间站并网 / 副站交付达成「建成」档
  // ⚠ 星球环境改造完成（msg-planet-home）只有**通讯正文 id**、不写日志 ⇒ 现没有 build-done 触发，
  //   属已知缺口（玩家收讯时会有 comms-received）；要补需 core 侧另加日志，本批不碰 core。
  'core.station.014': { cue: 'build-done' },
  'core.location.052': { cue: 'build-done' },
  // 制造完成（装备库 / 物品仓库）
  'core.manufacturing.014': { cue: 'industry-done' },
  'core.manufacturing.015': { cue: 'industry-done' },
  // 实验室出料（每批一条；默认"一批一线"与循环续做都走它 ⇒ 尾批不漏）
  'core.lab.023': { cue: 'industry-done' },
  // 精炼炉 / 回收炉 / 拆解台的**尾批**：停炉日志带"已完成批数"（p2 批 / p5 批），>0 才播
  'core.industry.072': { cue: 'industry-done', minParam: 'p2' },
  'core.industry.075': { cue: 'industry-done', minParam: 'p2' },
  'core.industry.076': { cue: 'industry-done', minParam: 'p2' },
  'core.industry.077': { cue: 'industry-done', minParam: 'p2' },
  'core.industry.074': { cue: 'industry-done', minParam: 'p5' },
  'core.industry.083': { cue: 'industry-done', minParam: 'p5' },
  // 成交/入账白名单（不含挂单、撤单、无现货提示、制造开始、建站并网）
  'core.ai.009': { cue: 'trade-done' },
  'core.blackMarket.008': { cue: 'trade-done' },
  'core.expedition.038': { cue: 'trade-done' },
  'core.expedition.047': { cue: 'trade-done' },
  'core.industrial.004': { cue: 'trade-done' },
  'core.market.022': { cue: 'trade-done' },
  'core.market.023': { cue: 'trade-done' },
  'core.market.024': { cue: 'trade-done' },
  'core.market.027': { cue: 'trade-done' },
  'core.market.029': { cue: 'trade-done' },
  'core.market.031': { cue: 'trade-done' },
  'core.shipyard.025': { cue: 'trade-done' },
  'core.skillLicense.006': { cue: 'trade-done' },
  'core.weekend.001': { cue: 'trade-done' },
  'core.weekend.002': { cue: 'trade-done' },
  'core.weekend.043': { cue: 'trade-done' },
  // 操作被拒（2026-11-02 追加 · UI 反馈）：只登记**玩家操作被拒**类 warn 日志，不铺全部 warn。
  // 2026-11-05 船长要求扩大覆盖：主通道改为 `App.showToast(text, warn=true)` → `ui-error`
  //（见 game/audio/uiFeedback.ts 的 notifyUiError）；此白名单保留，服务没有 toast 的读档/自动停止等场景。
  'core.engine.009': { cue: 'ui-error' },
  'core.engine.010': { cue: 'ui-error' },
  'core.skillLicense.005': { cue: 'ui-error' },
  'core.industry.003': { cue: 'ui-error' },
  'core.industry.005': { cue: 'ui-error' },
  'core.manufacturing.001': { cue: 'ui-error' },
}

/** 日志 → 语义 id；只看精确规则（+ 参数闸）。无匹配返回 null（静默） */
export function matchLogCue(
  kind: string,
  textId?: string,
  textParams?: Readonly<Record<string, unknown>>,
): SfxCueId | null {
  void kind // 保留入参：调用方按日志整条传入，规则只认 textId（理由见上"不按 kind 兜底"）
  if (typeof textId !== 'string') return null
  const rule = LOG_CUE_RULES[textId]
  if (rule === undefined) return null
  if (rule.minParam !== undefined) {
    const raw = textParams?.[rule.minParam]
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (!(Number.isFinite(value) && value > 0)) return null
  }
  return rule.cue
}

/* ═══════════════ 触发匹配：素材文件名 ═══════════════ */

const AUDIO_EXT = /\.(mp3|ogg|wav|m4a)$/i

/** 是不是音频文件（音效台拖入时先过滤） */
export function isAudioFileName(fileName: string): boolean {
  return AUDIO_EXT.test(fileName)
}

/** 去扩展名后的小写基名 */
export function sfxFileBase(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '').trim().toLowerCase()
}

/**
 * 素材文件名 → 语义 id：`invasion-alarm.mp3` → `invasion-alarm`；
 * 变体 `invasion-alarm.1.mp3` / `invasion-alarm.2.ogg` → 同一条语义 id（播放时随机取一份）。
 * 对不上（拼错/未知事件）返回 null，由音效台提示。
 */
export function matchSfxFileName(fileName: string): SfxCueId | null {
  if (!isAudioFileName(fileName)) return null
  const base = sfxFileBase(fileName)
  if ((SFX_CUE_IDS as readonly string[]).includes(base)) return base as SfxCueId
  const variant = /^(.+)\.\d+$/.exec(base)
  if (variant && (SFX_CUE_IDS as readonly string[]).includes(variant[1]!)) return variant[1] as SfxCueId
  return null
}

/** 从若干候选里随机取一份（空表 = null；随机源可注入，便于确定性用例） */
export function pickVariant<T>(items: readonly T[], random: () => number): T | null {
  if (items.length === 0) return null
  const raw = random()
  const i = Math.floor((Number.isFinite(raw) ? raw : 0) * items.length)
  return items[Math.min(items.length - 1, Math.max(0, i))] ?? null
}

/**
 * 重抽变体：尽量给一条**与当前不同**的（只有一条候选时原样返回，`current` 不在表里时全表随机）。
 * 用于 BGM「每场新战斗重新随机换曲」（2026-11-05 船长裁定 B），避免抽到原曲导致听感上「没换」。
 */
export function pickOtherVariant<T>(
  items: readonly T[],
  current: T | null,
  random: () => number = Math.random,
): T | null {
  if (items.length === 0) return null
  if (items.length === 1) return items[0] ?? null
  const index = current === null ? -1 : items.indexOf(current)
  const pool = index >= 0 ? items.filter((_, i) => i !== index) : items
  return pickVariant(pool, random)
}

/* ═══════════════ 触发匹配：生产进度 ═══════════════ */

/** 只读投影：精炼炉的已完成批数（按台 id）与实验室当前批的到点时刻（按台 id） */
export interface ProductionSnapshot {
  refine: Record<string, number>
  lab: Record<string, number>
}

interface RefineRunLike {
  id: number
  batchesDone?: number
}

interface LabRunLike {
  id: number
  finishAtGameMs?: number
}

/** 从引擎状态取生产进度快照（只读；不认识的形状按空表） */
export function productionSnapshot(state: {
  refineRuns?: readonly RefineRunLike[]
  labRuns?: readonly LabRunLike[]
}): ProductionSnapshot {
  const refine: Record<string, number> = {}
  for (const run of state.refineRuns ?? []) {
    if (typeof run?.id === 'number') refine[String(run.id)] = typeof run.batchesDone === 'number' ? run.batchesDone : 0
  }
  const lab: Record<string, number> = {}
  for (const run of state.labRuns ?? []) {
    if (typeof run?.id === 'number') lab[String(run.id)] = typeof run.finishAtGameMs === 'number' ? run.finishAtGameMs : 0
  }
  return { refine, lab }
}

/**
 * 上一拍 → 这一拍新增的"批次完成"次数：
 * - 精炼炉：同一台 `batchesDone` 变大；
 * - 实验室：同一台 `finishAtGameMs` 变大（一批交付后重新排下一批的时刻）。
 * 新台/停台都不算完成；返回值 = 本拍应播几次（调用方通常会合并成一次）。
 */
export function productionCompletedCount(prev: ProductionSnapshot | null, next: ProductionSnapshot): number {
  if (prev === null) return 0
  let n = 0
  for (const [id, batches] of Object.entries(next.refine)) {
    const before = prev.refine[id]
    if (before !== undefined && batches > before) n += 1
  }
  for (const [id, finishAt] of Object.entries(next.lab)) {
    const before = prev.lab[id]
    if (before !== undefined && finishAt > before) n += 1
  }
  return n
}
