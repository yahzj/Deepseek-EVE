/** 隔离命中曲线候选，仅由预演bundle/用例调用，正式core不引用。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-05。
 */
export type PreviewCurve = 'current' | 'multiply' | 'soft'
export const PREVIEW_CURVES: readonly PreviewCurve[] = ['current', 'multiply', 'soft']

export function previewProbability(curve: PreviewCurve, aim: number, evasion: number, distanceFactor: number): number {
  if (curve === 'current') throw new Error('现行概率必须调用原引擎函数')
  const e = Math.max(0, Math.min(0.9, evasion))
  const a = Math.max(0, aim)
  const effectiveEvasion = curve === 'soft' ? e / (1 + Math.max(0, a - 1)) : e
  return Math.max(0, Math.min(1, Math.min(1, a) * distanceFactor * (1 - effectiveEvasion)))
}
