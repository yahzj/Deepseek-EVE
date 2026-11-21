import type { LogParams } from './state'

export type LogParamsExtra = Readonly<
  Record<string, string | number | readonly string[] | ReadonlyArray<Readonly<Record<string, string | number>>>>
>

export type LogSeg = {
  text: string
  id?: string
  params?: Record<string, string | number>
  subs?: LogSeg[]
}

export const LIST_SLOT_KEYS = ['List', 'ItemId', 'ItemParams'] as const

export const LIST_SEP_ID = 'core.state.043'

export function composeLog(
  lead: string,
  segs: Array<LogSeg | null | undefined>,
  firstSegNo = 2,
): { text: string; textParams: Record<string, string | number>; parts: string[] } {
  const start = Math.max(2, firstSegNo)
  const kept = segs.filter((s): s is LogSeg => !!s && s.text !== '')
  const textParams: Record<string, string | number> = {}
  if (kept.some(seg => seg.subs?.length)) textParams.segCount = kept.length
  const walk = (seg: LogSeg, prefix: string): void => {
    if (seg.id !== undefined) textParams[`seg${prefix}Id`] = seg.id
    if (seg.subs?.length) textParams[`seg${prefix}Subs`] = seg.subs.length
    let k = 0
    for (const [key, value] of Object.entries(seg.params ?? {})) {
      if (/^p\d+p\d+$/.test(key) || /^(p\d+)Id$/.test(key)) {
        textParams[`seg${prefix}${key}`] = value
        continue
      }
      k += 1
      textParams[`seg${prefix}p${k}`] = value
    }
    for (const [j, sub] of (seg.subs ?? []).entries()) walk(sub, `${prefix}p${j + 1}`)
  }
  for (const [i, seg] of kept.entries()) walk(seg, String(start + i))
  const parts = kept.map((s) => s.id).filter((id): id is string => id !== undefined)
  return { text: lead + kept.map((s) => s.text).join(''), textParams, parts }
}

export function logParamsOf(
  composed: { textParams: Record<string, string | number>; parts: string[] },
  extra?: LogParamsExtra,
): LogParams {
  return {
    ...composed.textParams,
    ...(composed.parts.length > 0 ? { parts: composed.parts } : {}),
    ...(extra ?? {}),
  } as unknown as LogParams
}

export function logParams(extra?: LogParamsExtra): LogParams {
  return { ...(extra ?? {}) } as unknown as LogParams
}
