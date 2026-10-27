/** 功能域职责拆分，保持原计算与顺序。 */


/** 机群战损结算结果（结构化，2026-09-11 船长「在战斗报告中显示」）：
 * 战报弹层据此展示两行——汇总（损坏/回收/净损失）+ 逐型明细（回收名单 ｜ 净损失名单）。
 * rows 按**机型基准价降序**（高价值在前，与"优先回收高价值"的观感一致）。 */
export interface DroneLossReport {
  /** 新虫洞趟：复位为备用机转入战斗，不冲减实际损坏次数。 */
  revived?: number
  returnedToSupply?: Record<string, number>
  /** 该场战斗起手时刻（与战报快照配对，避免并行战斗结果串场） */
  battleStartedAtGameMs: number
  /** 本场回收率（0~1） */
  rate: number
  /** 损坏合计架数 */
  total: number
  /** 回收归队合计架数 */
  recovered: number
  /** 净损失合计 = total − recovered */
  gone: number
  /**
   * **补货前的存活架数**（船长 2026-09-20「战斗结束立刻自动补充机群」那一批）——
   * 战后立刻补足会把清单补回本场出发时的编制，故"战损过半停环"的记账与判定必须读这里，
   * 不能读补货后的清单（否则安全阀永远判不出来）。
   */
  survivors?: number
  /** 逐型明细（按机型价值降序） */
  rows: Array<{ id: string; name: string; value: number; lost: number; back: number; gone: number }>
}

/**
 * **战报来源**（2026-09-14 船长定：战报改造）。
 * 只用来给界面选措辞（战场在哪 / 谁打的），**不参与任何数值**。
 */
export type BattleReportSource = 'expedition' | 'encounter' | 'wormhole' | 'ai'

/**
 * **中止原因**（`outcome === 'break'` 时给；四档判定的"脱离"那一档都归它）。
 * 与 `BattleState.escapeReason` 同一套语汇，另加 `'manual'`（玩家主动撤退：
 * 同属"未分胜负就中止"，故判定词仍是「脱离」，只是原因更准）。
 */
export type BattleBreakReason = 'hull' | 'timeout' | 'cannot-engage' | 'manual'

/**
 * **一场战斗的结构化战报**（2026-09-14 船长定 · 战报改造）。
 *
 * ⚠ **为什么要有它**：战报弹层的正文原先靠"在事件日志里找含『战报』二字的那条"取
 * （`battleViewCore.lastBattleReport` 的字符串匹配）—— 而**洞内战斗**写的是
 * 「🕳 第 N 层…交火结束：…」、**低安遭遇**写的是「★ 遭遇战大捷（…）」、**无法交战**写的是
 * 「⚔ 无法交战（…）」，**三条都不含『战报』** ⇒ 那三类战斗的弹层**永远取不到正文**，只剩兜底句。
 * 而且标题只看胜负（`ended === 'me'`）⇒ **沉了船也写「大捷」**、卡片上根本没有"损失"这一行。
 * 现在改为：**引擎在结算时写这一份结构**（唯一构造点 `combat.captureBattleReport`），
 * 弹层直接读它；判定词由纯函数 `combat.battleVerdictOf` 出（**纯函数才进得了用例** —— 渲染层
 * 没有测试运行器，上一轮的弹道 bug 就吃过这个亏）。
 *
 * **不落档、零迁移**（照 `droneLossReport` / `wormhole.lastSettle` 惯例）：老档读到 `undefined`
 * ⇒ 弹层回落成原来那句兜底话，行为安全。
 * **并行战斗不串场**：靠 `battleStartedAtGameMs` 与弹层快照配对（AI 副船的战斗也会写一份）。
 */
export interface BattleReportRecord {
  /** 该场战斗的起手时刻（与弹层快照配对；不匹配 = 不是这一场，弹层回落兜底） */
  battleStartedAtGameMs: number
  /** 来源：悬赏远征 / 低安遭遇 / 虫洞 / AI 副船 */
  source: BattleReportSource
  /** 胜负：`win` 胜 · `lose` 负（我方全灭，含弃船）· `break` 未分胜负就中止 */
  outcome: 'win' | 'lose' | 'break'
  /** 中止原因（仅 `outcome === 'break'`） */
  breakReason?: BattleBreakReason
  /** 交火时长（ms） */
  durMs: number
  /** 双方开火/命中/伤害（与 `battle.stats` 逐字同源） */
  stats: { meShots: number; meHits: number; meDmg: number; foeShots: number; foeHits: number }
  /** **我方沉没的舰船**（显示名；判「惨胜」的唯一依据之一） */
  shipsLost: string[]
  /** **我方逐单位三层残余**（当前值 + 上限；顺序 = 主控在前、僚舰按编队） */
  myUnits: Array<{ name: string; s: number; a: number; h: number; sMax: number; aMax: number; hMax: number }>
  /** **敌方残余**：存活单位数 / 参战单位总数 / 残余血量比（`hpMax` 为分母） */
  foe: { alive: number; total: number; hpFrac: number }
  /** **本场敌方挂载件名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——去重后的展示名列表；
   *  `undefined`/空 = 本场敌人没挂任何件（老档同样缺省 ⇒ 战报回落不显示这一行） */
  foeMounts?: readonly string[]
  /** **同序的「双语名对」**（2026-09-24；与 `foeMounts` 下标对齐）——战报按当前语言挑一列 */
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  /** **本场弹药消耗**（按弹种；= 开战预载 − 战后余额，四类战斗都算得出） */
  ammoUsed: { kin: number; exp: number; pla: number }
  /** **机群净损失架数**（判「惨胜」的第二个依据；0 = 无损或本场没有机群） */
  dronesGone: number
  /** **本场引擎写的那条日志原文**（弹层正文用它 ⇒ 卡片与日志同源，不再靠字符串匹配） */
  summary: string
  /**
   * 甲案（2026-09-20）：战报正文的**首段文案 id + 参数**（含后续段的 `p{n}Id` 绑定）。
   * 有它 ⇒ 弹层按当前语言渲染；没有（老档 / 未改造来源）⇒ 回退 `summary` 中文原串。
   */
  summaryId?: string
  summaryParams?: Readonly<Record<string, string | number>>
}
