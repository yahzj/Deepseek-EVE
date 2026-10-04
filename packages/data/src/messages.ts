/**
 * 通讯消息表（2026-09-11 船长定：NPC 通过"给玩家发消息"补充剧情或发布任务提示）。
 *
 * 口径（详见 `docs/design/comms-20260911.md` 与 `docs/design/npc-factions-20260911.md`）：
 * - 每条 = 一封**收件箱消息**（发件势力/部门 / 内容类型 / 主题 / 正文 / 送达条件）；core 每帧廉价判定、条件满足一次即送达（幂等）。
 * - **发件人不在这里写自由文本**（2026-09-11 v2）：只填 `factionId`（+ 可选 `deptId`、`signer`），
 *   玩家看到的 `势力名 · 部门名` 由 `data/src/commsFactions.ts` 拼出。
 * - **只给提示 + 跳转**：消息可以带一句 `hint` 与目标页，但**不在通讯页里接取或完成任务**。
 * - 任务类内容一律写成"协会的委托/备忘"口吻，跳转只是把玩家带回对应页面，不替代任务板。
 * - 玩家可见文案纪律（约定第十三章）：不出现开发/商讨用词；**不得出现指涉玩家本质的词**
 *   （AI / 智能 / 旧时代 / 人类），也不得用「你的舰船」这类把玩家与船分开的说法——**玩家就是那条船**。
 * - `replies` 为**预留**字段（回复选项接口），本期不启用（`core/comms.ts` 的 COMMS_REPLIES_ENABLED = false）。
 */
import type { CommsMessageDef } from '@whale/core'
import { FIRST_TASK_MESSAGES } from './firstTaskMessages'
import { L10N } from './l10n/table'

/**
 * **信息库重启（开场信）**——睁眼演出结束后送达，把「第一次」清单交代清楚。
 *
 * 由来（2026-09-17 教程重做）：原先这里是「训前简报」＋七步任务链（教程融入通讯那版），
 * 每步再各发一封 `tut-1..7`；船长改口径为「**改成以重要任务的形式发布在任务中心，让玩家自由选择完成**」
 * ⇒ 七步与那七封一并退场，**开场信只保留"自检记录 + 清单在任务中心 + 一句起步建议"**，
 * 发件方仍为舰载信息库 · 检索重启。
 *
 * ⚠ 不写"第一件该做什么"的硬指引——只把**最靠前的那道门**（先扫母港星域）点明，否则玩家会在
 * "星图一片空白"上卡住。**2026-09-20 顺序解锁**（船长转玩家反馈「一次性太多了」⇒ 丙案：任务中心一次只出一条）
 * 之后，正文里"自由选择"那两句已改成"按顺序推进"（旧句"顺序不作规定，先做哪一项由本舰自己定"作废）。
 */
const BRIEFING_MESSAGE: CommsMessageDef = {
  id: 'msg-briefing',
  factionId: 'archive',
  deptId: 'dept-recall',
  kind: '提示',
  // ⟪文案调整 2026-10-04⟫ 开场集中说明自检与第一步，跳转定位重要任务。
  subject: L10N['ui.comms.027']!.zh,
  body: [
    L10N['ui.firstBriefing.001']!.zh,
    L10N['ui.firstBriefing.002']!.zh,
  ],
  trigger: { kind: 'start' },
  hint: { text: L10N['ui.comms.052']!.zh, page: 'task', taskTab: 'important' },
}

/** 全部通讯消息（id 稳定；新增即追加，不要改既有 id——已读/送达按 id 记账） */
export const COMMS_MESSAGES: readonly CommsMessageDef[] = [
  ...FIRST_TASK_MESSAGES, // 「第一次」任务系列的 13 封情报信（2026-09-17 教程重做批）
  BRIEFING_MESSAGE,
  {
    id: 'msg-welcome',
    factionId: 'dshi',
    deptId: 'dept-nav-control',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长批准试稿：管制部门只交代登记、来信与起步建议。
    subject: L10N['ui.comms.028']!.zh,
    body: [
      L10N['ui.commsWelcome.001']!.zh,
      L10N['ui.commsWelcome.002']!.zh,
    ],
    trigger: { kind: 'start' },
    hint: { text: '想先看看这片星域长什么样？去星图认认路。', page: 'map' },
  },
  {
    id: 'msg-survey-memo',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.029']!.zh,
    body: [
      L10N['ui.commsSurvey.001']!.zh,
      L10N['ui.commsSurvey.002']!.zh,
      L10N['ui.commsSurvey.003']!.zh,
    ],
    trigger: { kind: 'explored', count: 3 },
    hint: { text: '星图 · 点选未知信号开始扫描', page: 'map' },
  },
  {
    id: 'msg-cinder-warning',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.030']!.zh,
    body: [
      L10N['ui.commsCinder.001']!.zh,
      L10N['ui.commsCinder.002']!.zh,
      L10N['ui.commsCinder.003']!.zh,
    ],
    trigger: { kind: 'galaxy', galaxyId: 'galaxy-cinder' },
    hint: { text: '出发前先去装配页检查一遍武器与防护。', page: 'fit' },
  },
  {
    id: 'msg-industry-shift',
    factionId: 'dshi',
    deptId: 'dept-industry',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.031']!.zh,
    body: [
      L10N['ui.commsIndustry.001']!.zh,
      L10N['ui.commsIndustry.002']!.zh,
      L10N['ui.commsIndustry.003']!.zh,
    ],
    trigger: { kind: 'isk', amount: 50000 },
    hint: { text: '工业页可以同时开多台炉子。', page: 'industry' },
  },
  {
    id: 'msg-refinery-note',
    factionId: 'dshi',
    deptId: 'dept-smelt',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.032']!.zh,
    body: [
      L10N['ui.commsSmelt.001']!.zh,
      L10N['ui.commsSmelt.002']!.zh,
      L10N['ui.commsSmelt.003']!.zh,
    ],
    trigger: { kind: 'skill', skillId: 'refining', level: 2 },
    hint: { text: '技能页可以先把精炼学排进队列。', page: 'skills' },
  },
  {
    id: 'msg-salvage-crew',
    factionId: 'salvage-guild',
    deptId: 'dept-salvage-crew',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长批准试稿：老陈以打捞同行口吻介绍回收与货舱。
    subject: L10N['ui.comms.033']!.zh,
    body: [
      L10N['ui.commsSalvage.001']!.zh,
      L10N['ui.commsSalvage.002']!.zh,
      L10N['ui.commsSalvage.003']!.zh,
      L10N['ui.commsSalvage.004']!.zh,
    ],
    trigger: { kind: 'explored', count: 6 },
    hint: { text: '星图 · 残骸打捞页有各星系的残骸存量。', page: 'map', tab: 'salvage' },
  },
  {
    id: 'msg-site-thanks',
    factionId: 'dshi',
    deptId: 'dept-infra',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.034']!.zh,
    body: [
      L10N['ui.commsThanks.001']!.zh,
      L10N['ui.commsThanks.002']!.zh,
      L10N['ui.commsThanks.003']!.zh,
    ],
    trigger: { kind: 'siteBuilt', siteId: 'site-redring' },
    hint: { text: '副站建成后泊位、维修、补给与换船全部开放。', page: 'ship' },
  },

  /* ── 星系机制通讯（2026-09-12 船长定：「罗列目前的特殊机制，并在玩家探索到该具备特殊机制的星系后
     发一封通讯给玩家，讲解对应机制」）────────────────────────────────────────────────
   * 口径（船长四条裁决）：①**只发星系级机制**（全局机制不另发信），但**无人机相关的信里要提到近防炮 /
     提示带防空属性的武器**；②鱿鱼三星系、低安三星系**各合并一封**；③老档**补送**（已点亮的星系读档后补发，
     幂等不重复）；④发件方 = **协会对口部门**（测绘处 / 航线安全 / 基建部）。
   * 触发器两条为本次新增（`lowSec` / `foeFamily`）：**都不写死星系 id 清单**，安全等级改判或敌卡搬家时自动跟随。
   * 数值口径全部取自引擎现状：警戒机 5,000m →受击增程 20,000m、蜂群机 7,000m、近防炮是唯一带防空属性的武器线。 */
  {
    id: 'msg-auro-megastructure',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.035']!.zh,
    body: [
      L10N['ui.commsAuro.001']!.zh,
      L10N['ui.commsAuro.002']!.zh,
      L10N['ui.commsAuro.003']!.zh,
      L10N['ui.commsAuro.004']!.zh,
    ],
    trigger: { kind: 'galaxy', galaxyId: 'galaxy-auro' },
    hint: { text: '出发前在装配页把对空火力与装甲补齐。', page: 'fit' },
  },
  {
    id: 'msg-exile-swarm',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.036']!.zh,
    body: [
      L10N['ui.commsExile.001']!.zh,
      L10N['ui.commsExile.002']!.zh,
      L10N['ui.commsExile.003']!.zh,
    ],
    trigger: { kind: 'foeFamily', family: 'G' },
    hint: { text: '打之前先去装配页，把对空火力带上。', page: 'fit' },
  },
  {
    /**
     * **围剿通报**（**2026-09-23 船长令**：「**当玩家第一次进入七层是，给玩家发一则通讯讲清楚敌人
     * 开始围剿玩家了，并介绍机制**」）。
     *
     * - 触发 = `{ kind: 'wormholeSiege' }` ⇒ 读随档标记 `state.wormhole.siegeHintShown`
     *   （玩家**第一次下到第 7 层**时由 `wormholeDescend` 的 `maybeHintSiege` 置位）；
     * - 正文口径全部取自引擎现状（每消耗 1 回合刷 1 个 · 未扫描也看得见 · 挡路 · 不可扫除 ·
     *   打掉后原内容照旧 · 刷到当前格先确认再开战 · 每层上限 = 格数 50%）；
     * - ⚠ **刻意不给 `hint`**：围剿发生在**虫洞面板**里（没有对应的一级页可跳）——与星云那封同款理由。
     */
    id: 'msg-wh-siege',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '剧情',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.067']!.zh,
    body: [
      L10N['ui.commsSiege.001']!.zh,
      L10N['ui.commsSiege.002']!.zh,
      L10N['ui.commsSiege.003']!.zh,
    ],
    trigger: { kind: 'wormholeSiege' },
  },
  {
    id: 'msg-lowsec-rules',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.037']!.zh,
    body: [
      L10N['ui.commsLowsec.001']!.zh,
      L10N['ui.commsLowsec.002']!.zh,
      L10N['ui.commsLowsec.003']!.zh,
    ],
    trigger: { kind: 'lowSec' },
    hint: { text: '星图 · 出发前看清目标星系的安全等级。', page: 'map' },
  },
  {
    id: 'msg-redring-outpost',
    factionId: 'dshi',
    deptId: 'dept-infra',
    kind: '委托',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.038']!.zh,
    body: [
      L10N['ui.commsOutpost.001']!.zh,
      L10N['ui.commsOutpost.002']!.zh,
      L10N['ui.commsOutpost.003']!.zh,
      L10N['ui.commsOutpost.004']!.zh,
    ],
    trigger: { kind: 'galaxy', galaxyId: 'galaxy-redring' },
    hint: { text: '星图 · 选「红环航道」查看建站交付。', page: 'map' },
  },
  {
    id: 'msg-wormhole-nebula',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.039']!.zh,
    body: [
      L10N['ui.commsNebula.001']!.zh,
      L10N['ui.commsNebula.002']!.zh,
      L10N['ui.commsNebula.003']!.zh,
    ],
    trigger: { kind: 'wormholeNebula' },
    // ⚠ **刻意不给 `hint`**：`CommsHint.page` 只认导航直系页（`CommsJumpPage`），
    // 而星云发生在**虫洞面板**里（不是一级页、也没有对应的跳转页）⇒ 硬塞一个 `map` 会把玩家带去错误的地方。
    // 说明文字因此都写在正文里（"在原地再扫描一次"）。
  },
  {
    /**
     * **虫洞扫描解锁**（船长 2026-09-14：「**扫码虫洞需要玩家35声望才会解锁。解锁时发送通讯给玩家
     * （同时也要直接弹窗）**」；同日改判「**将开始虫洞的声望门槛提高到40**」；同日后又解闸
     * 「**可以解除虫洞对玩家的不可见状态了**」⇒ **本信已上线、达到门槛即送达**）。
     *
     * - 触发 = **协会声望 ≥ 40**（`{ kind: 'standing', factionId: 'dsi', min: 40 }`）——
     *   门槛常量在 core 的 `WORMHOLE_SCAN_UNLOCK_STANDING`（两处必须同值，`content:check` 硬契约，
     *   改一处不同步就红）；
     * - `popup: true` ⇒ 送达那一刻**同时弹窗**（玩家点「知道了」关掉，收件箱里照样留一份）；
     * - **公开叫法 = 「虫洞」**（船长 2026-09-14 定）：本信 2026-09-14 前写的是「深空裂隙」这套
     *   施工期代号，现已改回正式叫法；`unreleased` 施工期闸门已摘。
     * - **2026-09-14 追加一条装备提醒**（船长：「**解锁虫洞的提示和通讯内，提醒玩家要带采集器和
     *   打捞器**」）：本信就是解锁提示本身（`popup: true` ⇒ 弹窗渲染的就是这段正文，收件箱另留一份）
     *   ⇒ 加一段"进洞前带采集器与打捞器"，**弹窗与通讯两处同时生效**。
     */
    id: 'msg-wormhole-unlock',
    factionId: 'dshi',
    deptId: 'dept-survey',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.040']!.zh,
    body: [
      L10N['ui.commsWhunlock.001']!.zh,
      L10N['ui.commsWhunlock.002']!.zh,
      L10N['ui.commsWhunlock.003']!.zh,
      L10N['ui.commsWhunlock.004']!.zh,
    ],
    trigger: { kind: 'standing', factionId: 'dsi', min: 40 },
    popup: true,
    hint: { text: '星图 · 出港 · 「扫描虫洞」标签开始扫描', page: 'map' },
  },
  {
    /**
     * **被袭后的自动撤离**（2026-09-14 船长：「添加新的通讯，当玩家第一次因为低安袭击导致舰船自动撤离时触发。
     * 告诉玩家舰船自动撤离是因为袭击，并提示玩家可以制造维修组件，让撤离的舰船自动修理后继续任务」）。
     *
     * - 触发 = `{ kind: 'ambushRetreat' }`（随档三态 `state.ambushRetreatSeen`：true = 真撤离过；
     *   false = 新档（只等真撤离）；**缺失 = 老档** ⇒ 船长裁定「老档补发，但要判断玩家是否触发过」
     *   ⇒ 按可查痕迹判定：`encounterZoneCooldown` 非空（只在伏击真的命中时写入、写后不删）才补发）；
     * - 弹窗 = **默认弹**（2026-09-14 船长：「所有除新手教程外的讯息也弹窗」，且「**同一拍只弹第一封**」）；
     *   点「知道了」= 出队 **＋ 视为已在通讯界面看过**（不再挂导航栏未读提示）；收件箱里仍留一份；
     * - 跳转 = **工业页**（船长选定：去造修理组件）；
     * - 数值全部取自引擎现状：自动脱离线 = 结构 <50%（`encounter.retreatHullFrac`）、自动修补目标
     *   = 约六成（`encounter.repairTargetFrac`）、民用 5 枚/批 · 军用 3 枚/批（修理组件蓝图）。
     *   ⚠ **2026-09-16 船长改判**：自动修补**需要该船装着船体维修装置**，且**组件类型跟着装置走**
     *   （民用装置吃民用件、MK1/MK2 吃军用件）⇒ 本通讯正文按新口径写。
     */
    id: 'msg-ambush-retreat',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.041']!.zh,
    body: [
      L10N['ui.commsRetreat.001']!.zh,
      L10N['ui.commsRetreat.002']!.zh,
      L10N['ui.commsRetreat.003']!.zh,
      L10N['ui.commsRetreat.004']!.zh,
    ],
    trigger: { kind: 'ambushRetreat' },
    hint: { text: '工业页 · 造一批修理组件，给船装上维修装置', page: 'industry' },
  },
  {
    /**
     * **首艘自造船**（2026-09-15 船长：「新增通讯发送的节点：当玩家造好第一条船后，弹出通讯祝贺玩家，
     * 并告诉玩家新建造的舰船在舰船仓库页面」；三问裁决「丙，甲，甲」；文案指示「删除③和④。添加一条
     * 告诉玩家，想销售舰船也是在舰船仓库进行，只有没有装配的完好舰船才能入库」）。
     *
     * - 触发 = `{ kind: 'shipBuilt' }`（随档标记 `state.firstShipBuilt === true`：**只认"造过"**；
     *   `false` = 新档 ⇒ 只等真建造；**缺失 = 老档 ⇒ 同样不发**——2026-09-16 船长报障「购买舰船也会触发
     *   第一艘自造船的通讯，这不对」后取「甲：造过才发」，原「老档读档即补发」口径作废）；
     *   **置位点唯一** = `manufacturing.ts` 的 `settlePiece()` 造船分支——主控亲手开线与 AI 核心代造
     *   （含离线期间造的）同算，与"产出进舰船仓库"是同一个事实；
     * - 弹窗 = **默认弹**（不写 `popup`，走 2026-09-14 的「除教程外全弹」口径）；跳转 = 舰船页「**舰船仓库**」档；
     * - 事实全部取自引擎现状：入仓条件见 `shipyard.shipStorable()`（卸下模块 · 结构与装甲都完好 ·
     *   货仓清空 · 非驾驶中/无 AI 指派/未锁定）；出售 = 舰船仓库按型走 `sellStoredShipAt`
     *   （有收购单即时成交，没人收购转限价卖单、可撤单退回仓库）。
     */
    id: 'msg-first-ship',
    factionId: 'dshi',
    deptId: 'dept-industry',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.042']!.zh,
    body: [
      L10N['ui.commsFirstship.001']!.zh,
      L10N['ui.commsFirstship.002']!.zh,
      L10N['ui.commsFirstship.003']!.zh,
      L10N['ui.commsFirstship.004']!.zh,
    ],
    trigger: { kind: 'shipBuilt' },
    hint: { text: '舰船页 · 「舰船仓库」可转入舰队或出售', page: 'ship', shipTab: 'store' },
  },
  {
    /**
     * **首次遭遇「劫掠电子舰」**（船长 2026-09-16：「**在玩家第一次遭遇劫掠电子舰之后。结束虫洞或回到
     * 主界面时，给玩家发送一封通讯，介绍劫掠电子舰的捕获网。**」）。
     *
     * - 触发 = `{ kind: 'foeShipSeen', shipId: 'foe-pirate-raider' }`——随档标记 `state.foeShipSeen`
     *   在该舰级**第一次进场那一场**由 `combat.noteFoeShipsSeen` 置位（洞内洞外同一出口）；
     * - `holdWhenBusy: true` ⇒ 船长要的"**结束虫洞或回到主界面时**"：洞内/交战中压着不投递，
     *   等回到星图那一拍再送（弹窗 = 默认弹，收件箱另留一份）；
     * - 正文口径全部取自引擎现状：捕获网是**劫掠电子舰第一次开火**时张开（不看命中），把**被锁定那一艘**
     *   钉住——机动降到一成、推进器全数熄火、闪避失效、武器射程缩短 500 米；**击沉那艘电子舰、
     *   或者把交战距离拉到 4500 米外**都会松开（后者＝船长 2026-09-26「这个断开对敌我都有效」）。
     *   不写数值推导与开发词（按 §5 / §12）。
     */
    id: 'msg-pirate-capture-web',
    factionId: 'dshi',
    deptId: 'dept-route-safety',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.043']!.zh,
    body: [
      L10N['ui.commsWeb.001']!.zh,
      L10N['ui.commsWeb.002']!.zh,
      L10N['ui.commsWeb.003']!.zh,
      L10N['ui.commsWeb.004']!.zh,
    ],
    trigger: { kind: 'foeShipSeen', shipId: 'foe-pirate-raider' },
    holdWhenBusy: true,
  },
  {
    /**
     * **拿到第一个墨潮旗舰黑匣**（**2026-09-26 船长令**：「**玩家获取第一个黑匣后，才解锁组装机的
     * 插件选项，并且弹出相关通讯，通讯内跳转。**」）。
     *
     * - 触发 = `{ kind: 'blackboxSeen' }`（判据走 `blackbox.blackboxSeenOf`：随档标记 ＋ 老档按库存回填）；
     * - **落款带「前往」直达「章鱼人兑换」窗口**（`hint.action = 'plug-exchange'`——本批新开的
     *   通讯跳转动作，界面侧见 `CommsReader` 的 `onAction`；这是船长"通讯内跳转"那句的落点）；
     * - 正文讲插件制造、兑换与安装禁令；中英正文按同组 id 逐段取词。
     */
    id: 'msg-blackbox-plug-unlock',
    factionId: 'dshi',
    deptId: 'dept-industry',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长授权整批重写，保持发件方、触发与跳转。
    subject: L10N['ui.comms.079']!.zh,
    body: [
      L10N['ui.commsPlug.001']!.zh,
      L10N['ui.commsPlug.002']!.zh,
      L10N['ui.commsPlug.003']!.zh,
    ],
    trigger: { kind: 'blackboxSeen' },
    /**
     * 落款按钮（**2026-09-26 船长两次改口**：先「前往章鱼人兑换」，再「**通讯也是，前往章鱼人兑换**」
     * ⇒ 与组装机那处**统一口径**）。文案 id = `ui.Expedition.442`，并在 `ui/commsText.ts` 的
     * `COMMS_HINT_ID` 里登记 ⇒ 英文侧不露中文。
     */
    hint: { text: '前往声望商店兑换', page: 'industry', action: 'plug-exchange' },
  },
  /**
   * **首次进入实验室：黑市的"违禁货"通讯**（**2026-09-30 船长令**：「当玩家第一次进入实验室页面时，
   * 给玩家发送一封通讯，**来源不能是官方**（毕竟信号发射器是违法的），为玩家详细说明下信号发射器
   * 和突触加速剂」＋同日追加「口气是**黑市商人诱导你**（主要是信号发射器违法），并在最后重点提及…
   * 这句话可以染色。通讯内的重点也可以染色」）。
   *
   * - 发件方 = **黑市 · 违禁品柜**（非官方 · `alignment: '中立'`；本批新开的势力，见 `commsFactions.ts`）；
   * - 触发 = `{ kind: 'labOpened' }`（随档标记 `state.labOpened`，置位点 `engine.noteLabOpened()`）；
   * - **染色** = `highlight` 填两段：「信标违法」那段 ＋ **黑市开门口槛**那段（界面走既有
   *   `.app-report-highlight`；`content:check` 校验它与 `body` 某段逐字相等）；
   * - 口径：通讯只讲"用之前必须知道的"，**细则指向两件道具自己的物品说明**（船长裁定「甲」）；
   * - ⚠ **门槛句先写信、机制后补**（**2026-09-30 船长二次裁定**：「**门槛句 ＋ 染色照做。黑市先挂起，
   *   不做（玩家目前的声望也不达标）**」）⇒ 正文照写「累计声望满 100 我这边的门就给你开」并染色；
   *   **门槛本身（黑市溢价现货加累计声望门槛）仍挂账不做**——船长判断当下没人达标，先不落机制。
   *   落地门槛那批时**只需实现机制**，本封文案不再动。
   *
   * ⟪文案调整 2026-10-04⟫ 船长已审新稿；正文与强调段共用唯一表，英文覆盖逐段对齐。
   */
  {
    id: 'msg-lab-contraband',
    factionId: 'black-market',
    deptId: 'dept-contraband',
    kind: '提示',
    // ⟪文案调整 2026-10-04⟫ 船长批准试稿，并明确违法后由协会查处、处罚玩家。
    subject: L10N['ui.comms.076']!.zh,
    body: [
      L10N['ui.commsContraband.001']!.zh,
      L10N['ui.commsContraband.002']!.zh,
      L10N['ui.commsContraband.003']!.zh,
      L10N['ui.commsContraband.004']!.zh,
      L10N['ui.commsContraband.005']!.zh,
    ],
    highlight: [
      L10N['ui.commsContraband.004']!.zh,
      L10N['ui.commsContraband.005']!.zh,
    ],
    trigger: { kind: 'labOpened' },
    hint: { text: '工业页的实验室能造这两样。', page: 'industry' },
  },
]

/** 通讯消息目录（core 判定触发器；按 id 稳定查表） */
export function buildCommsCatalog(): ReadonlyMap<string, CommsMessageDef> {
  return new Map(COMMS_MESSAGES.map((m) => [m.id, m]))
}
