/**
 * 启动工序与自检代号：页面载入进度、失败代号、诊断文本的唯一来源。
 * 玩家可见文案在 packages/data/src/l10n/table.ts（ui.boot.001-213）；
 * 预置包阶段的 SG-01/02/03 由 web/public/boot.js 直接显示（那时业务包还没加载），
 * 代号对照与排查口径见 docs/boot-codes.md。
 */

export type BootStageId =
  | 'wake'
  | 'sync'
  | 'lock'
  | 'probe'
  | 'read'
  | 'verify'
  | 'settle'
  | 'persist'
  | 'bridge'

export type BootCodeId =
  | 'SG-01'
  | 'SG-02'
  | 'SG-03'
  | 'SG-04'
  | 'SG-05'
  | 'SG-06'
  | 'SG-07'
  | 'SG-08'
  | 'SG-09'
  | 'SG-FF'

export interface BootStageDef {
  readonly id: BootStageId
  readonly labelKey: string
  /** 该工序完成后的整体进度（0-100），只在真实完成时前进 */
  readonly percent: number
  readonly slowMs: number
  readonly failMs: number
  readonly failCode: BootCodeId | null
}

export const BOOT_STAGES: readonly BootStageDef[] = [
  { id: 'wake', labelKey: 'ui.boot.001', percent: 4, slowMs: 0, failMs: 0, failCode: null },
  { id: 'sync', labelKey: 'ui.boot.002', percent: 20, slowMs: 0, failMs: 0, failCode: null },
  { id: 'lock', labelKey: 'ui.boot.003', percent: 30, slowMs: 5000, failMs: 15000, failCode: 'SG-05' },
  { id: 'probe', labelKey: 'ui.boot.004', percent: 38, slowMs: 4000, failMs: 15000, failCode: 'SG-04' },
  { id: 'read', labelKey: 'ui.boot.005', percent: 58, slowMs: 6000, failMs: 25000, failCode: 'SG-06' },
  { id: 'verify', labelKey: 'ui.boot.006', percent: 68, slowMs: 8000, failMs: 30000, failCode: 'SG-09' },
  { id: 'settle', labelKey: 'ui.boot.007', percent: 84, slowMs: 8000, failMs: 45000, failCode: 'SG-07' },
  { id: 'persist', labelKey: 'ui.boot.008', percent: 92, slowMs: 6000, failMs: 25000, failCode: 'SG-08' },
  { id: 'bridge', labelKey: 'ui.boot.009', percent: 100, slowMs: 8000, failMs: 30000, failCode: 'SG-09' },
]

export interface BootCodeDef {
  readonly titleKey: string
  readonly adviceKey: string
}

export const BOOT_CODES: Readonly<Record<BootCodeId, BootCodeDef>> = {
  'SG-01': { titleKey: 'ui.boot.101', adviceKey: 'ui.boot.102' },
  'SG-02': { titleKey: 'ui.boot.103', adviceKey: 'ui.boot.104' },
  'SG-03': { titleKey: 'ui.boot.105', adviceKey: 'ui.boot.106' },
  'SG-04': { titleKey: 'ui.boot.107', adviceKey: 'ui.boot.108' },
  'SG-05': { titleKey: 'ui.boot.109', adviceKey: 'ui.boot.110' },
  'SG-06': { titleKey: 'ui.boot.111', adviceKey: 'ui.boot.112' },
  'SG-07': { titleKey: 'ui.boot.113', adviceKey: 'ui.boot.114' },
  'SG-08': { titleKey: 'ui.boot.115', adviceKey: 'ui.boot.116' },
  'SG-09': { titleKey: 'ui.boot.117', adviceKey: 'ui.boot.118' },
  'SG-FF': { titleKey: 'ui.boot.119', adviceKey: 'ui.boot.120' },
}

export function bootStageIndexOf(id: BootStageId): number {
  const index = BOOT_STAGES.findIndex((stage) => stage.id === id)
  return index < 0 ? 0 : index
}

/** 已完成工序的进度；当前工序进行中时停在上一道工序的完成值 */
export function bootCompletedPercentOf(id: BootStageId): number {
  const index = bootStageIndexOf(id)
  return index <= 0 ? 0 : BOOT_STAGES[index - 1]!.percent
}

export function bootStageDefOf(id: BootStageId): BootStageDef {
  return BOOT_STAGES[bootStageIndexOf(id)]!
}

export interface BootDiagnosticsInput {
  code: BootCodeId
  stageId: BootStageId | null
  /** 已经翻译好的工序名；预置包阶段传「引擎包同步」 */
  stageLabel: string
  elapsedMs: number
  detail?: string
  saveBytes?: number | null
}

function versionLines(): string[] {
  const build = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
  const sha = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev'
  const time = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '—'
  return ['版本：' + build + ' · 构建 ' + sha + ' · ' + time]
}

/** 反馈与排查用的诊断文本：玩家一键提交或复制给管理员 */
export function formatBootDiagnostics(input: BootDiagnosticsInput): string {
  const seconds = (input.elapsedMs / 1000).toFixed(1)
  const lines = [
    '【载入失败】自检代号 ' + input.code,
    '卡住工序：' + input.stageLabel,
    '已等待：' + seconds + ' 秒',
    ...versionLines(),
    '平台：' + (typeof window !== 'undefined' && window.whale !== undefined ? 'desktop' : 'web'),
  ]
  if (typeof window !== 'undefined') {
    lines.push('地址：' + window.location.origin + window.location.pathname)
    lines.push('联网：' + (navigator.onLine ? '在线' : '离线'))
    lines.push('浏览器：' + navigator.userAgent)
  }
  if (input.saveBytes !== undefined && input.saveBytes !== null) {
    lines.push('存档大小：约 ' + (input.saveBytes / 1024).toFixed(0) + ' KB')
  }
  if (input.detail !== undefined && input.detail !== '') lines.push('详情：' + input.detail)
  return lines.join('\n')
}
