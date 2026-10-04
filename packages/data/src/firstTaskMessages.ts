/** 「第一次」任务完成信；船长 2026-10-04 授权整批调整、一次性验收。
 * ⟪文案调整 2026-10-04⟫ 信息库报告成果并衔接下一步，不改触发或奖励。
 */
import type { CommsMessageDef } from '@whale/core'
import { L10N } from './l10n/table'

export const FIRST_TASK_MESSAGES: readonly CommsMessageDef[] = [
  {
    id: 'first-scan',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.014']!.zh,
    body: [
      L10N['ui.firstScan.001']!.zh,
      L10N['ui.firstScan.002']!.zh,
      L10N['ui.firstScan.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-scan' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-mine',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.015']!.zh,
    body: [
      L10N['ui.firstMine.001']!.zh,
      L10N['ui.firstMine.002']!.zh,
      L10N['ui.firstMine.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-mine' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-refine',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.016']!.zh,
    body: [
      L10N['ui.firstRefine.001']!.zh,
      L10N['ui.firstRefine.002']!.zh,
      L10N['ui.firstRefine.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-refine' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-bounty',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.017']!.zh,
    body: [
      L10N['ui.firstBounty.001']!.zh,
      L10N['ui.firstBounty.002']!.zh,
      L10N['ui.firstBounty.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-bounty' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-repair',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.018']!.zh,
    body: [
      L10N['ui.firstRepair.001']!.zh,
      L10N['ui.firstRepair.002']!.zh,
      L10N['ui.firstRepair.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-repair' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-salvage',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.019']!.zh,
    body: [
      L10N['ui.firstSalvage.001']!.zh,
      L10N['ui.firstSalvage.002']!.zh,
      L10N['ui.firstSalvage.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-salvage' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-skill',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.020']!.zh,
    body: [
      L10N['ui.firstSkill.001']!.zh,
      L10N['ui.firstSkill.002']!.zh,
      L10N['ui.firstSkill.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-skill' },
    /**
     * **2026-09-24 船长令**：「跳到技能页并自动选中工程」——这封信的「前往」不再只回任务中心，
     * 而是直接落到「技能」页并选中「工程」那一档（`tab` = 大类键；落点规则见 App 的 `gotoFromComms`）。
     */
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-ai',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.021']!.zh,
    /**
     * ⟪文案调整 2026-10-01⟫ 船长改稿落地（通讯工作台回写）。
     *
     * ⚠ 第二段船长原写「战斗、运输与虫洞扫描太复杂，**只能依赖主控AI**。」——它触碰
     * `content:check` 的**世界观铁律契约**：该契约只豁免「**AI + 中文**」的既有写法
     * （`/AI\s*(?=[\u4e00-\u9fa5])/`，如「AI 核心」「AI 副船」），而全仓此前**没有「主控 AI」**这个写法。
     * ⇒ 船长裁定「**按你推荐**」＝ 改为 **「舰载 AI」**：走船内系统的自认知豁免
     * （本信发件方是信息库 `archive`，`alignment = '系统'`，契约注释写明"它本该知道玩家是什么"）。
     */
    body: [
      L10N['ui.firstAi.001']!.zh,
      L10N['ui.firstAi.002']!.zh,
      L10N['ui.firstAi.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-ai' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-produce',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.022']!.zh,
    body: [
      L10N['ui.firstProduce.001']!.zh,
      L10N['ui.firstProduce.002']!.zh,
      L10N['ui.firstProduce.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-produce' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-order',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.023']!.zh,
    body: [
      L10N['ui.firstOrder.001']!.zh,
      L10N['ui.firstOrder.002']!.zh,
      L10N['ui.firstOrder.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-order' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-ship',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.024']!.zh,
    body: [
      L10N['ui.firstShip.001']!.zh,
      L10N['ui.firstShip.002']!.zh,
      L10N['ui.firstShip.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-ship' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-haul',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.025']!.zh,
    body: [
      L10N['ui.firstHaul.001']!.zh,
      L10N['ui.firstHaul.002']!.zh,
      L10N['ui.firstHaul.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-haul' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
  {
    id: 'first-wormhole',
    factionId: 'archive',
    deptId: 'dept-recall',
    kind: '提示',
    subject: L10N['ui.comms.026']!.zh,
    body: [
      L10N['ui.firstWormhole.001']!.zh,
      L10N['ui.firstWormhole.002']!.zh,
      L10N['ui.firstWormhole.003']!.zh,
    ],
    trigger: { kind: 'firstTask', taskId: 'first-wormhole' },
    hint: { text: L10N['ui.comms.051']!.zh, page: 'task', taskTab: 'important' },
  },
]
