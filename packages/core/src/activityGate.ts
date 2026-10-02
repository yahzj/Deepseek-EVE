/**
 * **主控活动切换的单点判据**（**2026-09-21 船长令**：「**关于主控切换不同活动，现在依旧很混乱。有的需要玩家
 * 先取消当前活动才能切换，有的又可以直接切换，有的还需要警告后切换。你帮我统计下。我希望统一为能够直接切换
 * （自动取消当前活动），像长途运输这种高收益高周期的才加一个警告。**」＋同日追加：**「处在战斗中的时候也设置
 * 为不可取消」**＋三答：**远征/快递写进警告档 · 开炉开线取消即丢弃进度 · 换驾驶与进洞纳入同一条单点**）。
 *
 * 现状（改前）＝三档并存：① 绝大多数入口**硬拒**（9 个 `start*` 各写一套 busy 检查，散布 30+ 处）
 * ② 只有「换驾驶」与「进洞」**自动停** ③ 警告态只在长途运输那一族。本模块把**判据**收成一处：
 *
 * | 档 | 成员 | 行为 |
 * |---|---|---|
 * | `AUTO_HALT` | 采矿 · 打捞 · 扫描虫洞 · 掩护巡逻 | **直接切**：自动停掉它（代价见下表）＋记一条日志，然后照常开始新活动 |
 * | `WARN_KINDS` | **长途运输**（高收益高周期）· **远征** · **快递投送** · **亲自开炉** · **亲自开线**（**2026-09-27 船长令「亲自开炉 · 亲自开线也添加警告」并入**） | **先警告**：首击弹警告（写清将停谁、代价是什么），二击执行；⚠ **远征/快递在途不可中断** ⇒ 警告之后仍是拒（文案按警告口径讲清代价） |
 * | `LOCKED`（状态类） | **战斗中** · 人在虫洞里 · 换港返航途中 | **一律拒**：这些状态不可被"切活动"打断（连站内的"亲自开炉/开线"也拒——主控正在打仗） |
 *
 * 各活动的**取消代价**（统一日志里写清）：采矿/打捞 = 本趟货留在船上并返港 · 扫描虫洞 = 进度保留 ·
 * 掩护巡逻 = 召回回港 · 亲自开炉/开线 = **停炉/停线，当前那批进度丢弃**（船长 2026-09-21 定）·
 * 长途运输 = 本段报酬拿不到。
 *
 * ⚠ **本模块只出判据，不执行停机**：`gateMainActivity` 返回"该停谁/该警告什么/为什么拒"，由各入口用**既有的**
 * 取消函数落地（`miningHalt` / `salvageHalt` / `haulingHalt` / `wormholeScanHalt` / `cancelStandby` /
 * `stopRefineRun` / `cancelManufacturing`）——这样语义只有一份、也不制造模块环。
 */
import type { CoreBlockReason } from './engine'
import type { GameState } from './state'
import type { SimContext } from './types'
import { addLog, haltActivityForSwitch } from './state'

/** 主控活动（10 项；与活动栏、`pilotUnavailableReason`、各 `start*` 入口一一对应） */
export type MainActivityKind =
  | 'mining'
  | 'salvaging'
  | 'hauling'
  | 'wormholeScan'
  | 'standby'
  | 'refine'
  | 'manufacturing'
  | 'expedition'
  | 'deliver'
  /** **建站交付**（一键「前往工地交付」＝交付循环；**2026-09-22 船长令**纳入切换单点） */
  | 'siteDeliver'
  /**
   * **实验室产线**（**2026-10-01 船长令**：「**实验室的主控活动并不占用主控，是BUG**」⇒ 补登记）。
   * 判据 = `state.labRuns` 里有 `active && worker === 'pilot'`（**AI 核心驱动的实验室线不占主控**，与开炉/开线同款）。
   * ⚠ 本类型是全仓的**登记表源头**：往这里加一项 ⇒ 下面五张 `Record<MainActivityKind, …>` 全部编译不过，
   * 逼着把活动名/代价/分档补齐（这就是"天然纳入"的机器实现）。
   */
  | 'lab'

/**
 * **直接切**（自动停掉；船长 2026-09-21：「统一为能够直接切换（自动取消当前活动）」）。
 *
 * ⚠ **2026-09-27 船长令「亲自开炉 · 亲自开线也添加警告」**：`refine` 与 `manufacturing`
 * **移出本表**，改走 `WARN_KINDS` 的"先警告"档 —— 它们被打断的代价是**当前那批进度丢弃**
 * （一次性图纸在造时尤其要提醒玩家），静默停掉会让玩家以为吃了暗亏。
 */
export const AUTO_HALT_KINDS: readonly MainActivityKind[] = [
  'mining',
  'salvaging',
  'wormholeScan',
  'standby',
  /**
   * **建站交付**（**2026-09-22 船长令**：「建设空间站的运输也加入可以打断其他行为的切换里，
   * 不需要先暂停其他活动」）：它自己也能被别的活动直接切掉——停机口径与开采/打捞同款
   * （舰船返港、**本趟建材留在船上**，可随时再发起交付），见 `state.haltActivityForSwitch`。
   */
  'siteDeliver',
]

/**
 * 先警告再执行（船长：「像长途运输这种高收益高周期的才加一个警告」＋「1 写进警告」＝远征/快递同档）。
 * ⚠ **2026-09-27 起 `refine`（亲自开炉）/ `manufacturing`（亲自开线）也并入本档**——船长令
 * 「亲自开炉 · 亲自开线也添加警告」；两者在 `INTERRUPTIBLE` 里是 `true` ⇒ 走 `confirm`（警告后二击可切）。
 *
 * 🔴 **2026-10-02 补登记 `refine` / `manufacturing`**（本表原先只有四条，与上面这句注释、
 * 与船长 09-27 的令**对不上**）：本表是**登记表**（"哪些档属于先警告这一档"），
 * 但全仓**没有任何消费点**（`verdictOf` 的判据是"不在 `AUTO_HALT_KINDS` 里 ⇒ 走 confirm/reject"，
 * 与档位天然等价）⇒ 漏登记**不改行为**，却让"登记表"变成一句不实的声明。
 * 由 `arch:guard` 的 **F8** 钉住：两档**互斥且必须覆盖 `MainActivityKind` 的全部档位**。
 */
export const WARN_KINDS: readonly MainActivityKind[] = [
  'hauling',
  'expedition',
  'deliver',
  'lab',
  'refine',
  'manufacturing',
]

/**
 * 该活动**在途时能不能被中断**：`true` = 警告后可由玩家确认中断（长途运输：本段报酬拿不到）·
 * `false` = 警告之后**仍是拒**（远征在途不可停、快递投送不可取消 —— 船长 2026-09-21 定的口径）。
 */
export const INTERRUPTIBLE: Readonly<Record<MainActivityKind, boolean>> = {
  mining: true,
  salvaging: true,
  hauling: true,
  wormholeScan: true,
  standby: true,
  refine: true,
  manufacturing: true,
  expedition: false,
  deliver: false,
  siteDeliver: true,
  lab: true,
}

/** 每项的取消代价（写进统一日志与警告；措辞按现行游戏语义，不写原因解释） */
export const HALT_COST: Readonly<Record<MainActivityKind, string>> = {
  mining: '本趟原矿留在船上，舰船返港',
  salvaging: '本趟残骸留在船上，舰船返港',
  hauling: '本段报酬拿不到（报酬到站才结）',
  wormholeScan: '扫描进度保留',
  standby: '舰船召回母港',
  refine: '停炉——当前那一批的进度丢弃',
  manufacturing: '停线——当前那一批的进度丢弃',
  expedition: '远征无法中断',
  deliver: '投送不可取消',
  siteDeliver: '交付循环停止、舰船返港，本趟建材留在船上',
  lab: '停线——当前那一批的进度丢弃',
}

/**
 * **取消代价的文案 id**（2026-09-27 补；与上表逐字同义）。
 *
 * 为什么必须另配一张 id 表：`HALT_COST` 的值是**参数值**——它被塞进统一日志的 `{p2}`、
 * 也被塞进警告句的 `{p2}`，而**参数值不会再被翻译**（见 `ACTIVITY_LABEL_ID` 头注的同一条口径）
 * ⇒ 英文界面下这两句里就剩下这一截中文。改造前它和活动名是**同一个毛病**，
 * 活动名那半截于 2026-09-26 补好了，代价这半截留到本次（三号核验批）。
 *
 * ⚠ 与 `HALT_COST` 的一致性靠用例钉（`activity-gate.test.ts`：两张表逐档同键、中文逐字相同）。
 */
export const HALT_COST_ID: Readonly<Record<MainActivityKind, string>> = {
  mining: 'core.activity.007',
  salvaging: 'core.activity.008',
  hauling: 'core.activity.009',
  wormholeScan: 'core.activity.010',
  standby: 'core.activity.011',
  refine: 'core.activity.012',
  manufacturing: 'core.activity.013',
  expedition: 'core.activity.014',
  deliver: 'core.activity.015',
  siteDeliver: 'core.activity.016',
  lab: 'core.activity.017',
}

/** 活动名（统一文案里用；与活动栏的写法一致） */
export const KIND_LABEL: Readonly<Record<MainActivityKind, string>> = {
  mining: '开采',
  salvaging: '打捞',
  hauling: '长途运输',
  wormholeScan: '扫描虫洞',
  standby: '掩护巡逻',
  refine: '亲自开炉',
  manufacturing: '亲自开线',
  expedition: '远征',
  deliver: '快递投送',
  siteDeliver: '建站交付',
  lab: '实验室',
}

/**
 * **活动名的文案 id**（2026-09-26 补；船长报障「部分遗漏未本地化的文本」）。
 *
 * 为什么需要：`KIND_LABEL` 是**中文名表**，而它的值会被当**参数**塞进日志
 * （`logAutoHalt` 的 `{p1}`）与进洞停机提示里 ⇒ 参数值**不会再被翻译**，英文界面下就漏中文。
 * 约定（与 `i18n/locale.tsx` 的 `paramText` 同款）：给该参数配一个 `p1Id`，由渲染层先翻好再喂进去；
 * `paramText` 只认 `core.` 前缀的 id ⇒ 本表落 `core.activity.*` 命名空间（`labelsText.ts` 按它反查）。
 *
 * ⚠ 四档复用既有 id（开采 / 打捞 / 长途运输 / 扫描虫洞——活动栏与星图页同词），其余六档新登记。
 */
export const ACTIVITY_LABEL_ID: Readonly<Record<MainActivityKind, string>> = {
  mining: 'ui.Expedition.144',
  salvaging: 'ui.Wormhole.107',
  hauling: 'ui.MapPage.006',
  wormholeScan: 'ui.MapPage.007',
  standby: 'core.activity.001',
  refine: 'core.activity.002',
  manufacturing: 'core.activity.003',
  expedition: 'core.activity.004',
  deliver: 'core.activity.005',
  siteDeliver: 'core.activity.006',
  lab: 'core.activity.018',
}

/**
 * 现在占着主控的是哪一项（没有 ⇒ null）。判据与活动栏同源（`state` 上的那几个 active 位）。
 * ⚠ **顺序刻意与 `activity.shipBusyLabel` 的主控分支逐项对齐**（同一把尺、同一优先级）——
 * 以后加档两处必须一起加（用例 `activity-gate.test.ts` 的矩阵会钉住）。
 */
export function mainActivityOf(state: GameState): MainActivityKind | null {
  if (state.mining.active) return 'mining'
  if (state.salvaging.active) return 'salvaging'
  if (state.hauling.active) return 'hauling'
  if (state.sideTasks.deliver !== null) return 'deliver'
  /**
   * **建站交付**（交付循环）：判据 = `transit` 在跑**且带着交付批次**——
   * 它与"换港返航/旧档在途行程"共用 `transit` 这一个槽，靠 `transit.delivery` 区分
   * （见 `cannotInterruptReason` 第③条：不带交付的 transit 才算"锁定态"）。
   */
  if (state.transit.active && state.transit.delivery !== null) return 'siteDeliver'
  if (state.standby.active) return 'standby'
  if (state.wormholeScan?.active === true) return 'wormholeScan'
  if (state.expedition.active) return 'expedition'
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return 'refine'
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return 'manufacturing'
  /* **实验室产线**（2026-10-01 船长令补登记）：只有"主控亲自运转"那条占主控，AI 核心驱动的不占 */
  if ((state.labRuns ?? []).some((r) => r.active && r.worker === 'pilot')) return 'lab'
  return null
}

/**
 * **手动工作位**（**精炼炉 / 回收炉 / 拆解台 / 制造线 / 实验室**共用的那**一个**名额）此刻被哪一条占着
 * —— `null` = 空着。**AI 核心驱动的线不算**（它们走工位上限，与手动位无关）。
 *
 * 为什么要有这个单点（**2026-10-01 船长令**：「建议改成和旧的工业一样，主控正在活动时，禁止按钮」）：
 * 界面要提示"手动位被占、先把手上那条停掉"，就得先问出"被谁占着"。这条判据原先在
 * `lab.ts` / `industry.ts` / `manufacturing.ts` 里**各写一份**（`.some(r => r.active && r.worker === 'pilot')`），
 * 界面再写第四份就是四处漂移 —— 收成这里一处（索引：`docs/single-source.md`）。
 *
 * ⚠ **不要拿 `mainActivityOf` 当这把尺**：那个函数答的是"主控此刻算在干哪一项"，有优先级
 * （采矿/打捞排在炉线之前）⇒ 旧档里"采矿 ＋ 手上一台炉"并存时它答 `'mining'`，而手动位**确实被占着**。
 */
export function manualSlotOf(state: GameState): 'refine' | 'manufacturing' | 'lab' | null {
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return 'refine'
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return 'manufacturing'
  if ((state.labRuns ?? []).some((r) => r.active && r.worker === 'pilot')) return 'lab'
  return null
}

/**
 * **不可被打断的状态**（与"哪个活动在跑"无关的那几种；船长 2026-09-21：「处在战斗中的时候也设置为不可取消」）。
 * 返回中文理由（给玩家看），没有 ⇒ null。
 */
export function cannotInterruptReason(state: GameState): string | null {
  // ① 战斗中：三处战斗槽（远征实时战 / 低安遭遇战 / 洞内战）——洞内另有"不可撤退"那条既有裁定
  if (state.expedition.battle !== null) return '战斗中：这一场打完才能切换主控活动。'
  /**
   * 低安遭遇战：**只有打在主控船上的那一场**才拦（`encounter.shipId === state.shipId`）——
   * 副船遇袭不占主控活动位，主控照常可以换活干（与 `pilotUnavailableReason` 的口径一致）。
   */
  if (state.encounter.active && state.encounter.battle !== null && state.encounter.shipId === state.shipId) {
    return '战斗中：这一场打完才能切换主控活动。'
  }
  if (state.wormhole.run?.battle != null) return '战斗中：这一场打完才能切换主控活动。'
  /**
   * ② **本趟虫洞没结束就锁住主控**（进洞 = 主控的一个活动；别的活动一律开不了）。
   *
   * ⚠ **2026-09-27 船长改判（原话：「进行虫洞时，阻止主控的任何其他活动。」）**：
   * 判据由 `run != null && run.attending === true` 收紧为 **`run != null`** ——
   * 原先那条口子（**临时离开虫洞界面 ⇒ 活动停止、主控立刻释放、可以去做别的**）是船长 2026-09-13
   * 批准的旧口径，**本次作废**：临时离开仍可（关面板、本趟进度原样保存），但**不能再开任何别的
   * 主控活动**，要去做别的必须先**撤离**（或本趟全损收场）。
   * ⇒ 这也是"虫洞打到一半切出去跑快递"那条路的封口（原先 `attending === false` 时闸门放行）。
   */
  if (state.wormhole.run != null) {
    return '本趟虫洞探索还没收场：先撤离，才能切换主控活动。'
  }
  /**
   * ③ **换港返航途中**（瞬时到站，等一拍就好）——⚠ **只认"不带交付批次"的 transit**：
   * **建站交付**（`transit.delivery !== null`）是主控活动之一（见 `mainActivityOf`），
   * 走三档分类（可自动停），不再算锁定态（**2026-09-22 船长令**）。
   */
  if (state.transit.active && state.transit.delivery === null) return '换港返航途中：抵达后就能切换主控活动。'
  return null
}

export interface GateVerdict {
  /**
   * - `ok` = 主控空着，直接开始；
   * - `halt` = **直接切**：先把 `halted` 那项自动停掉（代价见 `HALT_COST`），再开始；
   * - `confirm` = **先警告**：写清"将停谁、代价是什么"，玩家确认后执行（`interruptible: false` 时确认也没用，
   *   仍按 `reject` 处理——远征/快递）；
   * - `reject` = 不能切（战斗中 / 洞里 / 返航途中，或在途且不可中断的活动）。
   */
  action: 'ok' | 'halt' | 'confirm' | 'reject'
  /** `halt`/`confirm`/`reject` 时：占着主控的那一项 */
  current?: MainActivityKind
  /** `confirm`/`reject` 时：给玩家看的一句话（已含代价） */
  message?: string
  /** 上面那句话的 id 与参数（界面走 `cmdText` 取当前语言；`p1/p2` 是活动名与代价） */
  messageId?: string
  messageParams?: Readonly<Record<string, string>>
  /** `confirm` 时：确认后是否真能中断（false ⇒ 界面上按 reject 呈现：置灰 + 理由） */
  interruptible?: boolean
}

/** `gateMainActivity` 的 `action: 'confirm'` 那句话用了这个 id ⇒ 界面据此"首击警告、二击执行" */
export const ACTIVITY_CONFIRM_ID = 'core.activityGate.002'

/**
 * **统一日志：已自动停止「X」：代价。**（`halt` 落地时由入口调用一次；文案与 id 都在这里，免得各写一份）
 *
 * `detail`（可选）= 那一趟的具体读数/去向（「本趟 12 单位钛，货物留在船上」「已扫 7 分钟」这类）——
 * 只在进洞那条路径上传（它原先的日志自带这些读数，改用统一日志后不能把这些信息丢掉）。
 *
 * ⚠ **2026-09-27 补齐本地化**（三号核验批：非虫洞链英文残留清理的第一步）：
 * `detail` 从"中文串"改成**结构化拒因** `CoreBlockReason`（`error` 中文原串 + `errorId` +
 * `errorParams`，与 `cannotInterruptReason` 那批同一口径）——中文正文仍由 `error` 逐字拼出，
 * 英文界面则由渲染层按 `errorId` 渲成整句。
 *
 * 落法：**挂在外层模板的空槽上**（`p4Id` = 第 4 槽那句话的 id、`p4p1…` = 它的段内参数），
 * 与 `wormholeBattleReport` 把"维修消耗"挂在 `p8Id` 上**同一套约定**，不新造机制
 * （⚠ 曾考虑走 `parts` 段链，但本仓 core 侧现役写法就是 `p{n}Id`，两套并存才是真的坑）。
 * 外层模板 `core.activityGate.007` 因此多出 `{p4}` 槽：`detail.error` 逐字落进去。
 */
export function logAutoHalt(state: GameState, kind: MainActivityKind, detail?: CoreBlockReason): void {
  const p1 = KIND_LABEL[kind]
  const p2 = HALT_COST[kind]
  /** `p1Id` / `p2Id` = 活动名与代价的文案 id（渲染层按"槽译文"约定先翻好再喂进 `{p1}` / `{p2}`） */
  const p1Id = ACTIVITY_LABEL_ID[kind]
  const p2Id = HALT_COST_ID[kind]
  if (detail !== undefined && detail.error.length > 0) {
    /** 段内参数：`p1`/`p2`… 是**该段自己**的占位符名（渲染层按"槽号 + 占位符名"取值） */
    const detailParams: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(detail.errorParams ?? {})) {
      /** 段链只承载字符串/数值（`LogParams` 里唯一的多值键是 `parts`，这里不产生） */
      if (typeof v === 'string' || typeof v === 'number') detailParams[k] = v
    }
    addLog(state, 'warn', `已自动停止「${p1}」：${p2}。（${detail.error}）`, 'core.activityGate.007', {
      p1,
      p1Id,
      p2,
      p2Id,
      p4: detail.error,
      ...(detail.errorId !== undefined ? { p4Id: detail.errorId, ...prefixParams(detailParams, 'p4') } : {}),
    })
    return
  }
  addLog(state, 'warn', `已自动停止「${p1}」：${p2}。`, 'core.activityGate.001', { p1, p1Id, p2, p2Id })
}

/** 把段内参数改成 `p{n}p{k}` 形态（渲染层"槽号 + 占位符名"取值约定，见 `i18n/locale.tsx`） */
function prefixParams(src: Readonly<Record<string, string | number>>, prefix: string): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(src)) out[`${prefix}${k}`] = v
  return out
}

/**
 * **开始一项主控活动前的唯一判据**（各 `start*` 入口调用它，再按 `action` 落地）。
 *
 * ⚠ 调用顺序要求：**先过完"新活动自己的前置校验"，再调本函数**——否则会出现"先停了玩家的活、
 * 再告诉他这活开不了"（现行几条链里已有这条纪律，见 `hauling.startHauling` 的注释）。
 */
export function gateMainActivity(state: GameState, next: MainActivityKind): GateVerdict {
  return verdictOf(state, next)
}

/**
 * 判据本体：`next = null` 表示**这次的切入点没有"新活动"可命名**（换驾驶 / 进洞——它们不是九项之一，
 * 但同样要"先把手上的活收掉"）⇒ 不适用"同项直接放行"那一条。
 */
function verdictOf(state: GameState, next: MainActivityKind | null): GateVerdict {
  const locked = cannotInterruptReason(state)
  if (locked !== null) {
    /** 三种锁定态各有自己的 id（界面按当前语言渲染；`error` 那份中文原串只作兜底） */
    const id = locked.includes('战斗中')
      ? 'core.activityGate.004'
      : locked.includes('虫洞')
        ? 'core.activityGate.005'
        : 'core.activityGate.006'
    return { action: 'reject', message: locked, messageId: id }
  }
  const current = mainActivityOf(state)
  if (current === null) return { action: 'ok' }
  if (next !== null && current === next) return { action: 'ok' }
  const cost = HALT_COST[current]
  const costId = HALT_COST_ID[current]
  const label = KIND_LABEL[current]
  const labelId = ACTIVITY_LABEL_ID[current]
  if (AUTO_HALT_KINDS.includes(current)) return { action: 'halt', current }
  const interruptible = INTERRUPTIBLE[current] === true
  const messageId = interruptible ? ACTIVITY_CONFIRM_ID : 'core.activityGate.003'
  const message = interruptible
    ? `${label}进行中：切换会中断它——${cost}。再点一次即确认：自动停止并开始新活动。`
    : `${label}进行中：${cost}——这一趟不能中断，等它结束再切换。`
  /**
   * `p1Id`/`p2Id`（2026-09-27 补）：活动名与代价都是**参数值**、不会再被翻译 ⇒ 两个槽各配一个 id，
   * 英文界面下这句警告才整句是英文（见 `HALT_COST_ID` 头注）。
   */
  return {
    action: interruptible ? 'confirm' : 'reject',
    current,
    message,
    messageId,
    messageParams: { p1: label, p1Id: labelId, p2: cost, p2Id: costId },
    interruptible,
  }
}

/**
 * **换驾驶 / 进洞**这类"没有新活动名"的切入点：照同一条判据裁决"能不能动手"。
 *
 * `warnConfirmed = true` = 界面**已经做过两段确认**（换驾驶的 `switchAskId` · 进洞的 `enterHaulAsk`，
 * 都在动手指令之前弹过「会中断长途运输」的警告）⇒ 长途运输那一档直接落成 `halt`；false ⇒ 返回 `confirm`
 * 交界面去问（不新造交互，沿用 2026-09-20 那套）。
 */
export function gateMainActivityHandoff(state: GameState, warnConfirmed = true): GateVerdict {
  const v = verdictOf(state, null)
  if (v.action === 'confirm' && warnConfirmed && v.current !== undefined) {
    return { action: 'halt', current: v.current }
  }
  return v
}

/** 入口把它原样返回给界面时的形状（与 `engine.CommandResult` 的前三个字段同构） */
export interface ActivityGateSkip {
  ok: false
  error: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
}

function skipOf(v: GateVerdict): ActivityGateSkip {
  return {
    ok: false,
    error: v.message ?? '',
    ...(v.messageId !== undefined ? { errorId: v.messageId } : {}),
    ...(v.messageParams !== undefined ? { errorParams: v.messageParams } : {}),
  }
}

/**
 * **九项 `start*` 入口的唯一落地口**：判据 → 该停的停掉（＋统一日志）→ 告诉入口能不能开工。
 *
 * 返回值：`null` = 可以照常开工（需要自动停机的，这里已经停好并记了日志）；
 * 非 null = **原样返回给界面**（`confirm` 与 `reject` 都按"没开工"处理——`confirm` 那句 warning 由界面
 * 两段确认消化，见 `ACTIVITY_CONFIRM_ID`）。
 */
export function applyActivityGate(state: GameState, next: MainActivityKind, ctx?: SimContext): ActivityGateSkip | null {
  const v = gateMainActivity(state, next)
  if (v.action === 'ok') return null
  if (v.action === 'halt') {
    if (v.current !== undefined) haltAndLog(state, ctx, v.current)
    return null
  }
  return skipOf(v)
}

/**
 * **换驾驶 / 进洞的唯一落地口**：判据 → 该停的停掉（＋统一日志）。`null` = 可以动手。
 * ⚠ 采矿/打捞在"换驾驶"那条路上有**自己的善后**（旧船按阶段自动返航卸货，见 `shipyard.changeShip`）
 * ⇒ 那条路只用本函数**判据**（`gateMainActivityHandoff`），不要用它替你停机。
 */
export function applyActivityHandoff(state: GameState, ctx: SimContext | undefined, warnConfirmed = true): ActivityGateSkip | null {
  const v = gateMainActivityHandoff(state, warnConfirmed)
  if (v.action === 'ok') return null
  if (v.action === 'halt') {
    if (v.current !== undefined) haltAndLog(state, ctx, v.current)
    return null
  }
  return skipOf(v)
}

/**
 * **玩家确认"中断当前活动"**（两段确认的第二下 / 界面通用收尾）：停掉它并按统一口径记一条日志。
 * 返回被停掉的那一项（没得停 ⇒ null）。不碰"本就不可中断"的远征/快递（那两项永远走拒绝）。
 */
export function haltCurrentActivity(state: GameState, ctx?: SimContext): MainActivityKind | null {
  const current = mainActivityOf(state)
  if (current === null) return null
  if (!AUTO_HALT_KINDS.includes(current) && INTERRUPTIBLE[current] !== true) return null
  haltAndLog(state, ctx, current)
  return current
}

/**
 * 停机 + 统一日志（两件事永远成对 ⇒ 收成一处，免得哪条路径漏写日志）
 *
 * 🔴 **本文件不许 import 作业模块**（**2026-10-02 两次踩到**）：为了"被活动挤掉时建返航账本"，
 * 我曾在这里 import `mining`/`salvaging` ⇒ `activityGate ↔ mining`（`mining` 也 import 本文件）成环，
 * 游戏启动即炸（`PLUG_BLACKBOX_ITEM_ID before initialization`；同族症状还有 `HOME_GALAXY_ID`）。
 *
 * 账本由 `state.haltActivityForSwitch` 用**纯数据**先建一份占位（它同样不能 import 作业模块），
 * 再由 **`engine.advanceGame` 下一拍**用真值重算（那里可以安全 import 作业模块）。
 */
function haltAndLog(state: GameState, ctx: SimContext | undefined, kind: MainActivityKind): void {
  void ctx
  haltActivityForSwitch(state, kind)
  logAutoHalt(state, kind)
}

/**
 * **2026-09-09（船长定）：驾驶船不可用原因**——记录缺失 或 正被 AI 执勤占用
 * （弃船补驾驶曾误选 AI 船，造成"驾驶船 = AI 执勤船"双驾驶重叠）。
 *
 * **2026-10-02 破环搬家**：原住 `shipyard.ts`；这是**主控活动判据**，而 mining/salvaging/expedition/
 * location 各 `start*` 入口都要读它 ⇒ 搬到本件（主控活动判据的家），断 `mining ↔ shipyard` /
 * `salvaging ↔ shipyard` 的其中一条边（行为逐字不变）。
 */
export function pilotUnavailableReason(state: GameState): string | null {
  if (!state.fleet[state.shipId]) return '舰队里找不到当前驾驶的舰船——请到舰船页检查舰队。'
  if (state.aiAssignments[state.shipId] !== undefined) {
    return '当前驾驶的舰船正被 AI 执勤占用（采矿/打捞/掩护巡逻）——请先取消该船 AI 任务，或切换其它舰船。'
  }
  return null
}
