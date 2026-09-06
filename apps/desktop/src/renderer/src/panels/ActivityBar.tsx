/**
 * T1 顶部活动窗口：常驻显示「玩家活动」与「技能训练」两个分区（各带待机文案），
 * 提供统一终止入口；AI 活动不逐条显示，用 ⚙×N 小图标徽标（点击跳 AI 指挥中心）。
 * 布局：垂直排布，固定高度上限，内容多时内部滚动（船长 2026-09-05）。
 */
import { activityOverview } from '@whale/core'
import type { ActivityView } from '@whale/core'
import { formatDurationMs } from '@whale/core'
import { useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'

const KIND_ICON: Record<string, string> = {
  train: 'nav-skills',
  mining: 'nav-mine',
  scan: 'ico-scan',
  salvage: 'nav-salvage',
  manufacture: 'nav-industry',
  refine: 'nav-industry',
  expedition: 'nav-bounty',
  ai: 'nav-ai',
  return: 'nav-ship',
  transit: 'ico-home',
  loop: 'ico-loop',
  courier: 'nav-task',
}

function stopLabel(v: ActivityView): string {
  switch (v.stop) {
    case 'remove-training':
      return '移除'
    case 'stop-mining':
      return '停止'
    case 'stop-scan':
      return '终止'
    case 'stop-salvage':
      return '停止'
    case 'cancel-manufacture':
      return '取消'
    case 'stop-refine':
      return '停炉'
    case 'recall-expedition':
      return '召回'
    case 'recall-standby':
      return '召回巡逻'
    case 'retreat-battle':
      return '撤退'
    case 'cancel-ai':
      return '取消'
    case 'stop-loop':
      return '停连击'
    default:
      return ''
  }
}

function doStop(v: ActivityView, engine: GameEngine, onToast: ToastFn): void {
  const run = (r: { ok: boolean; error?: string } | boolean, okText: string): void => {
    const ok = typeof r === 'boolean' ? r : r.ok
    if (!ok) onToast((typeof r === 'object' && r.error) || '操作失败。', true)
    else onToast(okText)
  }
  switch (v.stop) {
    case 'remove-training':
      run(engine.dequeueAt(0), '已取消训练：本级进度保留，重新排同一级可续接。')
      break
    case 'stop-mining':
      run(engine.stopMiningNow(), '已停止开采。')
      break
    case 'stop-scan':
      run(engine.stopScanNow(), '已终止扫描探索：就地扫描进度已保存，下次续扫。')
      break
    case 'stop-salvage':
      run(engine.stopSalvageOpNow(), '已停止打捞：本趟已捞的残骸仍在船上（未返航不卸货）。')
      break
    case 'cancel-manufacture':
      if (v.stopParam) run(engine.cancelManufacturingAt(v.stopParam), '已取消制造：材料全额退回物品仓库（制造费不退）。')
      break
    case 'stop-refine':
      if (v.stopParam) run(engine.stopRefineRunAt(v.stopParam), '已停止该台炉：原料未锁定，余料仍在仓库。')
      break
    case 'recall-expedition':
      run(engine.recallExpeditionNow(), '远征已召回：舰队返回母港（无战果）。')
      break
    case 'recall-standby':
      run(engine.recallStandbyNow(), '掩护巡逻已召回：舰船返回母港。')
      break
    case 'retreat-battle':
      run(engine.retreatNow(), '已撤退：舰队脱离交火并自动返航。')
      break
    case 'cancel-ai':
      if (v.stopParam) run(engine.cancelAiTaskAt(v.stopParam), 'AI 任务已取消（核心已归还）。')
      break
    case 'stop-loop':
      run(engine.bountyLoopAt(null), '连续出击已停止。')
      break
  }
}

/**
 * 活动项 → 跳转目标页面（可带星图二级标签）——船长 2026-09-05 点击跳转。
 *
 * ⚠️ 扩展约定（新增活动时务必同步）：以后若新增活动项目 / 新增页面，
 * 必须在本函数补充对应 `case`（kind → { page, mapTab? }），否则新活动点下去
 * 会回退到默认 `{ page: 'map' }`（星图页），跳转失效。
 * 映射关系建议遵循：采矿→星图·矿带开采；扫描/远征/返航/待命→星图·远征；
 * 制造/精炼→工业；训练→技能页。跳转实现经 App 传入的 onGoPage（setPage + setMapTab）。
 */
function goFor(kind: string): { page: string; mapTab?: string } {
  switch (kind) {
    case 'mining':
      return { page: 'map', mapTab: 'mine' }
    case 'scan':
    case 'salvage':
    case 'expedition':
    case 'return':
    case 'transit':
    case 'standby':
      return { page: 'map', mapTab: 'star' }
    case 'courier':
      return { page: 'map', mapTab: 'task' }
    case 'loop':
      return { page: 'map', mapTab: 'bounty' }
    case 'manufacture':
    case 'refine':
      return { page: 'industry' }
    case 'train':
      return { page: 'skills' }
    default:
      return { page: 'map' }
  }
}

export function ActivityBar({
  engine,
  onToast,
  onAiCenter,
  onGoPage,
}: {
  engine: GameEngine
  onToast: ToastFn
  onAiCenter?: () => void
  onGoPage?: (page: string, mapTab?: string) => void
}) {
  const state = engine.state
  const all = activityOverview(state, engine.ctx)
  // 船长 2026-09-05：活动窗口垂直排布；「玩家活动」「技能训练」两个常驻分区，各自待机文案；AI 用 ⚙×N 徽标
  const aiCount = all.filter((i) => i.kind === 'ai').length
  const playerItems = all.filter((i) => i.kind !== 'ai' && i.kind !== 'train')
  const trainItems = all.filter((i) => i.kind === 'train')
  // 撤退需二次确认（轻损但有代价）
  const [retreatAsk, setRetreatAsk] = useState(false)
  if (retreatAsk && !playerItems.some((i) => i.stop === 'retreat-battle')) setRetreatAsk(false)

  const renderItem = (v: ActivityView) => {
    const target = goFor(v.kind)
    const handleItemClick = (): void => {
      if (onGoPage) onGoPage(target.page, target.mapTab)
    }
    const goText =
      target.page === 'map'
        ? target.mapTab === 'mine'
          ? '矿带开采'
          : target.mapTab === 'bounty'
            ? '悬赏情报'
            : target.mapTab === 'task'
              ? '任务中心'
              : '星图·远征'
        : target.page === 'industry'
          ? '工业'
          : '技能'
    return (
    <div
      key={v.id}
      className={`app-activitybar-item is-${v.kind}`}
      title={v.stopReason ?? `点击前往「${goText}」页`}
      onClick={handleItemClick}
    >
      <span className="app-activitybar-icon"><Glyph name={KIND_ICON[v.kind] ?? 'fallback'} size={15} color={NAV_TONES[KIND_ICON[v.kind]] ?? ICO_TONES[KIND_ICON[v.kind]]} /></span>
      <div className="app-activitybar-main">
        <div className="app-activitybar-line">
          <span className="app-activitybar-label">{v.label}</span>
          <span className="app-dim app-activitybar-sub">{v.sub}</span>
          {v.percent !== null ? (
            <span className="app-activitybar-track">
              <span className="app-activitybar-fill" style={{ width: `${v.percent}%` }} />
            </span>
          ) : null}
          <span className="app-activitybar-time">
            {v.percent !== null ? `${Math.round(v.percent)}%` : ''}
            {v.remainingMs !== null && v.remainingMs > 0 ? ` · 剩 ${formatDurationMs(v.remainingMs)}` : ''}
          </span>
        </div>
      </div>
      {v.stopable && v.stop ? (
        <button
          className="app-btn is-small is-warn"
          title={
            v.stop === 'cancel-manufacture'
              ? '取消制造：材料全额退回、制造费不退'
              : v.stop === 'stop-refine'
                ? '停炉：已完成批保留，剩余原料全额退回仓库（AI 核心自动归还）'
                : v.stop === 'recall-expedition'
                  ? '召回远征：中止任务返回母港（无战果）'
                  : v.stop === 'stop-scan'
                    ? '终止扫描：就地扫描进度保存，下次续扫'
                    : v.stop === 'stop-salvage'
                      ? '停止打捞：本趟已捞的残骸留在船上（未返航不卸货）'
                      : v.stop === 'remove-training'
                        ? '取消训练：本级进度保留，重排同一级自动续接；后续同技能队列顺延一级'
                        : v.stop === 'retreat-battle'
                          ? '撤退：轻损脱离战斗并自动返航（仅损失少量舰船耐久、无弃船风险；同时停止连续出击）'
                          : undefined
          }
          onClick={(e) => {
            e.stopPropagation() // 点击"停止/移除/撤退"不触发行跳转
            if (v.stop !== 'retreat-battle') {
              doStop(v, engine, onToast)
              return
            }
            if (!retreatAsk) {
              setRetreatAsk(true)
              onToast('撤退 = 轻损脱离（仅损失少量舰船耐久、无弃船风险）——再点一次确认。', true)
              return
            }
            setRetreatAsk(false)
            doStop(v, engine, onToast)
          }}
        >
          {v.stop === 'retreat-battle' && retreatAsk ? '再点确认撤退' : stopLabel(v)}
        </button>
      ) : null}
    </div>
    )
  }

  return (
    <div className="app-activitybar">
      <div className="app-activitybar-hd">
        <span className="app-activitybar-title">活动</span>
        {aiCount > 0 ? (
          <button
            className="app-activitybar-ai"
            title={`${aiCount} 艘 AI 副船正在执行任务——点击前往「舰船」页 AI 指挥中心`}
            onClick={onAiCenter}
          >
            <span className="app-ico">
              <Glyph name="nav-ai" size={13} color={NAV_TONES['nav-ai']} />
            </span>
            ×{aiCount}
          </button>
        ) : null}
      </div>
      <div className="app-activitybar-group">
        <div className="app-activitybar-gtitle">玩家活动</div>
        {playerItems.length > 0 ? (
          playerItems.map(renderItem)
        ) : (
          <span className="app-activitybar-idle">待机中——安排采矿 / 远征 / 扫描。</span>
        )}
      </div>
      <div className="app-activitybar-group">
        <div className="app-activitybar-gtitle">技能训练</div>
        {trainItems.length > 0 ? (
          trainItems.map(renderItem)
        ) : (
          <span className="app-activitybar-idle">✚ 暂未训练——去「技能」页排课。</span>
        )}
      </div>
    </div>
  )
}
