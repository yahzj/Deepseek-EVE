import { ceilFinalQuantity } from '../../quantity'
import { matterTechWreckYield } from '../../matterTech'
import { addLog } from '../../state'
import type { GameState } from '../../state'
import { bumpFirst } from '../../firstTasks'
import { wormholeDeliverRelics, wormholeRareBoxThemeGroupsOf, wormholeRareBoxThemePoolOf, wormholeUnboxRoll } from '../../wormholeSalvage'
import { encryptedBlueprintGroups, encryptedFamilyOf } from '../../encryptedContainer'
import type { SimContext } from '../../types'
import { addWare, countItem, countWare, removeItem, removeWare } from '../../inventory'
import { aiCoreName, gainAiCore, releaseAiCore } from '../../ai'
import { shipActuallyDocked } from '../../shipActionPolicy'
import { composeLog, logParamsOf } from '../../logParts'
import { fragmentItemIdOf, isRareWreck, recycleProfileOf, rollRecycleGuarantee, rollRareBoxExtra, rollRecycleLoot, rollRecycleCoreGain } from '../../salvage'
import { addAiIncome, addAiRefineBatch, type SettleStats } from '../../settleStats'
import { refundClaimedUnits } from './refund'
import { industryAvailable, RARE_UNIT_M3, refineBatchOutputOf } from './params'
import { yieldNoteFor } from './yieldNote'

export interface UnboxResultRow {
  boxItemId: string
  grants: readonly { itemId: string; units: number }[]
}

export function advanceRefining(
  state: GameState,
  ctx: SimContext,
  stats?: SettleStats,
  onUnboxResult?: (result: UnboxResultRow) => void,
): void {
  for (let i = state.refineRuns.length - 1; i >= 0; i--) {
    const r = state.refineRuns[i]!
    if (!r.active || r.itemId === null) {
      state.refineRuns.splice(i, 1)
      continue
    }
    const def = ctx.items.get(r.itemId)
    if (!def) {
      refundClaimedUnits(state, r)
      if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
      state.refineRuns.splice(i, 1)
      addLog(state, 'industry', '精炼炉运转异常：资源记录缺失，该台已停（AI 核心已归还）。', 'core.industry.033')
      continue
    }
    let guard = 0
    const isRecycle = r.recipe === 'recycle'
    const isUnbox = r.recipe === 'unbox'
    const profile = isRecycle ? recycleProfileOf(ctx, r.itemId) : null
    if (isRecycle && !profile) {
      refundClaimedUnits(state, r)
      if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
      state.refineRuns.splice(i, 1)
      addLog(state, 'industry', '残骸回收运转异常：残骸来源记录缺失，该台已停（AI 核心已归还）。', 'core.industry.034')
      continue
    }
    {
      const nowUsesClaim = r.claimedUnits !== undefined
      const nowStock = nowUsesClaim ? Math.max(0, r.claimedUnits ?? 0) : industryAvailable(state, ctx, r.itemId)
      const nowAvail = r.lockUnits !== undefined ? Math.min(nowStock, r.lockUnits) : nowStock
      if (nowAvail < r.batchUnits && r.finishAtGameMs > state.gameMs) r.finishAtGameMs = state.gameMs
    }
    while (r.active && state.gameMs >= r.finishAtGameMs) {
      if (++guard > 100_000) break
      const usesClaim = r.claimedUnits !== undefined
      const stock = usesClaim ? Math.max(0, r.claimedUnits ?? 0) : industryAvailable(state, ctx, r.itemId)
      const avail = r.lockUnits !== undefined ? Math.min(stock, r.lockUnits) : stock
      if (avail <= 0) {
        const doneBatches = r.batchesDone
        const lockDone = r.lockUnits !== undefined && (usesClaim || stock > 0)
        refundClaimedUnits(state, r)
        if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
        const wasCore = r.worker !== 'pilot'
        const accNote = r.recAcc ? yieldNoteFor(ctx, r.recAcc, isRecycle ? 'recycle' : 'refine') : null
        state.refineRuns.splice(i, 1)
        const coreSeg = wasCore ? { text: '；AI 核心已归还核心库', id: 'core.state.041' } : null
        const yieldSeg =
          accNote && accNote.text !== ''
            ? {
                text: `；${isRecycle ? '回收' : '精炼'}所得：${accNote.text}`,
                id: isRecycle ? 'core.industry.066' : 'core.industry.067',
                params: { p1: accNote.text },
                subs: accNote.parts.map((p) => ({ text: p.text, id: p.id, params: p.params, subs: p.subs })),
              }
            : null
        if (lockDone) {
          const composed = composeLog(
            `残骸回收炉停：${def.name} 本炉料账已烧完（共 ${doneBatches} 批）`,
            [
              yieldSeg,
              coreSeg,
              {
                text: `；不足 ${RARE_UNIT_M3} m³（一个回收单元）的零头不预占、不产出，留在货仓/仓库；想继续就再起一炉。`,
                id: 'core.industry.073',
                params: { p1: RARE_UNIT_M3 },
              },
            ],
          )
          addLog(state, 'industry', composed.text, 'core.industry.072', { p1: def.name, p2: doneBatches, ...logParamsOf(composed) })
        } else {
          const stopTitle = isUnbox
            ? `货柜拆解停：${def.name}`
            : isRecycle
              ? `残骸回收炉停：${def.name}`
              : `精炼炉停：${def.name}`
          const stopWhy = isUnbox ? `货柜已拆完（共 ${doneBatches} 件）` : `原料耗尽（共 ${doneBatches} 批）`
          const composed = composeLog(`${stopTitle} ${stopWhy}`, [yieldSeg, coreSeg, { text: '。', id: 'core.state.042' }])
          addLog(state, 'industry', composed.text, isUnbox ? 'core.industry.075' : isRecycle ? 'core.industry.076' : 'core.industry.077', {
            p1: def.name,
            p2: doneBatches,
            ...logParamsOf(composed),
          })
        }
        break
      }
      if (avail < r.batchUnits) {
        const doneBatches = r.batchesDone
        refundClaimedUnits(state, r)
        if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
        const wasCore = r.worker !== 'pilot'
        const accNote = r.recAcc ? yieldNoteFor(ctx, r.recAcc, isRecycle ? 'recycle' : 'refine') : null
        const remainTxt = isRecycle ? `${Math.round(avail * 100) / 100} m³` : `${avail} 单位`
        const unitTxt = isRecycle ? 'm³' : '单位'
        state.refineRuns.splice(i, 1)
        const composed = composeLog(
          `${isRecycle ? `残骸回收炉停：${def.name}` : `精炼炉停：${def.name}`} 余量不足一批（每批 ${r.batchUnits}${isRecycle ? ' m³' : ' 单位'}，余 ${remainTxt}）——已完成 ${doneBatches} 批`,
          [
            accNote && accNote.text !== ''
              ? {
                  text: `；${isRecycle ? '回收' : '精炼'}所得：${accNote.text}`,
                  id: isRecycle ? 'core.industry.066' : 'core.industry.067',
                  params: { p1: accNote.text },
                  subs: accNote.parts.map((p) => ({ text: p.text, id: p.id, params: p.params, subs: p.subs })),
                }
              : null,
            wasCore
              ? { text: '，已停工、余料保留在货仓/仓库（凑够一批可再开）', id: 'core.industry.078' }
              : { text: '，已停工、余料保留在货仓/仓库（凑够一批可再开）。', id: 'core.industry.079' },
            wasCore ? { text: '；AI 核心已归还核心库。', id: 'core.state.040' } : null,
          ],
        )
        addLog(state, 'industry', composed.text, isRecycle ? 'core.industry.074' : 'core.industry.083', {
          p1: def.name,
          p2: r.batchUnits,
          p3: unitTxt,
          p4: remainTxt,
          p5: doneBatches,
          ...logParamsOf(composed),
        })
        break
      }
      const encryptedFamily = isUnbox && r.itemId ? encryptedFamilyOf(r.itemId) : null
      if (encryptedFamily && !encryptedBlueprintGroups(ctx, encryptedFamily)) {
        refundClaimedUnits(state, r)
        if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
        state.refineRuns.splice(i, 1)
        addLog(state, 'warn', '', 'core.encrypted.001')
        break
      }
      const qty = r.batchUnits
      if (r.lockUnits !== undefined) r.lockUnits -= qty
      if (usesClaim) {
        r.claimedUnits = Math.max(0, (r.claimedUnits ?? 0) - qty)
      } else {
        const fromCargo = shipActuallyDocked(state, ctx) ? Math.min(countItem(state, r.itemId), qty) : 0
        if (fromCargo > 0) removeItem(state, r.itemId, fromCargo)
        const fromWare = qty - fromCargo
        if (fromWare > 0) removeWare(state, r.itemId, fromWare)
      }
      let batchIncome = 0
      if (isUnbox && r.itemId) {
        const drawn = wormholeUnboxRoll(state, ctx, r.itemId)
        if (drawn) {
          const grants = [{ itemId: drawn.itemId, units: drawn.units }, ...(drawn.extra ?? [])]
          const receivedCount = (id: string): number => ctx.modules.has(id) ? state.moduleBay[id] ?? 0
            : ctx.blueprints.has(id) || ctx.shipBlueprints.has(id) ? state.blueprintStock[id] ?? 0 : countWare(state, id)
          const beforeGrants = onUnboxResult ? new Map(grants.map(g => [g.itemId, receivedCount(g.itemId)])) : null
          wormholeDeliverRelics(
            state,
            ctx,
            grants.map((g) => g.itemId),
            Object.fromEntries(grants.map((g) => [g.itemId, g.units])),
          )
          if (beforeGrants) onUnboxResult?.({
            boxItemId: r.itemId,
            grants: [...beforeGrants].map(([itemId, before]) => ({ itemId, units: receivedCount(itemId) - before }))
              .filter(g => g.units > 0),
          })
          const nameOf = (id: string): string =>
            ctx.modules.get(id)?.name ??
            ctx.blueprints.get(id)?.name ??
            ctx.shipBlueprints.get(id)?.name ??
            ctx.items.get(id)?.name ??
            id
          const agg: Array<{ itemId: string; n: number }> = []
          for (const g of grants) {
            const n = Math.max(1, Math.floor(g.units))
            const hit = agg.find((x) => x.itemId === g.itemId)
            if (hit) hit.n += n
            else agg.push({ itemId: g.itemId, n })
          }
          const drawnName = agg.map((x) => `${nameOf(x.itemId)} ×${x.n}`).join('、')
          const srcTag =
            drawn.source === 'permanent'
              ? '（永久图纸）'
              : drawn.source === 'once'
                ? '（一次性图纸）'
                : drawn.source === 'valuables'
                  ? '（奢侈品）'
                  : drawn.source === 'military'
                    ? '（MK3 装备）'
                    : '（族专属）'
          addLog(state, 'industry', `📦 拆解 ${def.name}：得到 ${drawnName}${srcTag}。`, 'core.industry.035', { p1: def.name, p2: drawnName, p3: srcTag })
        } else {
          onUnboxResult?.({ boxItemId: r.itemId, grants: [] })
          if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
          state.refineRuns.splice(i, 1)
          addLog(state, 'industry', `📦 拆解 ${def.name}：这批料没有产出，已停这一台。`, 'core.industry.036', { p1: def.name })
          break
        }
      } else if (isRecycle && profile) {
        const acc = r.recAcc ?? { min: {}, mod: {}, frag: {} }
        const volumeM3 = qty * def.unitM3
        const guaranteeMul = 1 + matterTechWreckYield(state, ctx)
        const outRaw = rollRecycleGuarantee(state, ctx, profile, volumeM3)
        const out = guaranteeMul > 1 ? outRaw.map((r) => ({ ...r, units: ceilFinalQuantity(r.units * guaranteeMul) })) : outRaw
        for (const row of out) addWare(state, row.mineralId, row.units)
        batchIncome += out.reduce((s, row) => s + row.units * (ctx.items.get(row.mineralId)?.baseSellPriceIsk ?? 0), 0)
        const burnedBefore = isRareWreck(r.itemId) ? (state.rareBurnUnits[r.itemId] ?? 0) : 0
        const burnedAfter = burnedBefore + qty
        const rarePayout = profile.rare === true && Math.floor(burnedAfter / RARE_UNIT_M3) > Math.floor(burnedBefore / RARE_UNIT_M3)
        if (rarePayout) {
          if (r.itemId) state.rareBoxesOpened[r.itemId] = (state.rareBoxesOpened[r.itemId] ?? 0) + 1
          bumpFirst(state, 'rareBoxes')
          const extra = rollRareBoxExtra(
            state,
            ctx,
            profile,
            wormholeRareBoxThemePoolOf(ctx, profile.region),
            wormholeRareBoxThemeGroupsOf(ctx, profile.region),
          )
          if (extra) {
            for (const modId of extra.modules) {
              state.moduleBay[modId] = (state.moduleBay[modId] ?? 0) + 1
              acc.mod[modId] = (acc.mod[modId] ?? 0) + 1
              for (const g of ctx.marketGoods.values()) {
                if (g.kind === 'module' && g.refId === modId) {
                  batchIncome += g.basePrice ?? 0
                  break
                }
              }
            }
            for (const row of extra.drones) {
              addWare(state, row.id, row.count)
              acc.drone = acc.drone ?? {}
              acc.drone[row.id] = (acc.drone[row.id] ?? 0) + row.count
              batchIncome += row.count * (ctx.items.get(row.id)?.baseSellPriceIsk ?? 0)
            }
            for (const bpId of extra.blueprints) {
              state.blueprintStock[bpId] = (state.blueprintStock[bpId] ?? 0) + 1
              acc.blueprint = acc.blueprint ?? {}
              acc.blueprint[bpId] = (acc.blueprint[bpId] ?? 0) + 1
              for (const g of ctx.marketGoods.values()) {
                if (g.kind === 'blueprint' && g.refId === bpId) {
                  batchIncome += g.basePrice ?? 0
                  break
                }
              }
            }
            for (const row of extra.minerals) {
              addWare(state, row.mineralId, row.units)
              acc.min[row.mineralId] = (acc.min[row.mineralId] ?? 0) + row.units
              batchIncome += row.units * (ctx.items.get(row.mineralId)?.baseSellPriceIsk ?? 0)
            }
            addLog(state, 'industry', `✦ 额外战利品：稀有残骸解体必给——${extra.note}。`, 'core.industry.037', { p1: extra.note })
          }
        }
        const loot = rollRecycleLoot(state, ctx, profile, qty)
        for (const modId of loot.modules) state.moduleBay[modId] = (state.moduleBay[modId] ?? 0) + 1
        const modCount = new Map<string, number>()
        for (const m of loot.modules) modCount.set(m, (modCount.get(m) ?? 0) + 1)
        for (const [modId, n] of modCount) {
          for (const g of ctx.marketGoods.values()) {
            if (g.kind === 'module' && g.refId === modId) {
              batchIncome += n * (g.basePrice ?? 0)
              break
            }
          }
        }
        const fragUnits = new Map<string, number>()
        for (const m of loot.fragments) fragUnits.set(m, (fragUnits.get(m) ?? 0) + 1)
        for (const [m, n] of fragUnits) addWare(state, fragmentItemIdOf(m), n)
        for (const row of out) acc.min[row.mineralId] = (acc.min[row.mineralId] ?? 0) + row.units
        for (const modId of loot.modules) acc.mod[modId] = (acc.mod[modId] ?? 0) + 1
        for (const [m, n] of fragUnits) acc.frag[m] = (acc.frag[m] ?? 0) + n
        const coreGain = rollRecycleCoreGain(r.itemId ?? '', r.batchesDone + 1)
        if (coreGain !== undefined) {
          gainAiCore(state, coreGain, 1)
          const coreName = aiCoreName(coreGain)
          addLog(state, 'industry', `✦ 额外产出：${coreName} ×1。`, 'core.industry.045', {
            p1: coreName,
            p2: '1',
          })
        }
        r.recAcc = acc
      } else {
        const acc = r.recAcc ?? { min: {}, mod: {}, frag: {} }
        for (const out of refineBatchOutputOf(state, ctx, def, qty)) {
          const mineral = ctx.items.get(out.mineralId)
          addWare(state, out.mineralId, out.units)
          acc.min[out.mineralId] = (acc.min[out.mineralId] ?? 0) + out.units
          batchIncome += out.units * (mineral?.baseSellPriceIsk ?? 0)
        }
        r.recAcc = acc
      }
      if (r.worker !== 'pilot' && stats) {
        addAiRefineBatch(stats, r.worker, isRecycle)
        if (batchIncome > 0) addAiIncome(stats, r.worker, batchIncome)
      }
      r.batchesDone += 1
      if (!isRecycle) bumpFirst(state, 'refineBatches')
      if (isRecycle && r.itemId) {
        state.rareBurnUnits[r.itemId] = (state.rareBurnUnits[r.itemId] ?? 0) + qty
      }
      r.finishAtGameMs += r.cycleMs
      const nextUsesClaim = r.claimedUnits !== undefined
      const nextStock = nextUsesClaim ? Math.max(0, r.claimedUnits ?? 0) : industryAvailable(state, ctx, r.itemId)
      const nextAvail = r.lockUnits !== undefined ? Math.min(nextStock, r.lockUnits) : nextStock
      if (nextAvail < r.batchUnits) {
        r.finishAtGameMs = state.gameMs
        continue
      }
    }
  }
}
