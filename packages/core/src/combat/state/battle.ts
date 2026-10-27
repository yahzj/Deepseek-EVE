/** 功能域职责拆分，保持原计算与顺序。 */
import type { BattleUnitRt, BattleFx, BattleWebDebuff, BattleFoeWebDebuff, BattleRepairLedger, BattleShieldChargeLedger, BattleShieldFieldLedger, DronePoolEntry } from './units'
import type { DamageType } from '../../types'
import type { BlinkSeg, LogParams } from '../../state'

/** V12 实时战斗持久状态（确定性事件步进；只存动态量） */
export interface BattleState {
  /** 本场入场配置快照；供玩家按卡记忆，自动模拟不写。 */
  rangeMemory?: import('../../battleRangeMemory').BattleRangeSnapshot
  foeAcidLayers?: Record<string, Array<{ cutPct: number; untilMs: number }>>
  /** 守墓族苏生协议：一次性触发与已分配维修量，跨战中读档保留。 */
  foeRebirths?: Record<string, { lockUntilMs: number; startedAtMs: number; repairUntilMs: number; lastRepairAtMs: number; armorHealed: number; hullHealed: number }>
  /** 永陵级守墓镀层装甲：每层独立到期，运行态不入档。 */
  foeCoatingLayers?: Record<string, Array<{ untilMs: number }>>
  /** 永陵级护盾蓄能：首次空盾后的运行态与各武器成功攻击次数。 */
  foeShieldCapacitorActive?: Record<string, true>
  foeShieldCapacitorAttacks?: Record<string, number>
  /** 本场逐次累计腐蚀与爆虫触发去重，跨波保留、战后随战斗销毁。 */
  alienCorrosion?: number
  acidBursts?: Record<string, { cause: 'attack' | 'killed'; atMs: number; resolved?: boolean }>
  /** 每舰孵化额度、跨舰待补机位及周期；数字机位兼容前版本舰队列。 */
  foeHatcheries?: Record<string, { left: number | 'unlimited'; revived: number; queue: Array<number | { tag: string; index: number }>; nextAtMs?: number }>
  /** 新挂件携带者的有效参战时长，供渐增加速和局部复活节拍共同读取。 */
  foeAbilityClocks?: Record<string, number>
  /** 战斗开始（到港）的游戏内时刻 */
  startedAtGameMs: number
  /** 上次推进时刻（离线大步长切段基准） */
  lastTickGameMs: number
  /** 当前距离 m */
  distanceM: number
  /** 我方期望距离（战术选择/手动拖动；落档离线沿用） */
  myDesireM: number
  /** 双方单位运行状态 */
  units: Record<string, BattleUnitRt>
  /** 我方剩余弹药（出发预载后按开火即时扣减；开火弹型 = 剩余最多型，平局 kin→exp→pla） */
  ammo: { kin: number; exp: number; pla: number }
  /** 已扣整发的剩余射击额度；原舰／武器组／弹种独占，战中随档，清场不退半发。 */
  ammoCreditByWeapon?: Record<string, number>
  /**
   * **开战预载量**（F3c B2 · 谜质「弹药回收装置」要用）：开战装完后立刻记一份，
   * 战后按「预载 − 余额」算出这一场打出去多少。
   * **只由洞内多舰开战写**（既有单船 / 远征路径不写 ⇒ 那两边看不到这个加成，零变化）。
   */
  ammoLoaded?: { kin: number; exp: number; pla: number }
  /** 弹药 MK2（2026-09-09）：本场实装弹 itemId（damageType → id；开战装载时写，缺货回退也写）。
   * 战斗推进/视图重建我方规格时以此覆盖装配档位偏好（伤害与实际弹种一致）；
   * 缺省 = 无覆盖（按船装配 ammoPref/基础弹），旧档零迁移 */
  ammoIds?: Partial<Record<DamageType, string>>
  /** 新虫洞趟按物品id共用库存，逐舰记录实际档；旧战斗不写。 */
  expeditionAmmo?: {
    stock: Record<string, number>
    loaded: Record<string, number>
    idsByTag: Record<string, Partial<Record<DamageType, string>>>
    revivesSettled?: boolean
  }
  /** 战斗累计统计（战报/小剧场用） */
  stats: { meShots: number; meHits: number; meDmg: number; foeShots: number; foeHits: number }
  /** 可视化事件环（至少48条，保留近期跨子步事件，硬上限512；不影响结算） */
  fx: BattleFx[]
  /** 下一条开火事件的序号（pushFx 自增分配；环裁剪后消费端按序号续播） */
  fxSeq: number
  /** 结束标记：'me' = 我方胜（敌编队全灭）；'foe' = 我方结构归零，**或打满战斗上限判负**
   * （2026-09-10 船长定：超时不再按剩余血量比判胜——旧口径"平局算我方胜"已作废）；
   * null = 进行中 */
  ended: 'me' | 'foe' | null
  /** 连续作战保险（2026-09-08 船长定；2026-09-11 起**低安遭遇战同样挂它**）：
   * 本场结构剩余低于该比例（相对满值结构，如 0.5 = 损失过半）→ 步进中自动中止并请求撤退（autoEscaped 置位）；
   * 悬赏巡回场次在开战时写入，低安遭遇战按 `encounter.retreatHullFrac` 写入 */
  hullEscapeFrac?: number
  /** 多波次（2026-09-09）：当前波索引（0 基；AnomalyDef.waves 缺省/单波不写，读档零迁移） */
  waveIdx?: number
  /**
   * **本场的敌群覆写**（2026-09-25 加）：开战时传进 `startBattleFor`/`startFleetBattleFor` 的
   * `combat.FoeOverride` **原样存一份**——`advanceBattleFor` 每拍从 `ctx` 重建敌卡，
   * 不存的话**只有第 0 波吃到覆写**，多波卡的后续波会回到满强度（H 族遇袭 ×0.75 的 2 波卡首当其冲）。
   * 类型与 `combat.FoeOverride` 同构（此处内联声明以避免 combat ↔ state 循环依赖）。
   * 缺省 = 无覆写（旧档与既有战斗路径零迁移、零行为变化）。
   */
  foeOverride?: {
    threat?: number
    waves?: ReadonlyArray<{ units: number; hpShare: number }>
    keepCardWaves?: boolean
    strengthMul?: number
    /** BOSS 血条覆写（2026-09-25 · 旗舰战）：本场满值 = 开战那一刻的池子剩余（见 `combat.FoeOverride`） */
    bossHp?: number
    /** BOSS 血条的**分母**（池子总量，恒定；只喂界面血条，不改台账） */
    bossHpMax?: number
    /** 母舰**当前三层血**（按 护盾→装甲→结构 顺序扣；见 `weekendEvent.weekendFlagshipLayersOf`） */
    bossHpLayers?: { s: number; a: number; h: number }
    /** 母舰三层血的**容量**（= 池子总量 × 卡面 split）：界面血条三行的分母 */
    bossMaxLayers?: { s: number; a: number; h: number }
    /** 哪一条舰级算母舰（`foeShipId`） */
    bossShipId?: string
  }
  /**
   * **本场 BOSS 被打沉的时刻**（战斗时钟 ms；**2026-09-27 船长令**）——由 `combat` 的敌舰伤害唯一收口
   * 在"母舰单位三层血清零"那一刻置位（认舰 = `foeOverride.bossShipId`）。
   *
   * 为什么记在**战斗状态**上而不是直接写场次记录：战斗状态随档持久化 ⇒ 即便这一场的收尾结算被丢掉
   * （活动已结束等），"玩家的战斗把母舰打沉了"这个**事实**仍然在档里，可由上层抄进场次记录。
   * 缺省 = 母舰没死 / 本场没有 BOSS ⇒ 零行为变化。
   */
  bossDownAtMs?: number
  /** 多波次演出间隔（2026-09-09 船长反馈）：当前波全灭时刻（lastTick 口径），配合 waveEnterGapMs
   * 等爆炸/残骸演出播完再刷下一波（零迁移可选字段） */
  waveClearAt?: number
  /**
   * **本波起点**（战斗时钟 ms；**2026-10-02 加**）——「聚焦阵列」**逐波重置**的计时锚
   * （**船长 2026-10-02 改判**：「**旗舰挂载件的会随波重置**」）。
   *
   * 语义：每次**波次转场**那一拍写一次（`advanceBattleFor` 的转场分支，取当时的全局时钟
   * ＝新一波真正入场的时刻）；**第 1 波及一切没换过波的场次不写** ⇒ 读端回落 `startedAtGameMs`
   * （`combat.foeWaveStartMsOf`，**单波卡 / 老档零迁移**）。
   *
   * ⚠ 登记为 `save.ts` 清洗器的 `kind: 'runtime'`（**有意不入档**）：它是"本波循环"的一部分，
   * 与 `foeCharges` / `foeBlinks` / `foeOverlayReload` 同一口径（重载即重置 ⇒ 回到本场起点）。
   */
  foeWaveStartMs?: number
  /**
   * **逐单位「连发」本轮已发数**（**船长 2026-10-02 令**：「**每次开火是三次间隔100ms的射击，
   * 目标选择随机。**」；给 R 族 T5「光环中枢」那把三连发武器用）。
   *
   * 键 = 战斗 tag（与 `foeBlinks` 同一把尺）；值 = **本轮已经打出去几发**：
   * - **缺省（或 0）= 本发是本轮第 1 发**；打完 `shots` 发就把键删掉（下一发重新从第 1 发起算）；
   * - 本发之后**还有几发**由调用方按 `已发数 + 1 < shots` 现判 ⇒ 还有 ⇒ 装填计时重置为 `gapMs`
   *   （100ms），打完最后一发才回到 `reloadMs`（**发间隔靠装填计时实现，不另开排期器**）；
   * - 每发都各自 `pickTarget()` ⇒ **逐发独立选靶**（船长要的"目标选择随机"）。
   *
   * ⚠ 与 `foeBlinks` 同口径：`save.ts` 清洗器登记 `kind: 'runtime'`（**有意不入档**）。
   * 字段可选 ⇒ **旧档零迁移、既有各族零行为变化**（没挂连发武器的单位一次都不写它）。
   */
  foeBurstFired?: Record<string, number>
  /**
   * **逐单位「待机护盾阵列」的本拍就绪快照**（**船长 2026-10-03 裁定**：「**同一拍整次齐射都算**」）。
   *
   * 为什么要快照而不是"现查冷却表"：闪现是**挨打触发**的（伤害结算在前、盖冷却在后）——
   * 现查的话，同一拍里只有**触发那一发**吃得到护盾抗性，随后同拍的其余发数全被刚盖上的冷却挡掉；
   * 船长第一句原话是「**触发的那次齐射**受到的伤害减半」⇒ 判据必须是**每拍开头的那一瞬**：
   * 「本拍开始时闪现是否在冷却中」，本拍之内恒定不变（同一拍的整次齐射同命）。
   *
   * 键 = 战斗 tag；值 = `{ atMs, ready }`：`atMs` = 这份快照按哪一拍（`lastTickGameMs`）算的，
   * `ready` = 那一拍开头是否就绪。由 `combat.stepBattle` **每拍开头**逐舰盖一次；
   * 拍外调用（手工状态 / 增援新 tag）走懒算回落 ⇒ 语义恒为"本拍开头"。
   *
   * ⚠ 登记为 `save.ts` 清洗器的 `kind: 'runtime'`（**有意不入档**，与 `foeBlinks` 同一口径：
   * 重载即按当时的冷却表重算本拍快照）。字段可选 ⇒ **旧档零迁移、既有各族零行为变化**。
   */
  foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
  /**
   * **本场生效倍速**（2026-09-19 船长「时间压缩矩阵」·谜质科技）：1 = 未解锁 / 洞外战斗 / 离线·后台结算。
   * 由 `combat.advanceBattleFor` **每拍**按前台心跳传入的档位刷新（夹在"科技已解锁档位"内），
   * **不落档、老档缺省 = 1**（读档零迁移）。用途：① 战斗时钟按它折算（倍速时间轴）；
   * ② 演出保护窗口（入场动画 / 波次转场 / 击杀慢镜）按它**等比放大**——倍速只压缩战斗进程、
   * **不压缩演出**（船长 2026-09-19 口径）；③ 界面按它同步自己的入场窗口。
   */
  speedX?: number
  /**
   * **倍速时间轴的锚点**（`{ anchor: 全局时钟, clock: 与该全局时刻配对的战斗时钟 }`，2026-09-19）：
   * 由 `advanceBattleFor` **每拍收尾**刷新 ⇒ 倍速按"**从锚点起的增量**"折算，**中途切档不跳变**
   * （若按"开战时刻起算"折算，玩到一半从 ×1 切 ×4 会让战斗瞬间快进掉三倍已过时长）。
   * **不落档、老档缺省**（缺省 ⇒ 折算式退化成"= 全局时钟"，即倍速功能之前的老口径）。
   */
  speedAxis?: { anchor: number; clock: number }
  /** 已触发撤离请求（步进中止，结构保留当前值；由远征结算走轻损撤退路径——绝不弃船）。
   *  三个来源：连续作战保险（结构损失过半）、**战斗超时判负**（2026-09-10 船长定）、
   *  **无法交战提前脱战**（2026-09-11 船长裁定「乙2 · 事件为 120 秒」）。 */
  autoEscaped?: boolean;
  /** 撤离来源（配合 autoEscaped；缺省 = 'hull'，旧档零迁移）：
   *  'hull' = 结构损失过半自动撤退；'timeout' = 打满战斗上限（判负，按被迫撤退处理）；
   *  'cannot-engage' = **无法交战**（开战满 `bal.cannotEngageMs` 仍'我方一炮未发 + 距离在我方射程外 + 敌已开火'） */
  escapeReason?: 'hull' | 'timeout' | 'cannot-engage';
  /**
   * **我方编队**（虫洞 D 批 · 船长 2026-09-13 定：一场战斗最多 4 艘我方同时参战）。
   * **可选、零迁移**：**不写 = 单船路径**（既有 27 张悬赏卡 / 低安遭遇 / AI 副船 /
   * 窝点派生卡全都不写，行为与随机数消费顺序逐字节不变）。
   *
   * 写了 = **多单位路径**：每条 = 一个参战单位（`tag` 为战斗内标识、`shipId` 为船型 id）。
   * 首条 = **主控**（`tag` 恒为 `'player'`，与单船路径同 tag ⇒ 存档/UI/读档口径不变），
   * 其余为僚舰 `'ally-1'..'ally-3'`；`units` 里每条的 hp/装填各自独立。
   */
  myFleet?: Array<{ tag: string; shipId: string }>
  /**
   * **本场是虫洞战斗**（F 批 · 2026-09-13）：只记"哪张敌卡 + 哪一层 + 什么用途 + 几波"，
   * 敌卡的绝对值**每拍按层重建**（静态卡由定义重建，不把整张卡存进档）。
   * **不写 = 普通战斗**（既有 27 张赏金卡 / 低安遭遇 / AI 副船）⇒ 零变化。
   */
  wormhole?: {
    /** 洞内敌卡 id（`wh-*`，见 `packages/data/src/wormholeFoes.ts`） */
    cardId: string
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'
    /** 本节点打几波（同一编成分波进场；撤离战恒 1 波） */
    waves: number
    expeditionRules?: number
    expeditionRole?: 'ordinary' | 'elite' | 'guard' | 'patrol' | 'event'
    guardSupportDisabled?: boolean
    desireRangeMul?: number
    /* ── F3c B1：谜质装置在**开战那一刻**的快照（逐拍重建读同一份，不各算各的）── */
    /** 威胁乘数（压制力场 / 守卫解析仪 / 撤离掩护器；三档各自 −50% 封顶） */
    threatMul?: number
    /** 敌队主伤害类型（三张谐振片"单层单系"只对它加抗性） */
    foeMainType?: DamageType
    /** 敌方命中 −（干扰发射器，−0.25 封顶） */
    foeHitDown?: number
    /** 敌方近盲带伤害比例 −（盲区压制器，下限 0） */
    blindReduce?: number
    /** **齐射溢出转移**是否生效（齐射协调仪 · F3c B2：1 台即开） */
    volleyOverflow?: boolean
  }
  /* ═══ 敌冲锋（2026-09-10 船长定；2026-09-11 改判结束条件；**2026-09-14 船长改判"逐单位 · 命中解除"**）═══
   * 触发（两条取或）：① 距离在自己武器射程之外 ② 距离 > 期望交距 + `foeChargeTriggerMarginM`；
   * 期间**该单位自己**的机动 ×(舰级 `FoeShipDef.foeChargeMul` ?? 全局 `BattleBalance.foeChargeMul`)。
   * 解除（两条取或）：① **自身炮台命中我方** ② 压到期望交距（兜底）；
   * 解除后该单位进 `foeChargeCooldownMs` 冷却（**2026-09-14 起 10 秒**）。
   * ⚠ **逐单位**：每个挂 `foeCanCharge` 的单位各有一份「在冲 / 冷却到某时刻」，互不顶替
   *   （2026-09-14 船长：「各自触发冲锋的提速」＋「自身攻击命中后解除冲锋状态，并进入 10 秒冷却」）。
   * 字段是**可选、零迁移**、且**有意不入档**（运行态 ⇒ 战中重载即重置冲锋循环，见 `save.ts` 登记表）。 */
  /**
   * **我方被「劫掠捕获网」钉住的状态**（船长 2026-09-16：A 族新舰「劫掠电子舰」的捕获网）——
   * 键 = 被钉的我方 tag；施放者一死即整条清掉（**击杀发动者 = 唯一解除手段**）。
   * 四层效果施加在"每拍重建的我方规格"上（见 `combat.applyMeWebDebuff`）：减速 / 关推进器 / 闪避归零 / 射程 −500m。
   * **运行期字段、有意不入档**（见 `save.ts` 登记表）。
   */
  meWebDebuffs?: Record<string, BattleWebDebuff>;
  /** **捕获网"已发放"账本**（键 = 施放者 tag）：同一艘舰**整场只发一次**（船长：第一次开火时发动）。
   *  ⚠ **"打空不算用掉"**（⟪2026-09-25 船长报障⟫）：首发若打向**已被别的网钉住**的目标 ⇒ 本舰的网
   *  **保留**、不记本账本，直到它真正钉住一个未被捕获的目标为止（详见 `combat.fireFoeCaptureWeb`）。 */
  foeWebFired?: Record<string, true>;
  /**
   * **我方「墨潮捕获网」钉在敌舰上的状态**（**船长 2026-09-26**，H 族势力装备三件之一）——
   * 键 = 被钉的**敌方 tag**；`byTag` = 携带网的我方舰。
   *
   * 与 `meWebDebuffs` 是一对镜像：效果三层（减速 / 关推进器 / 闪避归零，**不含射程**）、
   * 施加在"每拍重建的敌阵规格"上（`combat.applyFoeWebDebuff`）。
   * **随档**（见 `save.ts` 登记表）：捕获网是**周期装置**，冷却状态丢了会让"重载即刷新网"成为白赚。
   */
  foeWebDebuffs?: Record<string, BattleFoeWebDebuff>;
  /**
   * **我方捕获网的周期账本**（键 = 携带者 tag）：`targetTag` = 当前钉住的目标（无 = 待发/冷却中）、
   * `cooldownUntilMs` = 冷却结束时刻（战斗时钟 `gameMs`）。
   *
   * 口径（船长 2026-09-26）：**交战距离 ≤ 3800 米**（`combat.MY_WEB_RANGE_M`）时钉第一个可选目标
   * → 目标被击沉 或 **距离超过 4500 米断开**（`combat.WEB_BREAK_DIST_M`，敌我通用）⇒ 记冷却、
   * 冷却结束选新目标；**不选重复目标**（已被别的网钉住的跳过）；无目标可选或距离过远 ⇒ 保持待发、
   * **不空转冷却**。
   * **随档**（同上：冷却丢了就是白赚）。 */
  myWebs?: Record<string, { targetTag?: string; cooldownUntilMs: number }>
  /**
   * **双方当前速度（m/s）· 界面显示口径**（2026-09-16 船长：「在上方的距离条两端的上方分别显示敌我的战斗速度」
   * ＋「战斗中实际速度和面板显示的机动速度不一致」⇒「**只修改战斗显示数值，实际数值不变动**」）：
   * = 单位自身 `speedMps` × 机动倍率（我方推进器爆发 / 敌方冲锋），逐单位取平均 ⇒
   * **与装配页「机动速度 / 加力推进点火期」同一把尺**（不含 `combatSpeed` 的 speedFactor 与敏捷修正）。
   * ⚠ **引擎推进与距离拔河仍用另一对内部值**（`combatSpeed(...)`，含 ×0.6）——两套并存、互不影响；`combat.ts` 的落盘处有完整说明。
   * **运行期字段、有意不入档**（下一拍即重算；见 `save.ts` 登记表）。
   */
  meSpeedMps?: number;
  foeSpeedMps?: number;
  /**
   * **本场敌方挂载件名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——
   * `seedUnit` 时累积（开战首波 / 波次转场 / 增援都经那里），供战报渲染。
   * **运行期字段、有意不入档**（战中重载即重建；见 `save.ts` 登记表）。
   */
  foeMounts?: string[];
  /**
   * **同序的「双语名对」**（2026-09-24 加；与 `foeMounts` 下标对齐 ⇒ 界面按当前语言挑一列）。
   * 同样由 `seedUnit` 累积、**运行期字段、不入档**（缺省 ⇒ 显示层回退中文名数组）。
   */
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>;
  /** 逐单位冲锋运行态（键 = 战斗 tag：`foe-0` / `w0-foe-2` / `w1-foe-0-e1`，同一场内唯一） */
  foeCharges?: Record<string, { on?: boolean; cdUntilMs?: number }>;
  /**
   * **逐单位「闪现跃迁」冷却运行态**（**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」；
   * 给 R 族「光环科技 / Corona Systems」那件「瞬光跃迁仪」用）。
   *
   * 键 = 战斗 tag（与 `foeCharges` 同一把尺）；值 = **冷却到什么时候**（`lastTickGameMs` 基准）。
   * 语义：本体被命中时，若已过冷却 ⇒ 把 `distanceM` 拉开 `FoeMountDef.blink.distanceM` 米、
   * 并盖上下一次可用的时刻（详见 `FoeMountDef.blink` 头注）。
   *
   * ⚠ **与 `foeCharges` 同一口径：登记为 `save.ts` 清洗器的 `kind: 'runtime'`（有意不入档）** ——
   * 落在既有的"重载即重置循环"口径内（冲锋循环 2026-09-14 起即如此，本条照办）。
   * 字段可选 ⇒ **旧档零迁移、既有各件零行为变化**。
   */
  foeBlinks?: Record<string, number>;
  /**
   * **逐单位「最近一次闪现跳了多远 + 朝哪边」**（**2026-10-01 加**，与 `foeBlinks` 同一把尺）——
   * 纯**旁路记账**：只写不改，不参与任何算式，供战报/界面展示与用例读数用。
   *
   * 为什么要有它（**实测教训**）：闪现落点是**全局标量** `distanceM`，而多艘敌舰**可以同一拍各闪一次**
   * ⇒ 只盯 `distanceM` 的变化**既分不出单舰跳幅、也分不出单舰方向**：
   * 实测 `corona-nexus` 开场同拍 6 舰各闪一格 = 聚合位移 2,678 m（看着像"一跳超 2,000m"，
   * 实际每舰都是合规的一格）；同一拍的 `distanceM` 最终值还可能被**别的舰**的落点带走。
   * 有了本表，用例就能**逐舰逐次**判"单次位移 ≤ 件上的上限"＋"朝自己的期望走、不过冲"。
   *
   * ⚠ 与 `foeBlinks` 同口径：`save.ts` 清洗器登记 `kind: 'runtime'`（**有意不入档**）。
   * 字段可选 ⇒ **旧档零迁移、既有各族零行为变化**。
   */
  foeBlinkJumps?: Record<string, { from: number; moved: number; dir: -1 | 0 | 1 }>;
  /**
   * **逐单位「叠光装置」当前装填间隔**（**船长 2026-10-01 令**：「**添加叠光装置：效果是每次攻击
   * 或者闪现后，攻击间隔缩短，最多缩短至0.5秒攻击间隔。**」；给 R 族 T3 **叠光级**用）。
   *
   * 键 = 战斗 tag（与 `foeCharges` / `foeBlinks` 同一把尺）；值 = `{ r, f, bs }`：
   * - `r` = **当前装填间隔（毫秒）**（本舰下一次开火时用它重置装填计时，不再用条目的固定 `reloadMs`）；
   * - `f` = **已经推进过的开火次数**（本舰每开一火 +1 ⇒ 当前间隔按 `基准 − stepMs × (f + 闪现次数)` 现算）；
   * - `bs` = 已经折算过的**闪现次数**（防同一次闪现被重复推进）。
   *
   * 语义：本舰每**开火**一次、以及每**闪现**一次，装填间隔就 `−stepMs`（夹在下限 `floorMs`）；
   * 开火那一格由 `f` 计数、闪现那一格由 `foeBlinks` 反查（详见 `FoeMountDef.overlayDrive`）。
   *
   * ⚠ **与 `foeCharges` / `foeBlinks` 同一口径：登记为 `save.ts` 清洗器的 `kind: 'runtime'`** ——
   * 落在既有的"重载即重置循环"口径内。字段可选 ⇒ 旧档零迁移、既有各件零行为变化。
   */
  foeOverlayReload?: Record<string, { r: number; f: number; bs: number }>;
  /**
   * **闪现演出队列**（**船长 2026-10-01 令 ＋ 2026-10-02 两次修正**，原话照抄）：
   *
   * > ①「**允许闪现出现小幅度误差，并且闪现现在会有一个发生时间，同时触发的多个闪现需要排队发生。
   * > 闪现的发生时间大概200ms，发生过程需要搭配动画效果：闪现开始-播放动画的同时舰船消失-等待发生时间
   * > -在新位置播放动画同时舰船出现。多个闪现需要有200ms的间隔。**」
   * > ②（旋钮）「**先将整个过程延长到2000ms**」
   * > ③（实机反馈，🔴 本次修正的根据）「**在演出结束后舰船还会播放一个入场时才会有的放大效果，而且我原先
   * > 中间插入的发生时间等待怎么被取消了？移动的时间节点应该放在发生时间的等待处**」
   *
   * 键 = 战斗 tag；值 = 这一次闪现在**全局时钟**上的四段时刻（都是 `state.gameMs` 口径）：
   * - `queuedMs`：触发入队的时刻；
   * - `vanishMs`：**消失**起点（本段的起点，UI 据此播淡出）；
   * - `moveAtMs`：**位移兑现**时刻（＝"消失"演完的那一刻，🔴 **位置就在这一瞬才换**——
   *   这正是船长要的"移动放在发生时间的等待处"：先消失、再换位、再在新位置出现）；
   * - `appearMs`：**出现**起点（＝ `moveAtMs` ＋ 等待段；UI 据此在新位置播淡入）。
   *
   * **三段时长**（船长 2026-10-01 原话的"播放动画消失 → 等待发生时间 → 新位置播放出现"）：
   * 把 `balance.battle.foeBlinkProcessMs` **三等分** ⇒ 消失 1/3、**等待 1/3**、出现 1/3。
   * ⚠ 旧实现把过程**对半劈**（消失一半 ＋ 出现一半、且位置在触发那刻就换）⇒ **中间的等待被砍掉了**，
   *   船长的实机反馈指的正是这个。
   *
   * **排队口径**：多个闪现依次排定，每段占 `过程 ＋ foeBlinkGapMs`（同刻触发 ⇒ 各自往后错开一段）。
   *
   * ⚠ **不停表**（船长裁定）：战斗时钟照走，只是**演出期间对面那一侧不开火**（`blinkHoldSides` 门控；
   *   2026-10-02 §35 起**双向**：本表在窗口 ⇒ **我方**停火；`meBlinkQueue` 在窗口 ⇒ **敌方**停火）。
   * ⚠ 与 `foeBlinks` / `foeCharges` 同一口径：`save.ts` 清洗器登记 `kind: 'runtime'`（**有意不入档**）。
   */
  foeBlinkQueue?: Record<string, BlinkSeg>;
  /**
   * 🔴 **我方闪现演出的时刻表**（**船长 2026-10-02 §35 令**，原话照抄）：
   * > 「**「全队舰船」是指触发了闪现的舰船所在的队伍。表现全部一致。时长公用一个旋钮。
   * > 我方触发闪现时，闪现禁火对敌人也生效**」
   *
   * 与 `foeBlinkQueue` **逐字同形**（共用 `BlinkSeg`）：键 = **触发那艘我方舰的 tag**，三段语义同上。
   * ⚠ **裁定「1甲」**：一次触发 = **一段**（时刻表按触发者记；其余舰只是"跟着演"，不各排一段）
   *   ⇒ 窗口/禁火时长与队伍人数无关。
   * ⚠ **必须与敌方表分开两张**：`blinkHoldSides` 按表分侧判（敌方表在窗口 ⇒ **我方**停火；
   *   我方表在窗口 ⇒ **敌方**停火）。合成一张会让"我方自己闪"变成"我方自己停火"。
   * ⚠ 排队口径与敌方一致：多个闪现依次排定，每段占「过程 ＋ `foeBlinkGapMs`」。
   * ⚠ `save.ts` 清洗器登记 `kind: 'runtime'`（**有意不入档**，与 `foeBlinkQueue` / `meBlinks` 同款）。
   */
  meBlinkQueue?: Record<string, BlinkSeg>;
  /**
   * **我方"不被一击带走"保险的运行态账本**（船长 2026-09-16：「血量 100%，单次齐射伤害最多只能造成
   * **总血量 80%** 的伤害（**只对我方生效**）」）。
   *
   * 键 = 我方舰 tag（`player` / `ally-N`），值 = 当前100ms窗口由敌方造成的实际掉血（含抗性与损管）。
   * 语义：同一窗口内同一艘我方舰的实际掉血**合计**不得超过该舰满血总量 × `PLAYER_VOLLEY_DMG_CAP_SHARE`
   * （0.8）⇒ 满血舰**永不可能被一次齐射带走**（至少留 20%）；敌方承伤**完全不受影响**。
   * **洞内洞外都生效**（这条挂在共用的 `stepBattle` 上，所以悬赏/遭遇/远征/虫洞一律吃保险）。
   * 字段**可选、零迁移、有意不入档**（运行态：跨窗口即重置，见 `saveBattleClean.ts` 登记表）。
   */
  meVolleyDmg?: Record<string, number>;
  /** 独立100ms齐射保险窗口，不随战斗子步缩小。 */
  meVolleyWindow?: number
  /**
   * **我方「叠光同款装填自加速」的当前装填间隔**（**船长 2026-10-01 令**：「激光武器为叠光同款叠加攻速的」；
   * R 族势力特色激光炮 `mod-lair-laser-r` 用）。
   *
   * 键 = `tag#炮位下标`（同一艘船可能装多门）；值 = `{ r, f }`：`r` = 当前装填间隔（毫秒）、
   * `f` = 已推进的开火次数。语义与敌方的 `foeOverlayReload` **逐字同款**：每开一火 ⇒ `−stepMs`、夹下限。
   * ⚠ 登记为 `save.ts` 清洗器的 `kind: 'runtime'`（**有意不入档**，与 `foeOverlayReload` 同口径）。
   */
  meOverlayReload?: Record<string, { r: number; f: number }>;
  /**
   * **逐门「三连射」本轮已发数（我方）**（**船长 2026-10-03 令**：「**添加一个旗舰同款的势力能量武器
   * （三连射）…射速为3000MS**」；给 R 族那件「三叉戟光束炮 / Trident Beam Cannon」用）。
   *
   * 键 = `舰tag#炮位下标`（与 `meOverlayReload` 同一把尺：一艘船可能装多门）；值 = **本轮已发几发**：
   * 缺省（或 0）= 本发是本轮第 1 发；打完 `shots` 发就删键。**发间隔靠"装填计时重置为
   * `max(0, gapMs − dtMs)`"实现**（最后一发才回 `reloadMs`），每发各走一遍选靶 / 扣弹 / 命中 / 飘字。
   *
   * ⚠ 登记为 `save.ts` 清洗器的 `kind: 'runtime'`（**有意不入档**，与 `meOverlayReload` / `foeBurstFired`
   * 同一口径：重载即重置本轮）。字段可选 ⇒ **旧档零迁移、既有全部装备零行为变化**。
   */
  meBurstFired?: Record<string, number>;
  /**
   * **我方「跃迁规避装置」的闪现冷却**（**船长 2026-10-01 令**：「挨打触发闪现。但是冷却时间延长到12秒」）。
   *
   * 键 = 我方舰 tag；值 = **冷却到什么时候**（`lastTickGameMs` 基准）。语义与敌方 `foeBlinks` 同款，
   * 区别只在**方向**（我方是纯粹的"拉开"，敌方是"破坏我方走位意图"）。
   * ⚠ 登记为 `save.ts` 清洗器的 `kind: 'runtime'`（**有意不入档**）。
   */
  meBlinks?: Record<string, number>;
  /**
   * **损伤管制装置 · 免死状态**（**2026-09-25 船长令**：「当舰船第一次结构低于 1 时，将结构恢复到 1
   * （避免一次死亡）」＋「触发损管效果时需要消耗一份」＋改判「**1 秒内结构锁定 1**」）。
   *
   * 键 = 我方舰 tag（`player` / 僚舰 tag）：
   * - `lockUntilMs`：**结构锁定 1 点**的到点时刻（**游戏钟**；`≤ b.lastTickGameMs` = 已出窗）；
   *   窗口内每发入伤都被夹到"结算后结构 ≥ 1"（`combat.applyDcGuard`，逐段 ⇒ 同拍多段破不了）；
   * - `used`：本场是否已启动过（**每场一次**）。
   *
   * ⚠ **必须随档**（`save.ts` 登记表 persist）：本仓有 `hullEscapeFrac` 当年漏登记、
   * 导致"战中重载 ⇒ 保险凭空失效"的先例。
   */
  dc?: Record<string, { lockUntilMs?: number; used?: boolean }>;
  /** 玩家苏生维修、危机启用与磁轨叠层必须随档，不因重载刷新。 */
  meRebirths?: Record<string, { repairUntilMs: number; lastRepairAtMs: number; armorHealed: number; hullHealed: number }>
  meCrisisActive?: Record<string, true>
  meRailStacks?: Record<string, number>
  /** 本场损伤管制装置的启动次数（＝消耗的损管修理组件枚数；战报那一行读它） */
  dcKitsUsed?: number;
  /** ⚠ **已停用**（2026-09-11 改判：结束条件改'到达目标距离'，不再需要'进射程时刻 + 维持时长'）。
   *  旧档里可能留有该值，新码不再读写——保留字段声明只为不动存档形状。 */
  foeChargeEnteredAtMs?: number;
  /** 船体维修装置运行态（2026-09-09 船长定；零迁移可选——旧档缺省 = 本场无维修装置介入）。
   * 与弹药预载同哲学：开战把货舱（仓库兜底）中的对应修理组件移入 kits 账本，战斗中不可补给；
   * 每 REPAIR_PULSE_MS 一次脉冲，各台未停机装置修复装甲/结构并扣 1 枚组件，耗尽即停机；
   * 战斗结束未用组件退回仓库（见 combat.refundRepairKits）。
   * ⚠ **2026-09-16 起 = 主控那一份**（多舰战斗的逐舰账本见 `repairBy`；单船路径只有这一份）。 */
  repair?: BattleRepairLedger
  /**
   * **逐舰维修账本**（2026-09-16 船长裁定「甲」：「玩家反应，船体维修装置在虫洞里无效」
   * ⇒ 每艘参战船各自的装置、各自的组件、各自被修）。
   *
   * - 键 = 战斗 tag（含 `player`）；**只写真正装了装置的舰**；
   * - `repair` 仍是**主控那一份**（同对象引用 ⇒ 老读法/老档零迁移）；本字段存在时，
   *   脉冲、退款、战报一律**遍历本表**（旧档在途战斗没有本字段 ⇒ 退化成"只有主控修"，即旧行为）。
   */
  repairBy?: Record<string, BattleRepairLedger>
  /* ═══ 护盾充能装置（2026-09-14 船长：「护盾充能装置，和船体修理装置类似。每 15 秒恢复自身
     护盾最大值一定比例的护盾量。CPU消耗较多」）——与维修装置**独立计时**（30 秒 vs 5 秒）═══ */
  /**
   * 护盾充能快照：开战按装配写入（**2026-09-16 起逐舰**，见 `shieldChargeBy`；本字段 = 主控那一份）。
   * **它是破盾后唯一的回头路**：被动回充按当前盾比例（盾 0 ⇒ 回充 0），只有这里能从 0 把盾点起来。
   * 缺省 = 本场没装该装置（零行为变化）。
   */
  shieldCharge?: BattleShieldChargeLedger
  /**
   * **逐舰护盾充能账本**（2026-09-16：与维修装置同批逐舰化，键 = 战斗 tag、含 `player`）。
   * 缺省（老档在途战斗）⇒ 退化成"只有主控充能"，即旧行为。
   */
  shieldChargeBy?: Record<string, BattleShieldChargeLedger>
  /* ═══ 护盾充能力场装置（2026-09-20 船长：「新增高槽装备，护盾充能力场装置 MK2，为所有我方舰船
     恢复 10% 护盾，冷却时间 10 秒，MK3 的冷却时间缩短至 8 秒。有叠加惩罚」）——高槽 · 护盾族 ═══ */
  /**
   * **逐舰力场账本**（键 = 战斗 tag、含 `player`；与 `shieldChargeBy` 分开：机制不同 ⇒ 两套计时）。
   *
   * 与护盾充能装置的三点区别：① 恢复其他队友、按需支付自身护盾；② **冷却按件自带**
   * （MK2 = 10 秒 / MK3 = 8 秒，见 `msPerPulse`）；③ 同舰多件仍按 EVE 曲线收敛（"有叠加惩罚"）。
   * 缺省 = 本场没装该族件（零行为变化）。
   */
  shieldFieldBy?: Record<string, BattleShieldFieldLedger>
  /**
   * **敌方后勤账本**（船长 2026-09-16：「**敌人后勤舰则是将 50% 的自身DPS转换为修理值**」＋
   * 「**敌方的修理无法以其他敌方后勤舰为目标（包括自己）**」）。
   *
   * - **只在场上存在敌方后勤舰（`FoeShipDef.repairPct > 0`）时才建**（缺省 ⇒ 零开销、零行为变化）；
   * - 每 `REPAIR_PULSE_MS`（5 秒）一跳：每跳修理量 = `Σ 在场后勤舰(名义 DPS × repairPct × 5 秒)`，
   *   名义 DPS 取该单位**战斗中武器面板**的 `Σ 单发 × 1000 ÷ 装填`（不含命中/距离衰减）；
   * - 目标 = **非后勤**敌舰里三层剩余比例最低者（**永不指向任何 `repairPct > 0` 的敌舰，含自己**），
   *   不超过其满血、不耗组件；
   * - `healed` = 累计实际修好的点数（供战报/读数用）。
   */
  foeRepair?: { nextPulseAtMs?: number; pulses: number; healed: number }
  /**
   * **挂载件「船体修理装置」的逐单位脉冲账本**（船长 2026-09-24：「**给G族添加挂载件：船体修理装置。
   * 每5秒恢复5装甲和5结构**，会吃威胁的加成」；**同日二次令基数升为 15/15**）——键 = **战斗 tag**：
   * `{ nextPulseAtMs, pulses, healed }`，每 `everyMs`（5 秒）给**该单位自己**回
   * `round(15 × k)` 装甲与结构（各层夹满值），`k` = 本层本次实际威胁 ÷ 45（见 `UnitSpec.foeRepairPulse`）。
   *
   * **只在该单位真挂了这件时才建**（缺省不写 ⇒ tick 里那一块直接跳过 ⇒ 零开销、零行为变化）。
   * ⚠ **必须随档**（与 `foeRepair`/`repair`/`shieldCharge` 同款理由）：漏了会让战中重载后
   * 敌方修理计时重置 = **白赚一跳**（2026-09-20 护盾充能力场那次报障的同型坑）。
   */
  foeRepairPulses?: Record<string, { nextPulseAtMs?: number; pulses: number; healed: number }>
  /**
   * **挂载件「支援舰船召唤装置」的召唤计时**（**船长 2026-09-25**：「给入侵母舰添加类似D族挂载件的
   * 独立挂载件，只不过改为**复活被摧毁的友军**（但是表现形式上为**敌方支援舰船入场**），
   * **增援时间是60秒**，**每次随机复活一艘**」；**2026-09-26 改判**：「…每60秒复活2艘船。且必定会复活干扰舰」）：
   * - `foeReviveAtMs` = **下一次该召唤的战斗时钟**（毫秒；首次基准 = 召唤者入场那一刻，
   *   见 `UnitSpec.foeReviveEscort`）；到点即召唤一艘并推进一格；
   * - `foeReviveCount` = 本场已召唤次数（支援舰 tag 序号 `sup{n}-<原tag>` 与日志"第 N 次支援"都用它）。
   *
   * **只在该单位真挂了这件时才写**（缺省不写 ⇒ 零行为变化、零随机数消费）。
   * ⚠ 与 `foeRepairPulses` 同款理由**必须随档**：漏了会让战中重载后召唤计时重置 = 白赚一次支援。
   */
  foeReviveAtMs?: number
  /** 本场已召唤的支援舰数（见 `foeReviveAtMs`） */
  foeReviveCount?: number
  /** 固定空槽召唤的下次检查时刻，按召唤者分账，随档保留。 */
  foeSummonAtMs?: Record<string, number>
  /** 当前波聚焦来源，按规格重建；不保存累计倍率。 */
  foeFocusArrays?: Record<string, NonNullable<import('../../types').FoeMountDef['focusArray']>>
  /* ═══ 机群战损（2026-09-10 船长拍板「无人机可被击落」，永久损失制；零迁移可选） ═══ */
  /** 逐架生存池：键 = **`舰tag:武器条目下标`**（仅 src='drone' 的条目）；开战由 startBattleFor /
   *  startFleetBattleFor **逐舰**写入（2026-09-14 船长「逐舰机群」）。
   *  ⚠ 键在 2026-09-14 前是**纯数字**（下标，只有主控）——老档由 `save.ts` 归一成 `player:<下标>`。
   *  缺省 = 本次改动前已在进行的战斗（照旧打完，不折损） */
  dronePools?: Record<string, DronePoolEntry>;
  /** 每舰首次出击队列；缺省表示旧战斗中机体按已放飞处理。 */
  droneLaunchBy?: Record<string, { q: string[]; nextAtMs: number; gapMs: number; reviveGapMs?: number }>
  /** **敌机机群生存池**（2026-09-11 机群批）——键 = **敌单位 tag**，值 = 与该单位 `src:'drone'`
   *  武器条目**同序**的逐架池（每架一条）；三层血/抗性/回避取自机型表（`FoeDroneDef.defense`）。
   *  开战与每次换波由 `combat.initFoeDronePools` 重建。
   *  **缺省 = 本场没有敌机**（无 `FoeShipDef.drones` 的敌舰一律不建池）⇒ 既有战斗零行为变化。 */
  foeDronePools?: Record<string, DronePoolEntry[]>;
  /**
   * **反应式防空**（船长 2026-09-11：「**每轮都是被攻击后才开火**（敌方无人机只有靠近你
   * 你才能反击）」）——记录**最近一次无人机攻击**的战斗时钟（毫秒）：
   * · `me`  = **敌方无人机**打过我方舰的时刻 ⇒ **我方近防炮**据此进入反击窗口；
   * · `foe` = **我方无人机**打过敌舰的时刻 ⇒ **敌方近防炮**据此进入反击窗口。
   * 窗口 = `PD_REACTIVE_WINDOW_MS`（见 `combat.ts`）；**超窗即脱锁**，要等下一轮被打才再开火。
   *
   * ⚠ **两侧故意不对称**（船长 2026-09-16 复核定论「**点防没问题**」）：
   * · **我方侧 = 逐舰令牌**（2026-09-16 逐舰版 `droneHitAtMeBy`；本字段的 `me` 只服务"该改动之前开的在途战斗"）；
   * · **敌方侧 = 全队共用**（`foe`：全队未尝试还手时保留至窗口过期；
   *   船长2026-10-08确认：实际反击当拍已就绪舰各一次，未就绪舰不另攒机会）。
   *   ⇒ **不许**照"逐舰"把敌方侧也改过去（那会动玩家无人机在多舰敌卡里的战损口径）。
   */
  droneHitAt?: { me?: number; foe?: number };
  /**
   * **反应式防空 · 我方逐舰令牌**（2026-09-16 船长「将缺少的一并实现」）：
   * 键 = **被打的我方舰 tag**，值 = 该舰最近被敌机打的战斗时钟。
   *
   * 为什么要有它：旧口径 `droneHitAt.me` 是**全队共用一个令牌**，且一次反击就消费掉
   * ⇒ 4 舰编队里**整队每轮只换到一发反击**，僚舰的近防炮基本沉默。逐舰后每艘船**各自**
   * 在"自己挨了机群打"的窗口内还手（与"点防逐舰挨打"同源）。
   * 缺省（本改动之前开的在途战斗）⇒ 回退读旧字段 = 旧的"全队一个令牌"行为（零迁移）。
   */
  droneHitAtMeBy?: Record<string, number>;
  /**
   * **敌机受击增程**（2026-09-11 船长：「添加新机制，**受到攻击后，大幅提高无人机射程（提高 400%）**」）
   * ——值 = 生效的**射程倍率**（E 族三条舰级 = **4**：警戒机 5,000 → 20,000m）。
   *
   * ⚠ **全敌队一次生效**（船长二次裁定：「每个敌人都会单独触发一次射程增加的文字提示，理论上应该
   * **只触发一次**，**对所有敌舰生效**」）：任一"带该机制的敌舰"被命中 ⇒ 标记**整支敌队**，
   * 此后**所有敌舰的机群**都吃到倍率（不是逐舰各算一份）。故这里是**标量**而非按 tag 的表，
   * 且**只会在 1 → 倍率 时推一条画面提示**（不重复）。
   * 触发 = **舰体被命中一次**（打机群不算）；**本场永久**、**不封顶**；缺省 = 未触发（零行为变化）。
   */
  foeDroneRangeBuff?: number;
  /**
   * **敌舰炮台受击增程**（2026-09-12 船长：「给 D 族静滞卫舰加入类似 E 族挨打加炮台射程的效果，
   * 不过**仅影响所有静滞卫舰**。挨打后射程增加 50%」）——值 = 生效的**射程倍率**（静滞卫舰 = **1.5**：
   * 12,000 → **18,000m**）。
   *
   * ⚠ **与 `foeDroneRangeBuff` 是两套独立状态**（互不覆盖、可同时存在）：
   * - 那条作用于"**整支敌队的机群**"；本条**只作用于带 `foeGunRangeMulOnHit` 的敌舰**（= 所有静滞卫舰），
   *   同场的其它舰级（守墓长舰等）**不受影响** —— 这正是船长「仅影响所有静滞卫舰」的落点；
   * - 触发同为"**舰体被命中一次**"（打机群不算、未命中不算），**只推一条**画面提示、**本场永久**；
   * - 口径（船长选乙）：只延长**最远射程**、近界不动，**原射程内读数一字不变**、延长段按同斜率衰减。
   */
  foeGunRangeBuff?: number;
  /**
   * **我方电子舰对敌舰射程的削减率**（船长 2026-09-18：「电子舰新增特性，**削减敌人15%的武器射程**，
   * 可以乘法叠加，与敌人的射程增加效果做加法处理…射程最短只能削弱到3000m」）。
   *
   * 值 = 编队合成的**削减率** `r = 1 − Π(1 − vᵢ)`（电子舰 1 艘 0.15 · 2 艘 0.2775 …，见
   * `combat.foeRangeDebuffOf`）；与敌方"射程增加"**做加法**：净倍率 = 增程倍率 − r；
   * **基础射程 < 3000m 的不削**、削后**下限 3000m**（`FOE_RANGE_DEBUFF_FLOOR_M`）。
   *
   * ⚠ **运行态、不随档**：战斗建档与**每拍**各重算一次（读档/中途换编队都不会陈旧）。
   * 消费方只有两处（既有单一真相源）：`combat.foeGunMaxRangeOf`（舰体武器）与
   * `combat.foeDroneRangeOf`（敌方机群）——开火门 / 距离衰减 / 界面射程标签全部自动跟随。
   * 缺省 = 不削（没带电子舰的编队逐字不变）。
   */
  meFoeRangeDebuff?: number;
  /**
   * **战斗内提示条**（2026-09-11 船长二次裁定：「**日志内不用显示提示，将该提示放入战斗画面内显示**
   * （和**敌方增援**统一下系统，**显示位置改为战斗窗口正上方**）」）。
   *
   * 与「敌方增援」共用画面顶部那一条提示位：逐条带 `atMs`（战斗时钟）供 UI **限时显示后自动消失**
   * （不像日志那样永久留档）。只保留最近 4 条（`pushBattleNotice`）。
   * 缺省 = 本场没有提示（零行为变化）。
   */
  notices?: Array<{ atMs: number; text: string; textId?: string; textParams?: LogParams }>;
  /** 本场已击落架数（机型 id → 架数，**全队合计**）；结算时按此**永久扣除**无人机舱清单 */
  droneLost?: Record<string, number>
  /** **逐舰战损**（2026-09-14 船长「战损按舰归属」）：`舰tag → (机型 id → 架数)`。
   *  `droneLost` 仍是全队合计（老口径不破：战报汇总 / "战损过半"判定都读它）；
   *  本字段供**按舰结算**（各自扣各自的机舱清单）与按舰战报。**可选**：老档没有 ⇒ 全部算主控。 */
  droneLostBy?: Record<string, Record<string, number>>
  /**
   * **无人机储备甲板的复位账**（**2026-09-27 船长令**；落法见 `core/droneRevive.ts`）。
   * 逐舰一份：键 = 舰 tag（主控 = `'player'`）。
   *
   * - `q`：**待补队列**（全舰一条，FIFO＝被击落顺序；存**机群池键** `舰tag:武器下标`）
   * - `t`：该舰**每件储备甲板**的在跑周期到点时刻（战斗时钟 ms；下标 = 该舰复位件序号，
   *   `undefined` = 空闲）—— 长度 = 装了几件 ⇒ "按需启动"就是**同时只启用到点表里空着的那些**
   * - `c`：该舰各件的**周期毫秒**（与 `t` 同序、**升序** ⇒ 下标 0 = 最快的那件）
   * - `v`：**已复活架数**（机型 id → 架数）⇒ 战后结算要按它一次性扣库存
   * - `shipId`：本账归属的舰队实例（结算扣货按舰取：本舰货舱 → 物品仓库）
   *
   * **可选字段**：没装这件装备 / 老档 ⇒ 整个字段不写（零行为变化）。
   *
   * ⚠ 复活**预算**不在本字段里——它是**全队共享的一本**，见下面的 `droneReviveStock`。
   */
  droneRevive?: Record<
    string,
    { q: string[]; t: Array<number | undefined>; c: number[]; v: Record<string, number>; shipId: string; printing?: boolean }
  >
  /**
   * **开战库存快照 ＝ 复活预算**（**船长 2026-09-27 令**：「战斗中损失的无人机是在战斗结束后一次性
   * 扣除吧？那么**复活无人机数量的上限在战斗开始时设置一个库存的快照**可以吗」）。
   *
   * 机型 id → **本场最多还能补回几架**。取数口径 = **开战那一刻**，装了储备甲板的各舰
   * **本舰货舱 ＋ 全队共享的物品仓库**（**不含机舱清单 `droneLoad` 里正在打的那几架**）。
   *
   * ⚠ **全队共享一本**（不是每舰各拍一份）：否则 4 条船各拍同一只仓库 ⇒ 能从 20 架备用里补出 80 架。
   * ⚠ **战中只扣这本预算、绝不写玩家库存**（战斗保持纯模拟）；真正扣货在战后结算处一次性做，
   * 顺序 = **先扣复活的 `v` 架 → 再扣净损失 → 最后按出发快照补货**。
   */
  droneReviveStock?: Record<string, number>
  /** 近防炮调度（当前波）：每舰判定冷却剩余毫秒（与敌编队同序）；缺省 = 无近防炮 */
  pdCd?: number[]
  /** **近防炮集火锁定**（2026-09-12 船长「改为集火制度」）：每艘点防舰当前锁定的**机群池键**
   *  （与敌编队同序；`undefined` = 未锁定/目标已灭/换了目标舰 ⇒ 下一拍重选）。
   *  ⚠ 2026-09-14「逐舰挨打」起，键 = `舰tag:武器下标`（**锁到的是"哪条舰的第几架"**；
   *  此前是纯数字下标）。**可选字段**：旧档/旧战斗没有它 ⇒ 行为 = 每拍按优先级重选（**零迁移**）。 */
  pdFocus?: Array<string | undefined>
  /**
   * **我方近防炮集火锁定**（2026-09-12 船长「改为集火制度」+ P-40 乙案「我方侧口径对齐」）：
   * 按**我方武器槽**（`wi`）存当前锁定的敌机（`tag` + 该舰机群池下标），锁定到目标被击落才换靶
   * —— 与敌方侧 `pdFocus`（按点防舰同序）**同一口径**，只是索引轴不同。
   * **可选字段**：旧档/旧战斗没有它 ⇒ 行为 = 每拍按优先级重选（**零迁移**）。
   *
   * ⚠ **2026-09-16 起由 `mePdFocusBy` 取代**（逐舰版，见下一条）：本字段只按"武器下标"存，
   * 多舰战斗里各舰的 0 号武器**共用同一个槽位** ⇒ 互相顶锁（僚舰锁定的敌机会把主控的锁顶掉）。
   * 保留声明只为"本改动之前开的在途战斗"读取（运行态字段，不随档）。
   */
  mePdFocus?: Array<{ tag: string; idx: number } | undefined>
  /**
   * **我方近防炮集火锁定（逐舰 · 2026-09-16 船长「将缺少的一并实现」）**：
   * 键 = **`舰tag:武器下标`**（`dronePoolKey`），值 = 该武器当前锁定的敌机（`tag` + 该舰机群池下标）。
   * ⇒ 每艘船的每门近防炮**各锁各的**，不再互相顶锁。缺省 = 每拍按优先级重选（零迁移）。
   */
  mePdFocusBy?: Record<string, { tag: string; idx: number }>
  /**
   * **我方近防炮"这次挨打已经还过手"的逐门记账**（2026-09-17 修玩家报障：「**多个近防炮对无人机的伤害
   * 不叠加，同时装MK2和MK3只有一个开火**」）：
   *
   * 键 = **`舰tag:武器下标`**（`dronePoolKey`，与集火锁同键），值 = 该门武器**已经还过手的那次挨打时刻**
   * （= `droneHitAtMeBy[舰tag]` 的取值）。语义：一次敌机攻击（一枚令牌）⇒ **本舰每门近防炮各还手一次**；
   * 旧口径把整舰令牌"第一门就删掉" ⇒ 同拍其余门全拿到 null（装 3 门与装 1 门开火发数相同）。
   * 窗口过期仍由 `PD_REACTIVE_WINDOW_MS` 判断兜底 ⇒ 不会退回"一直开火"。
   * **运行期字段、有意不入档**（跨拍记账，见 `save.ts` 登记表）。
   */
  mePdAnsweredBy?: Record<string, number>
  /** 开战时的机群清单快照（机型 id → 架数；用于战后判定"机群战损过半"→ 停重复清剿）
   *  ⚠ 2026-09-14 起**只是主控那份**（老字段，兼容保留）；逐舰快照见下一条 */
  droneLoadAtStart?: Record<string, number>
  /** **逐舰机群清单快照**（2026-09-14 船长「逐舰机群」）：`舰tag → (机型 id → 架数)`。
   *  读不到该字段的老档 ⇒ 只有主控那一份（`droneLoadAtStart`）。 */
  droneLoadAtStartBy?: Record<string, Record<string, number>>
}
