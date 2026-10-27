/** 功能域职责拆分，保持原计算与顺序。 */


export interface WeekendEventState {
  /** 本次入侵编号（自增；随机子流的盐） */
  seq: number
  /** T0（墙钟；正常 = 周五 20:00，调试 = 上一场结束 + 1h） */
  startedAtWallMs: number
  /** 结束墙钟（未结束 = 缺省） */
  endedAtWallMs?: number
  /** 核心星系（已探索 · 中安/低安 · 无已建副站） */
  coreId: string
  /** 外围 = 核心的全部邻居（不封顶；**含高安**） */
  peripheryIds: string[]
  /** 本周入侵族 id */
  family: string
  /** 玩家推进台账：galaxyId → 累计投入比例（0~1 的加数） */
  contributed: Record<string, number>
  /**
   * **点火来源留痕**（**2026-10-01 船长令**：「**如果玩家在高安使用信号发射器，触发入侵的通讯会在开头
   * 怀疑玩家，并在文本中说扣玩家的声望。**」）⇒ 高安点火那一场记 `true`，预警信改用怀疑变体首段
   * （`weekendComms.weekendWarnCommsOf` 读它决定要不要加 `core.weekend.044`）。
   * ⚠ 缺键 = 老档 / 每周那场自己爆发的入侵 / 默认路点火（不扣声望）⇒ **没有怀疑段**，行为与从前一致。
   */
  beaconHighSec?: boolean
  /**
   * **这一场是玩家用信号发射器点起来的**（**2026-10-01 船长令**：「**玩家用信号发射器召唤的入侵，
   * 每次完成只给 5 声望。**」）——**任何**点火路径（仓库直用 / 星图指定）都记它；
   * 结算时的声望按 `weekendStandingGainOf` 取（点火场固定 5 点）。
   * ⚠ 缺键 = 每周那场自己爆发的入侵（不受影响）。
   */
  beaconLit?: boolean
  /** 核心条满（旗舰现身）的墙钟 */
  flagshipAtWallMs?: number
  /** 旗舰结局：玩家击毁 / 章鱼人摧毁 */
  flagshipDown?: 'player' | 'octopus'
  /**
   * **玩家亲手击沉旗舰的留档**（**2026-09-27 船长令**：「**和入侵结束的报告一样，留档玩家的旗舰战记录。
   * 直到下一次入侵开始时覆盖清空。**」＋「**开关不能挂旗舰身上吗？旗舰爆炸开启。**」）。
   *
   * 为什么要有它（船长同日第 4 问的答案）：原先的归属只有一条算术——`玩家已造成 ＋ 章鱼已削 ≥ 池子`，
   * 谁先把自己的账顶满谁得；而玩家的实战伤害**要到战斗收尾那一刻才进账**。于是"玩家的战斗其实把母舰
   * 打沉了、却因为收尾被丢或账差一点而被显示成章鱼抢头"这类错配无法自证。本记录改记**事实**：
   * 母舰在玩家的战斗里爆炸那一刻置位（来源 = `combat.applyFoeUnitDamage` 在母舰单位三层血清零时落的
   * `BattleState.bossDownAtMs`），**与池子算术无关**。
   *
   * 生命周期：随事件对象**换场即消失**（下一次入侵开局是全新对象）⇒ 等价于"下一次入侵开始时覆盖清空"；
   * 结算之后仍留在档里，供结算面板 / 结算通讯 / 查档读。
   *
   * 用途（船长裁定「**只记录作为判定**」）：① 归属与措辞以它为准（开关为真 ⇒ 一律按玩家击沉说）；
   * ② **不参与发奖算术**（黑匣仍按爆率表掷）。
   */
  flagshipPlayerKill?: {
    /** 母舰爆炸的墙钟（置位那一刻） */
    atWallMs: number
    /** 那一场战斗的身份（= `battle.startedAtGameMs`；查档/幂等用） */
    runId: number
    /** 母舰爆炸时打到第几波（0 基；查档用） */
    waveIdx?: number
    /** 母舰被打沉的战斗时钟（= 单位上的 `downAtMs`） */
    downAtGameMs: number
  }
  /**
   * **本场黑匣结清了没有**（**2026-09-28 船长令改口径**后这个字段的含义换了，判据见
   * `weekendBlackBoxSettledOf`）：`true` = 这一枚已经发到玩家手里并记了账 · 缺省 / `false` = 还没结清。
   *
   * ⚠ **随档落盘**（`save.ts` 读档侧必须认它）：不然读档后结算会重发。
   * ⚠ 旧含义是"掷骰结果（爆了没有）"，随爆率表一起作废；老档两个取值在新语义下都自洽（零迁移）。
   */
  flagshipBlackBox?: boolean
  /* ─── 旗舰 BOSS 化（2026-09-24 第二轮令；**只有 `WEEKEND_BOSS_FAMILIES` 里的族会写这三格**）─── */
  /** **池子总量**（首次接战后锁定；缺省 = 还没跟母舰交手过） */
  flagshipHpMax?: number
  /** **玩家已造成的伤害**（跨场累计；只算打进母舰的原始伤害） */
  flagshipHpDone?: number
  /** **章鱼人累计削掉的血量**（**2026-09-25 共享血条口径**：与玩家的 `flagshipHpDone` **加在同一条血**上；
   *  只累计"在线且非战斗"的时长 —— 战斗中/离线都暂停，速率 = `池子总量 ÷ 窗口`） */
  octopusHpDone?: number
  /** **上一场记账的战斗身份**（= `battle.startedAtGameMs`；同一场重复结算据此幂等） */
  flagshipRunId?: number
  /** **上一拍章鱼削血的心跳墙钟**（只用于算拍间增量；缺省 = 本拍只立基线、不累计） */
  bossTickWallMs?: number
  /**
   * **章鱼人停工到这一刻**（**船长 2026-09-26 令**：「**给章鱼人进攻削血加个冷却，玩家战斗结束 1 分钟后，
   * 章鱼人才开始削血和判定**」）。
   *
   * 口径（修订 2026-09-24「等玩家战斗结束才继续」那条：**结束后再等 60 秒**）：
   * - **只有旗舰战**（遭遇槽里那一场）会推它：战斗进行中每拍把它推后到 `now + 60 秒`；
   * - 停工期（战斗中 ＋ 旗舰战结束后 60 秒）**既不削血、也不判得手**；
   * - 停工期**不吃事后补算**（拍基线照常同步 ⇒ 解禁那一拍不会把 60 秒当掉线时长补削）；
   * - 与"任何战斗都暂停削血"那条旧口径**并存**（本条只在旗舰战后面多一条 60 秒尾巴）。
   *
   * ⚠ **随档落盘**（`save.ts` 读档侧必须认它）：否则读档即丢 ⇒ 冷却被读档绕过。
   */
  octopusHoldUntilWallMs?: number
  /**
   * **本场收场的顺延终点**（**船长 2026-09-27 令**：「**到点的延期到玩家打完1分钟后**」；
   * 常量见 `WEEKEND_WINDOW_END_HOLD_MS`）。
   *
   * 口径（⚠ **2026-10-02 船长令「乙」只换了"到点"的含义，本条其余一字不变**）：
   * - **判据 = "此刻还有一场没打完的旗舰战"**（`weekendLaunch.weekendFlagshipBattleActive`，读的是
   *   存档里的遭遇槽 ⇒ **打到一半退出游戏、回来接着打也算"没打完"**，不会因为掉线丢场次）；
   * - 到点后有战斗在打 ⇒ 本拍**不结束**，并把本格推到 `now + 60 秒`（与章鱼停工同一把尺）；
   * - 战斗结束后这 60 秒里**仍然不结束**；满 60 秒那一拍才收场（文案走 `ui.weekend.117`）；
   * - **顺延期间章鱼人也不判得手**（船长同日裁定「要一起闸」）⇒ 不会出现"延期了却被章鱼先收走"；
   * - **不设时限**（船长 2026-09-27 裁定「甲」）：那场没打完就一直等 —— ⚠ 旧口径下"真拖到下一场 T0
   *   还没收场 ⇒ **下一场入侵取消**"，**该路径自 2026-10-02「乙」起不可达**：到点改成"下一期 T0 已到"
   *   之后，旧场就是在下一期 T0 那一拍被收掉的，不存在"拖过 T0 还活着"。
   *
   * ⚠ **随档落盘**（`save.ts` 读档侧必须认它）：否则读档即丢 ⇒ 顺延被读档绕过。
   * 缺省（老档 / 从没顺延过）= 不顺延 ⇒ **零迁移**。
   */
  windowEndHoldUntilWallMs?: number
  /* ─── 结束结算（2026-09-25 · M1-b 收尾）─── */
  /**
   * **贡献奖已发放的墙钟**（幂等标记；缺省 = 还没结过）。
   * ⚠ 占比按 **`endedAtWallMs`** 评估后发放（NPC 铺底是时间函数，晚算会把占比算低 ⇒ 少发）。
   */
  prizePaidAtWallMs?: number
  /**
   * **本场到手台账**（2026-09-25 加 · 结算面板与通讯正文都读它）：三处入账时累加 ——
   * 夺回奖励（逐星系）· 贡献奖 · 旗舰掉落。目的 = **"说的与发的逐值一致"**
   * （面板/通讯里的奖励清单不许另算一遍），且下一场开局会把进度台账清掉、只有这里留得住数。
   */
  rewardLedger?: {
    isk: number
    wreck: number
    blackBox: number
    /** 逐星系的夺回奖励（面板"各星系贡献"那一列用） */
    byGalaxy: Record<string, { isk: number; wreck: number }>
  }
  /**
   * **待到账的夺回奖励**（2026-09-25 船长令：「**夺回星区的奖励不要即时发放，放入结束后结算发放**」）：
   * 每夺回一处就往这里累加（含全清追加），活动结束时由 `weekendSettleAndGrant` 连贡献奖**一次性发**。
   * ⚠ 与 `rewardLedger` 的分工：台账 = **总数**（面板/通讯显示用，含已发与待发）；这一格 = **还没发的那部分**。
   */
  reclaimPending?: { isk: number; wreck: number }
  /**
   * **已经记过夺回奖的星系**（**2026-09-27 玩家报障修复**）：夺回奖原先挂在"战斗结算"那一拍，
   * 而夺回实际是**按进度判**的（多为逐拍推满、根本没经过战斗）⇒ 那一场 4/4 夺回却一分没发。
   * 现在改为逐拍检测「已夺回 ∧ 未记账」⇒ 用本数组防重复发。
   */
  reclaimPaid?: string[]
  /**
   * **本场"主动出击"已出发的次数**（2026-09-25 船长令「主动出击也要每场重抽」）：
   * 抽签盐 = `WEEKEND_ASSAULT_SALT_BASE + 次数` ⇒ 每按一次出击换一支，且随档（读档后不重复同一支）。
   */
  assaultDraws?: number
  /**
   * **入侵「重复出击」的循环目标 = 被占星系 id**（2026-09-25 船长令：「入侵活动的悬赏，允许玩家开启
   * 自动重复，照常计算返回时间」）；缺省/空 = 没开。
   * 2026-10-08确认：收复后切下一外围，最后核心；全清停止，旗舰由玩家手动挑战。
   *
   * ⚠ 落在**周末活动对象**上（而不是新增顶层字段）有两个好处：① 与 `assaultDraws` 同款"可选字段"口径
   * ⇒ **不必动存档结构版本、老档零迁移风险**；② 活动结束/换周时整个 `weekendEvent` 被换掉 ⇒ 循环
   * **天然随之结束**（与"活动结束即停"的裁定同构）。
   */
  autoLoopGalaxyId?: string
}

/**
 * **上一场入侵的战果快照**（结束时写一次；**每场覆盖**）：
 * 结算面板与结算通讯都读它——因为下一场开局会把 `state.weekendEvent` 整条换成新的
 * （进度台账、旗舰池、出场星系全清），旧场的读数只有快照里还留着。
 */
export interface WeekendResultSnapshot {
  /** 场次编号（与通讯里的"第 N 场"同源） */
  seq: number
  family: string
  /** 核心星系 id（面板显示名字时现查） */
  coreId: string
  /** 结束墙钟 */
  endedAtWallMs: number
  /** 旗舰结局：玩家击沉 / 章鱼人摧毁 / 集结到点（窗口关闭或没现身） */
  flagshipOutcome: 'player' | 'octopus' | 'window'
  /** 贡献占比与档位（结束时那一刻的读数） */
  share: number
  tier: 'A' | 'B' | 'C' | 'D' | 'none'
  /** 逐处占领区：玩家投入 · 该处进度 · 是否夺回 · 该处拿到的夺回奖励 */
  galaxies: Array<{ galaxyId: string; put: number; progress: number; reclaimed: boolean; isk: number; wreck: number }>
  /**
   * 旗舰战输出（没跟母舰交手过 = 缺省）。
   * ⚠ `defeated` = **玩家击沉** —— 判据是**单点** `weekendFlagshipOutcomeOf`（**留档优先**：
   * 有 `flagshipPlayerKill` ⇒ 一律算玩家击沉），**不是**"玩家那份伤害 ≥ 池子"（共享血条下血条由
   * 玩家 ＋ 章鱼人一起削，2026-09-25 船长报障修），**也不是**半套的 `flagshipDown === 'player'`
   * （2026-09-28 更正注释；那一场"留档说打爆了、`flagshipDown` 却是 `octopus`"正是报障现场）。
   */
  flagship?: { hpMax: number; hpDone: number; defeated: boolean; playerFrac?: number; octopusFrac?: number }
  /**
   * **玩家亲手击沉的留档**（**2026-09-27 船长令**：「和入侵结束的报告一样，留档玩家的旗舰战记录」）——
   * 事实来源 = `WeekendEventState.flagshipPlayerKill`（母舰在玩家的战斗里爆炸那一刻置位）。
   * 缺省 = 本场没有"玩家亲手击沉"的记录（老快照、或玩家没打沉）。面板/通讯以它为准显示归属。
   */
  flagshipPlayerKill?: { atWallMs: number; waveIdx?: number }
  /**
   * **进度收入**（2026-09-25 船长令「入侵舰队不应该有赏金……在结算时候直接按进度获取收入」）：
   * 玩家投入进度合计（0~1 的百分比读数，如 1.35 = 135%）与该笔收入（ISK）。
   * 缺省 = 老快照（本批之前结束的活动没有这一栏；界面按缺省不显示该行）。
   */
  progressPct?: number
  progressIsk?: number
  /**
   * **本期入侵按贡献获得的「深空工业协会」声望**（**2026-09-26 船长令**：「**关于入侵的结算界面和
   * 结束通讯处，需要提及玩家获得了多少声望**」）。
   *
   * 口径 = 结算那一拍现算的 `round(占比 × WEEKEND_STANDING_MAX(15))`（见 `weekendBattle` 的
   * `weekendSettleAndGrant`）；**缺省 = 这一栏之前结束的活动**（老快照）⇒ 界面与通讯按缺省不显示该行。
   */
  standing?: number
  /** 到手合计（含旗舰掉落）与奖励物品 id（面板/通讯点物品名用） */
  isk: number
  wreck: number
  blackBox: number
  wreckItemId?: string
  /**
   * **本场发的黑匣是哪一件**（**2026-10-02 船长令「甲」**：**一件族一件匣**，起因 = 玩家报障
   * 「**光环入侵结束给的黑匣还是墨潮的**」）——取数口 `blackBoxItemIdOfFamily(族)`（`blackbox-<族小写>`）。
   *
   * 缺省 = **本批之前结束的场次**（那时只有 H 一件，`weekendGrantRewards` 写死发它）
   * ⇒ 结算面板与结算信按缺省显示**墨潮旗舰黑匣**，与玩家当时真正到手的那件一致（**不回改历史读数**）。
   */
  blackBoxItemId?: string
}

/** 遇袭抽签结果：卡 + 强度倍率 + 玩家可见的威胁标签 */
export interface WeekendAmbushPick {
  cardId: string
  strengthMul: number
  /** 标签（H 族 = **缩放后实测价**反解；A/C/G = 主动威胁 × 倍率，与它们主动标签同一把尺） */
  threat: number
}

export interface WeekendFlagshipView {
  /** 是否已现身（核心条满） */
  shown: boolean
  /** 现身时刻 */
  atWallMs?: number
  /** 击毁时限（含离线保护后的实际起算点） */
  deadlineWallMs?: number
  /** 结局：player = 玩家击毁 · octopus = 章鱼人摧毁 */
  down?: 'player' | 'octopus'
}

/** tick 结果：引擎据它记日志/弹卡/掷遇袭骰 */
export interface WeekendTickResult {
  /** 本次 tick 是否新开了一场 */
  started: boolean
  /** 旗舰是否已现身 */
  flagshipShown: boolean
  /**
   * **本拍正是"旗舰现身"的那一拍**（2026-09-25 加 · 修船长报障「事件日志会一直刷『入侵核心已被打通：旗舰现身。』」）：
   * `flagshipShown` 只要现身就恒真（每拍都真）⇒ 引擎照着它记日志会**每拍刷一条**；
   * 这一格只在**首次把 `flagshipAtWallMs` 落盘**的那一拍为真 ⇒ 记日志 / 弹一次窗都按它来。
   */
  flagshipAnchored: boolean
  /** 旗舰结局（本 tick 新发生） */
  flagshipDown?: 'player' | 'octopus'
  /** 本 tick 是否结束（旗舰被摧毁 / 章鱼人得手 / **本场该收场**：周排期场=下一期 T0 已到 · 召唤场=自己 +96h） */
  ended: boolean
  /** 该掷遇袭骰的星系（未夺回）与各自概率 —— **掷骰在引擎**（随机源在那边） */
  encounterRolls: Array<{ galaxyId: string; chance: number }>
}

/** **BOSS 池读数**（供界面血条：剩余 / 总量 / 玩家进度 / 章鱼进度；非 BOSS 族 ⇒ `null`）。
 *  ⚠ **2026-09-25 共享血条**：`hpLeft = 总量 −（玩家 ＋ 章鱼）`（两者都真实减少同一条血）；
 *  `playerFrac` / `octopusFrac` = 各自占**血条总量**的份额（`octopusFrac` 只留给内部读数，
 *  界面上**不再单独显示**——船长：「不需要显示章鱼人削减进度和倒计时」）。 */
export interface WeekendBossPoolView {
  hpMax: number
  /** 玩家已造成（跨场累计） */
  hpDone: number
  /** **血条剩余** = `总量 −（玩家已造成 ＋ 章鱼已削）` */
  hpLeft: number
  /** 章鱼人已削掉的量（折成血量；与玩家那份相加即已掉的血） */
  octopusDone: number
  /** 玩家进度（0~1：`hpDone / hpMax`） */
  playerFrac: number
  /** 章鱼进度（0~1：`章鱼已削 / hpMax`）——**仅内部读数，界面不显示** */
  octopusFrac: number
}
