import { countWare, manufacturingLoopOf, matNeedCount, ownsBlueprint, isMarked, recipeCapability, materialGroupIdsOf } from '@whale/core'
import type { MaterialNeed } from '@whale/core'
import type { GameEngine } from '../../game/engine'

/** 一张可制造蓝图的展示卡（与精炼炉卡同款结构：运转名册逐线 = 劳动者 + 进度 + 取消；
 * 开工按钮 = 手动制造（主控亲自）/ AI 核心下拉 + AI 制造；已学会 + 材料够即可随时加开（制造费已于 2026-09-08 取消）） */
/**
 * **卡片的"实时指纹"**（2026-09-22 工业页卡顿修复第 3 步）。
 *
 * 为什么需要它：面板每秒被引擎心跳强刷 1~2 次，整棵卡片列表跟着重算/重提交（组装机 151 张 = 8298 节点，
 * 实测挂机就吃掉 35% 主线程、弱机直接吃满）。有了这张指纹 + 卡片上的 `memo`，
 * 心跳只让**自己这几个数真的变了**的那几张卡重渲染。
 *
 * ⚠ **改卡片时若新增了"随心跳变"的读数，必须同步加进这里**，否则那张卡会停在旧值上（界面不刷新）。
 * 下面的分节注释逐条对应卡面上的显示位置，方便对照：
 * - `mats`  ：材料行的「（仓库 N）」与 `is-short` 红标、以及按钮的可用性（`short`）；
 * - `needs` ：材料学折扣后的需求量与净收益估算（随科技变）；
 * - `runs`  ：制造线名册（条数 / 剩余 / 进度条 / 劳动者）；
 * - `loop`  ：循环制造的开关、已产批数、停因；
 * - `own`   ：产物「（×× N）」那一格；
 * - `bp`    ：已学会 / 蓝图书存量 / 一次性名额（`cap.kind`）——决定卡头徽标与底部按钮是哪一支；
 * - `mark`  ：收藏星标（子组件 `MarkStar` 自己也读 `engine.state`，不能漏）。
 */
export function cardLiveKeyOf(
  engine: GameEngine,
  blueprintId: string,
  materials: readonly MaterialNeed[],
  /** 该蓝图制造线的指纹（`制造线id.剩余秒.进度%.劳动者` 串起来）——由面板一次归并好传进来，
   *  免得 151 张卡各自把全部制造线算一遍（O(卡×线)） */
  runSig: string,
  /** 产物持有量（各卡不同，取自模型里的 `countOwned` 闭包） */
  ownedCount: number,
): string {
  const state = engine.state
  /**
   * ⚠ 材料读数按**等价组合计**（`materialGroupIdsOf`）——与卡面那行（`CardMats`）**同一把尺**：
   * 只数"配方写的那个 id"的话，玩家把旗舰黑匣换成通用黑匣时**指纹不变** ⇒ React 认为卡片没变、
   * 不重画 ⇒ 卡面停在旧读数（2026-09-29 那批报障的连带风险）。
   */
  const mats = materials
    .map((m) => materialGroupIdsOf(m.itemId).reduce((sum, id) => sum + countWare(state, id), 0))
    .join(',')
  const needs = materials.map((m) => matNeedCount(state, m.count, blueprintId)).join(',')
  const loop = manufacturingLoopOf(state, blueprintId)
  const singleUse =
    engine.ctx.blueprints.get(blueprintId)?.singleUse === true || engine.ctx.shipBlueprints.get(blueprintId)?.singleUse === true
  const bp = `${ownsBlueprint(state, blueprintId) ? 1 : 0}.${state.blueprintStock[blueprintId] ?? 0}.${recipeCapability(state, blueprintId, singleUse).kind}`
  const mark = isMarked(state, 'blueprints', blueprintId) ? 1 : 0
  return `${mats}#${needs}#${runSig}#${loop.on ? 1 : 0}.${loop.produced}.${loop.stopWhy}#${bp}#${mark}#${ownedCount}`
}
