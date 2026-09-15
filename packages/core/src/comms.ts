/**
 * 通讯（收件箱）系统（2026-09-11 船长定：NPC 通过"给玩家发消息"补充剧情或发布任务提示）。
 *
 * 口径（详见 `docs/design/comms-20260911.md`，六条裁决全为「甲」）：
 * - 消息来自 `data/src/messages.ts` 的数据表 + **触发条件**；本模块每帧廉价判定、条件满足一次即送达（幂等）。
 * - 送达记账 = `state.commsDelivered[id] = gameMs`；已读 = `state.commsRead[id] = true`（两字段可选、零迁移）。
 * - **合并**：T9 建站剧本（介绍/庆贺）在送达或播放时也镜像进同一收件箱（键 `dlg:<剧本 id>`），
 *   于是"通讯页"是玩家侧唯一的 NPC 通信记录；剧本原有的弹层行为不变。
 * - **只给提示 + 跳转**：消息可带 `hint`，但通讯页不接取/不完成任何任务。
 * - **回复接口预留但不启用**：见 `COMMS_REPLIES_ENABLED`（玩家侧不出现任何回复控件）。
 */
import { ONB_EPILOGUE, startTutorialFromBriefing } from './onboarding'
import { isSiteBuilt } from './station'
import { addLog } from './state'
import type { GameState } from './state'
import type {
  CommsActionCommand,
  CommsEntryView,
  CommsFactionAlignment,
  CommsKind,
  CommsMessageDef,
  CommsTrigger,
  SimContext,
} from './types'

/** 通讯里的"天"（游戏内时间；与赏金日板的 24 小时同口径） */
export const COMMS_DAY_MS = 24 * 3_600_000

/**
 * 回复选项开关（2026-09-11 船长定：**预留接口，目前不启用**）。
 * 置 true 时通讯页才渲染 `CommsMessageDef.replies` 对应按钮；本期保持 false（不出现空按钮）。
 */
export const COMMS_REPLIES_ENABLED = false

/**
 * 解析发件方（2026-09-11 通讯 v2：消息/剧本都挂靠「势力 + 部门」）。
 *
 * 显示口径：**玩家看到的发件人写法不变**，仍是 `势力名 · 部门名`（缺部门 = 只显示势力名）；
 * 解析不到势力/部门时**降级显示原文 id**（界面不崩——数据改漏了只会看到 id，不会白屏）。
 */
export interface CommsSenderView {
  /** 发件人写法（`势力名 · 部门名`；降级时 = 原文 id） */
  from: string
  /** 势力名（未解析到 = 空串） */
  factionName: string
  /** 立场（未解析到 = 空串） */
  alignment: CommsFactionAlignment | ''
  /** 内容类型（未挂靠 = 空串） */
  kind: CommsKind | ''
  /** 具名联系人（悬停说明用） */
  signer?: string
  /** 发件方说明「这是谁」（势力 brief + 部门 brief；悬停用） */
  fromBrief?: string
  /** 势力主题色（未解析到 = 空串，界面回落默认色） */
  tone: string
  /** 势力图标名（未解析到 = 空串） */
  glyph: string
}

/** 发件方解析（势力 + 部门 + 可选内容类型 + 可选具名联系人；缺数据一律降级不抛错） */
export function resolveCommsSender(
  ctx: SimContext,
  factionId: string,
  deptId?: string,
  kind?: CommsKind,
  signer?: string,
): CommsSenderView {
  const faction = ctx.commsFactions?.get(factionId)
  if (!faction) {
    return {
      from: deptId ? `${factionId} · ${deptId}` : factionId,
      factionName: '',
      alignment: '',
      kind: '',
      signer,
      tone: '',
      glyph: '',
    }
  }
  const dept = deptId ? faction.departments.find((d) => d.id === deptId) : undefined
  const briefs = [faction.brief, dept?.brief].filter((b): b is string => Boolean(b))
  return {
    from: dept ? `${faction.name} · ${dept.name}` : faction.name,
    factionName: faction.name,
    alignment: faction.alignment,
    kind: kind ?? '',
    signer,
    fromBrief: briefs.length > 0 ? briefs.join(' ') : undefined,
    tone: faction.tone,
    glyph: faction.glyph,
  }
}

/**
 * 剧本镜像到收件箱的键（与数据消息 id 区分；`id` 里的 `dlg:` 前缀是稳定约定）
 */
export function commsDialogueKey(scriptId: string): string {
  return `dlg:${scriptId}`
}

/** 游戏内时钟文本（收件箱时间列：第 N 天 hh:mm；day 从 1 起） */
export function commsGameClock(gameMs: number): string {
  const t = Math.max(0, Math.floor(gameMs))
  const day = Math.floor(t / COMMS_DAY_MS) + 1
  const rest = t % COMMS_DAY_MS
  const hh = Math.floor(rest / 3_600_000)
  const mm = Math.floor((rest % 3_600_000) / 60_000)
  return `第 ${day} 天 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** 送达记账（幂等）：未送达则写入时间并返回 true */
function deliver(state: GameState, id: string): boolean {
  const map = (state.commsDelivered ??= {})
  if (map[id] !== undefined) return false
  map[id] = Math.max(0, Math.floor(state.gameMs))
  return true
}

/**
 * **需要直接弹窗的通讯**（船长 2026-09-14 三次裁定）：①「解锁时发送通讯给玩家（**同时也要直接弹窗**）」；
 * ②「所有除新手教程外的讯息也弹窗」；③「**同一拍只弹第一封、其余只进收件箱**」。
 * 送达后把 id 记进 `state.commsPopups`（去重、保序），界面只渲染**队首那一封**；点「知道了」调
 * `dismissCommsPopup` 出队——**关掉不丢信**（收件箱里还有），且**视为已在通讯界面看过**（记已读）。
 */
export function commsPopupQueue(state: GameState): string[] {
  return state.commsPopups ?? []
}

/**
 * 关掉一份弹窗（幂等；返回是否真的关掉了一份）。
 *
 * 船长 2026-09-14：「**玩家已经看过点掉的，视为在通讯界面看过（不会有导航栏提示）**」
 * ⇒ 出队的同时**记已读**（否则刚点掉的信还会让导航栏「通讯」图标闪 + 挂未读徽标）。
 * 只在"确实关掉了一份"时记，重复调用（幂等 false）不再动已读状态。
 */
export function dismissCommsPopup(state: GameState, id: string): boolean {
  const list = state.commsPopups ?? []
  if (!list.includes(id)) return false
  state.commsPopups = list.filter((x) => x !== id)
  markCommsRead(state, id)
  return true
}

/** 单条触发条件是否达成（新增 kind 时须同步 content-check 的「通讯消息契约」） */
export function commsTriggerMet(state: GameState, ctx: SimContext, trigger: CommsTrigger): boolean {
  switch (trigger.kind) {
    case 'start':
      // 序章引导（采矿→交付→出售→修复→试炼→技能→分身）期间导航被教程锁定，通讯页打不开；
      // 故开局信等引导走完（收尾演出起）再送，玩家收得到、也点得开。
      return state.onboarding.step >= ONB_EPILOGUE
    case 'day':
      return state.gameMs >= trigger.days * COMMS_DAY_MS
    case 'explored':
      return state.exploredGalaxies.length >= trigger.count
    case 'galaxy':
      return state.exploredGalaxies.includes(trigger.galaxyId)
    case 'skill':
      return (state.skills.trained[trigger.skillId] ?? 0) >= trigger.level
    case 'isk':
      return state.wallet.isk >= trigger.amount
    case 'standing':
      // 声望达标（2026-09-14 船长：虫洞扫描解锁要 35 声望）——直接读 state，避免与 expedition 形成模块环
      return (state.standings[trigger.factionId] ?? 0) >= trigger.min
    case 'siteBuilt': {
      const site = ctx.stations.get(trigger.siteId)
      return site !== undefined && isSiteBuilt(state, site)
    }
    case 'tutorial': {
      // 2026-09-11 船长定（教程融入通讯）：**到达该步**才送达。
      // 步骤号与引擎状态的对应：简报 = 0（进行态 `ONB_BRIEFING = 0.5`）、第 N 步 = N（进行态 `ONB_* = N`）。
      // 故：简报要 `step >= 0.5`（序章演出 `ONB_AWAKEN = 0` 时还没到，不送）；
      // 第 N 步用 `step >= N`（状态一旦到 N 就送，不推迟）。**跳过教程**（step → 99）后前几步一并补送。
      const need = trigger.step === 0 ? 0.5 : trigger.step
      return state.onboarding.step >= need
    }
    case 'lowSec':
      // 2026-09-12 船长定（星系机制通讯）：**首次探明任一低安星系**即送达一封低安须知。
      // 低安口径 = **安全等级 ≤ 0（含 0）**——船长同日两条裁定「将伏击掷骰阈值降低为0」＋「0也算低安」，
      // 与 `balance.encounter.lowSecMax` / `encounters.collectExposures` 同源（伏击只看低安）。
      // 安全等级缺省按高安（`?? 1`，与 `encounters.secOf` 同口径）⇒ 数据里不必维护"哪几个星系算低安"的清单。
      return state.exploredGalaxies.some(
        (galaxyId) => (ctx.galaxies.get(galaxyId)?.security ?? 1) <= ctx.balance.encounter.lowSecMax,
      )
    case 'foeFamily': {
      // 2026-09-12 船长定：**首次探明"有该族敌人"的星系**即送达（如 G 族蜂群的敌情通报）。
      // 读敌卡数据而不是写死星系 id ⇒ 卡片搬家时自动跟随（窝点派生卡同族同域，一并覆盖）。
      //
      // ⚠ 2026-09-14 船长定（报障「蜂群通报依旧在过完教程后就发」）：**"有该族敌人"只认星图可见卡**，
      // 判据 = **玩家自己扫描出该星系**（全仓只有 `explore.ts` 的扫描会写 `exploredGalaxies`）。
      // 必须滤掉 `hidden: true` 的洞内卡：`packages/data/src/wormholeFoes.ts` 的五张 `wh-*` 卡
      // 统一挂 `galaxyId = 'galaxy-hub'`（= `HOME_GALAXY_ID`，开局即在 `exploredGalaxies` 里）
      // ⇒ 不过滤则条件**从第 0 帧起恒真**，通讯一能送达就立刻发信，与玩家探明了哪片空域无关。
      // 星图侧的同类消费方（`isLairCandidate` / 打捞池 / 遭遇抽池 / 派发）一律过滤 `hidden`，此处与之同口径。
      for (const anomaly of ctx.anomalies.values()) {
        if (anomaly.hidden === true) continue
        if (anomaly.foeFamily !== trigger.family) continue
        if (state.exploredGalaxies.includes(anomaly.galaxyId)) return true
      }
      return false
    }
    case 'wormholeNebula':
      // 2026-09-13 船长定（星云机制）：**第一次下到第 4 层**时送达一封星云说明。
      // 判定读的是同一个随档标记（`wormholeDescend` 置位）⇒ 与那一条一次性提示同源、不会错位。
      return state.wormhole.nebulaHintShown === true
    case 'ambushRetreat': {
      // 2026-09-14 船长定（新通讯）：**第一次因为低安袭击导致舰船自动撤离**时送达一封"为什么船自己回家了"，
      // 并提示自造修理组件（`msg-ambush-retreat`）。置位点两处（船长裁定「也算自动脱离交火」）：
      // `encounters.retreatEncounterShip`（收手返港待命）与 `encounters.settleEscape`（应战中途自动脱离交火）；
      // 主控与副船同口径。
      if (state.ambushRetreatSeen === true) return true
      // 新档（本功能之后开的局）：本字段显式为 false ⇒ **只等真撤离**，不补发
      if (state.ambushRetreatSeen === false) return false
      /**
       * **老档补发，但要判断玩家是否触发过**（船长 2026-09-14 二次裁定；起因＝他的新档也被补发了）。
       * 老档没有事件记录可查（撤军日志会被 `logCap` 裁掉、船体早已修好），故取**可查的最强痕迹**：
       * `state.encounterZoneCooldown` 非空 = 该档**确实被伏击过至少一次** ——
       * 它只在 `encounters.spawnEncounter`（伏击真的命中、且当地有可见悬赏敌群）时写入，
       * 写后不删、随档保存（`save.ts` 原样带回）⇒ 比"进过低安"（`lowSecNotified`）更贴"触发过"。
       * ⚠ 残留误差（如实登记）：老档**被伏击过但每次都是击退/被抢/修好继续干**的，也会收到这封信。
       */
      return Object.keys(state.encounterZoneCooldown).length > 0
    }
    default:
      return false
  }
}

/** 送达文案（事件日志一行；玩家可见文案，禁开发腔） */
function deliveryLogText(ctx: SimContext, msg: CommsMessageDef): string {
  const sender = resolveCommsSender(ctx, msg.factionId, msg.deptId, msg.kind, msg.signer)
  return `[通讯] 收到 ${sender.from} 的一条消息：《${msg.subject}》——导航「通讯」可查看。`
}

/**
 * 引擎内部：推进通讯收件箱（每次时间推进后调用）。
 * 廉价：表为空或全部已送达时立即返回；触发判定只读 state 字段。
 */
export function advanceComms(state: GameState, ctx: SimContext): void {
  if (ctx.commsMessages.size === 0) return
  /**
   * 本拍是否已经用掉那**唯一一个**弹窗名额（船长 2026-09-14：「**同一拍只弹第一封、其余只进收件箱**」）。
   * 为什么按"拍"而不是"队列非空"：一拍里可能同时满足好几个触发条件（老档补发、一次点亮多星系…），
   * 全塞进队列会逼玩家一封封点；只弹第一封既能提醒"有事了"，其余靠导航栏未读提示去收件箱看。
   */
  let popupUsed = false
  for (const msg of ctx.commsMessages.values()) {
    // 施工期闸门（船长铁律「数据走 unreleased」）：标了 unreleased 的消息**不送达**（上线时删字段即可开送）
    if (msg.unreleased === true) continue
    if (!commsTriggerMet(state, ctx, msg.trigger)) continue
    if (!deliver(state, msg.id)) continue
    addLog(state, 'info', deliveryLogText(ctx, msg))
    /**
     * 弹窗队列（2026-09-14 船长两次裁定）：
     * ① 初版：「解锁时发送通讯给玩家（**同时也要直接弹窗**）」⇒ 只有显式标 `popup: true` 的消息弹；
     * ② 同日改判：「**所有除新手教程外的讯息也弹窗**」⇒ 改为**默认弹窗**——唯一例外是**教程类**
     *    （`kind === '教程'`：序章简报 + 七步教程，它们本来就在引导流程里，弹卡片只会打断）；
     *    个别消息要关掉弹窗写 `popup: false`（显式 opt-out）。
     * ⚠ **单窗口**由队列保证：界面只渲染队首那一封，所以同一拍送达多封也只会一张一张弹，
     * 不会叠出多窗口（离线简报期间整体让位，见 `App.tsx` 的 `popupMsg`）。
     */
    const wantPopup = msg.popup ?? msg.kind !== '教程'
    if (wantPopup && !popupUsed) {
      const list = state.commsPopups ?? []
      if (!list.includes(msg.id)) state.commsPopups = [...list, msg.id]
      popupUsed = true
    }
  }
}

/**
 * 剧本镜像进收件箱（幂等；未知剧本直接跳过）。
 * 调用点：`station.ts` 挂起待播通讯时、`playDialogue` 登记已读时（两处都调，谁先到都只记一次）。
 */
export function deliverDialogueToComms(state: GameState, ctx: SimContext, scriptId: string): void {
  const script = ctx.dialogues.get(scriptId)
  if (!script) return
  const key = commsDialogueKey(scriptId)
  if (!deliver(state, key)) return
  const sender = script.commsFactionId
    ? resolveCommsSender(ctx, script.commsFactionId, script.commsDeptId, undefined, script.commsSigner)
    : undefined
  const from = sender?.from ?? script.title
  addLog(state, 'info', `[通讯] 收到 ${from} 的一条消息：《${script.subject ?? script.title}》——导航「通讯」可查看。`)
}

/**
 * 收件箱视图（全部已送达消息，按送达时间倒序）。
 * 已送达但当前数据表里查不到（消息被撤下/剧本改名）→ 跳过不显示，但保留记账（不重复送）。
 */
export function commsInbox(state: GameState, ctx: SimContext): CommsEntryView[] {
  const out: CommsEntryView[] = []
  /** 降级发件方（未挂靠势力 / 势力解析不到；界面不崩、也无立场小片） */
  const FALLBACK_SENDER = { factionName: '', alignment: '', kind: '', tone: '', glyph: '' } as const
  const delivered: Record<string, number> = state.commsDelivered ?? {}
  for (const [id, at] of Object.entries(delivered)) {
    const atMs = Number.isFinite(at) ? Math.max(0, Math.floor(at)) : 0
    if (id.startsWith('dlg:')) {
      const script = ctx.dialogues.get(id.slice(4))
      if (!script) continue
      // 剧本挂靠「数据 + 词典 + 契约」：有 commsFactionId 才解析立场/色调，否则回落剧本 title 原文
      const sender = script.commsFactionId
        ? resolveCommsSender(ctx, script.commsFactionId, script.commsDeptId, undefined, script.commsSigner)
        : { from: script.title, ...FALLBACK_SENDER }
      out.push({
        id,
        source: 'dialogue',
        from: sender.from,
        factionName: sender.factionName,
        alignment: sender.alignment,
        kind: sender.kind,
        signer: sender.signer,
        fromBrief: sender.fromBrief,
        tone: sender.tone,
        glyph: sender.glyph,
        subject: script.subject ?? script.title,
        paragraphs: script.lines.map((l) => `${l.speaker}：${l.text}`),
        deliveredAtGameMs: atMs,
        read: state.commsRead?.[id] === true,
      })
      continue
    }
    const msg = ctx.commsMessages.get(id)
    if (!msg) continue
    const sender = resolveCommsSender(ctx, msg.factionId, msg.deptId, msg.kind, msg.signer)
    out.push({
      id,
      source: 'message',
      from: sender.from,
      factionName: sender.factionName,
      alignment: sender.alignment,
      kind: sender.kind,
      signer: sender.signer,
      fromBrief: sender.fromBrief,
      tone: sender.tone,
      glyph: sender.glyph,
      subject: msg.subject,
      paragraphs: msg.body,
      highlight: msg.highlight,
      deliveredAtGameMs: atMs,
      read: state.commsRead?.[id] === true,
      hint: msg.hint,
      action: msg.action,
      replies: msg.replies,
    })
  }
  // 送达时间倒序（同刻按 id 稳定排序，避免刷新顺序跳动）
  out.sort((a, b) => (b.deliveredAtGameMs - a.deliveredAtGameMs) || a.id.localeCompare(b.id))
  return out
}

/** 未读条数（导航徽标 / 闪烁判定） */
export function commsUnreadCount(state: GameState, ctx: SimContext): number {
  return commsInbox(state, ctx).filter((e) => !e.read).length
}

/** 标记单条已读（点开即读） */
export function markCommsRead(state: GameState, id: string): { ok: boolean; error?: string } {
  if (state.commsDelivered?.[id] === undefined) return { ok: false, error: '没有这封通讯（可能已被撤销）。' }
  state.commsRead ??= {}
  state.commsRead[id] = true
  return { ok: true }
}

/** 全部标记已读：返回本次新标记的条数（0 = 本来就没有未读） */
export function markAllCommsRead(state: GameState, ctx: SimContext): number {
  let n = 0
  state.commsRead ??= {}
  for (const e of commsInbox(state, ctx)) {
    if (e.read) continue
    state.commsRead[e.id] = true
    n += 1
  }
  return n
}

/**
 * 消息自带动作的分发（2026-09-11 教程融入通讯）。
 * 本期只有 `startTutorial`：序章简报那封的「按单开工：采集橄榄岩」——
 * 点击才从简报态（`ONB_BRIEFING`）推进到采集步骤（`ONB_MINE`）。
 * 未知命令一律报错返回，界面只弹提示、不崩。
 */
export function runCommsAction(state: GameState, command: CommsActionCommand): { ok: boolean; error?: string } {
  switch (command) {
    case 'startTutorial':
      return startTutorialFromBriefing(state)
    default:
      return { ok: false, error: '这封通讯上的动作暂不可用。' }
  }
}
