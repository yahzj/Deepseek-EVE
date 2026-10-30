import { addLog } from '../../state'
import type { CommandResult } from '../../engine'
import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { releaseAiCore } from '../../ai'
import { composeLog, logParamsOf } from '../../logParts'
import { refundClaimedUnits } from './refund'
import { yieldNoteFor } from './yieldNote'

export function stopRefineRun(state: GameState, ctx: SimContext, runId: number): CommandResult {
  const idx = state.refineRuns.findIndex((r) => r.id === runId)
  if (idx < 0) return { ok: false, error: '没有找到该台炉（已停或未启动）。', errorId: 'core.industry.025' }
  const [r] = state.refineRuns.splice(idx, 1)
  const def = r.itemId ? ctx.items.get(r.itemId) : undefined
  const refunded = refundClaimedUnits(state, r)
  if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
  const coreNote = r.worker !== 'pilot' ? '；AI 核心已归还核心库' : ''
  const isRecycle = r.recipe === 'recycle'
  const accNote = r.recAcc ? yieldNoteFor(ctx, r.recAcc, isRecycle ? 'recycle' : 'refine') : null
  const refundName = def?.name ?? r.itemId ?? '未知资源'
  const refundedTxt = `${Math.round(refunded * 100) / 100}`
  const lead = `${isRecycle ? '残骸回收炉' : '精炼炉'}已停：${refundName}（已完成 ${r.batchesDone} 批）`
  const composed = composeLog(
    lead,
    [
      coreNote === '' ? null : { text: coreNote, id: 'core.state.041' },
      accNote && accNote.text !== ''
        ? {
            text: `；${isRecycle ? '回收' : '精炼'}所得：${accNote.text}`,
            id: isRecycle ? 'core.industry.066' : 'core.industry.067',
            params: { p1: accNote.text },
            subs: accNote.parts.map((p) => ({ text: p.text, id: p.id, params: p.params, subs: p.subs })),
          }
        : null,
      // 尾段：退回明细两态（甲案不许可有可无的段——两态各配 id，不留空段）
      refunded > 0
        ? { text: `。未用完的 ${refundName} ${refundedTxt} m³ 已退回物品仓库。`, id: 'core.industry.070', params: { p1: refundName, p2: refundedTxt } }
        : { text: '。原料未锁定无需退回，余料仍留在货仓/仓库。', id: 'core.industry.071' },
    ],
    // 段号从 2 起（段链用专属键空间 seg{n}…，与基础模板的 p1/p2 不同前缀 ⇒ 不会抢号）
  )
  addLog(state, 'industry', composed.text, isRecycle ? 'core.industry.068' : 'core.industry.069', {
    p1: refundName,
    p2: r.batchesDone,
    ...logParamsOf(composed),
  })
  return { ok: true }
}
