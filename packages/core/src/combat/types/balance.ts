/** 功能域职责拆分，保持原计算与顺序。 */
import type { FoeTactic, FoeFamily, DamageType } from './damage'

/** V11 战斗平衡常量（唯一调参处；初值在校准脚本阶段核对） */
export interface BattleBalance {
  /** 命中率输出钳制：开放边界 0% / 100%（贴脸高加成场合可必中、极端劣势可完全脱靶） */
  hitMin: number
  hitMax: number
  /** P0 承伤持久化：护盾战中被动回充（每秒回充 = 满盾 × 此比例；0 = 关，初值见 balance） */
  shieldRegenPerSec: number
  /** 多波次转场（2026-09-09 船长建议）：下一波出现时把战斗距离向开战距离回拉的比例
   * （0 = 原地续战；1 = 完整回到开战距离重新接近；默认初值见 balance）
   * ⚠ **本条只在 `waveReopenEnabled === true` 时生效**（2026-09-11 船长：暂时关闭距离后退惩罚）。 */
  waveReopenFrac: number
  /** **多波次转场距离回拉总开关**（2026-09-11 船长：「将敌人增援波次距离会后退的惩罚**暂时关闭**」）。
   * - `false`（**现值**）= **关闭**：下一波在同一交战距离**原地入场**，不再"从远处入场、重新接近"
   *   （玩家不再因波次转场被拉回远距离、重演接近期）；玩家可见日志同步改为中性表述；
   * - `true` = 开启：按 `waveReopenFrac` 向开战距离回拉（2026-09-09 的原始口径）。
   * 与「敌突进」「单波次内增援」同款**总开关**形式：机制整套保留，改这一个布尔即恢复。 */
  waveReopenEnabled: boolean
  /** 多波次演出间隔（2026-09-09 船长反馈）：一波全灭后空转等待该时长（爆炸/残骸演出播完）
   * 再刷下一波；0 = 立即续刷（旧行为） */
  waveEnterGapMs: number
  /**
   * 🔴 **闪现演出 · 旋钮**（**船长 2026-10-02 令**：「**给闪现发生速度做一个旋钮……先将整个过程
   * 延长到2000ms**」）：
   * - `foeBlinkProcessMs` = 单次闪现的**整个动画过程**（消失 ＋ 出现；界面对半劈）；
   * - `foeBlinkGapMs` = **相邻两次闪现的间隔**（排队时一段播完空这么久，下一段才开始）。
   *
   * ⚠ 同时是**禁火窗口**（船长：「敌舰消失时，玩家的武器不会开火」）⇒ 过程调长 = 停火同步变长。
   * ⚠ 界面基准时长在 `apps/desktop`（`BLINK_ANIM_MS` 与 `styles*.css` 的 `--blink-ms`），
   *   运行时由脚本按本参数内联覆盖。
   */
  foeBlinkProcessMs: number
  foeBlinkGapMs: number
  /** 炮术学每级单发伤害加成（0.05 = +5%/级） */
  gunneryDmgPerLevel: number
  /** V18B 武器族技能（2026-09-05 一号按交接底稿接入）：模块槽族 → 专精技能 id；
   * 每级单发伤害加成 = familySkillPerLevel（与 gunnery 乘算；构建期折算进各条目） */
  familySkillIds: Record<'turret' | 'missile' | 'laser', string>
  familySkillPerLevel: number
  /* ═══ 舰船属性成长技能（2026-09-05 一号按盘点补；数值 C4 复核）═════════════
     CPU：只提高船体 CPU 总量（装配+无人机放飞共用预算），不改单件成本；
     机动速度：乘于 船速×推进器 之上；回避：缺口收窄（与姿态陀螺缺口复合）；
     ⚠ 命中：**2026-09-14 船长改判后不再"乘于船体 hitBonus"**——索敌统合改为乘在
     **炮台/导弹架的基础命中率**上（与火控阵列学同通道、乘算叠加，见下 `hitSkillId`）。 */
  cpuSkillId: string
  cpuPerLevel: number
  speedSkillId: string
  speedPerLevel: number
  evasionSkillId: string
  evasionPerLevel: number
  /** **索敌统合（命中技能）**：**炮台/导弹架的命中率**每级相对乘算（2026-09-14 船长改判：
   *  原为"舰船命中加成 ×(1+5%/级)"，现与「火控阵列学」同口径、每级 2%） */
  hitSkillId: string
  hitPerLevel: number
  /** 距离动力学：距离下限（贴脸极限）与开战距离 = 双方最远武器射程×openRangeFactor
   *  + max(openRangePadM, 最远射程×openRangePadShare)（船长 2026-09-05：缓冲按射程比例拉开） */
  minDistanceM: number
  openRangeFactor: number
  openRangePadM: number
  /** 缓冲比例：开战缓冲 = max(100m 下限 openRangePadM, 双方最远射程×本比例)（默认 0.1 = 10%） */
  openRangePadShare: number
  /**
   * **默认期望交距在主武器有效射程带内的位置**（0 = 最小射程 · 0.5 = 中点 · 1 = 最大射程）。
   * 2026-09-15 船长裁定（玩家报「赏金任务初始距离非常近、对远程武器不利」）：**星图与洞内统一 0.8**
   * （当天先落成"星图 0.8 / 洞内 0.5"分档，船长更正「这个是我口误，可以回滚那句」⇒ 取消分档）。
   * 贴脸/风筝两档不受影响。
   */
  desireBandMid: number
  /**
   * **洞内「近战怪开局距离」的档位**（0.5 = 中段）。船长选「乙」：默认期望抬到 0.8 时，
   * 这条 2026-09-13 定的「贴脸怪一开场就在你脸上」**保持不动**（与 `desireBandMid` 分属两处用途）。
   */
  wormholeBrawlOpenBand: number
  /** 舰船 maxSpeedMps 参与距离收敛的比例（战斗机动速度 = speed × speedFactor ×(1±agilitySpeedBonus)） */
  speedFactor: number
  agilitySpeedBonus: number
  /** C4 血量曲线（2026-09-05）：D = DMin + DSpan×((T−floor)/span)^exp；敌血 = 参考火力×D */
  foeHpCurveDMin: number
  foeHpCurveDSpan: number
  foeHpCurveExp: number
  foeHpCurveFloorThreat: number
  foeHpCurveSpanThreat: number
  /** 参考火力段表（无技能解析对射 DPS：威胁上界 → dps）——血量反推基准，可微调 */
  foeRefFire: ReadonlyArray<{ upToThreat: number; dps: number }>
  foeDpsPerThreat: number
  /**
   * **敌舰体火力「越线折扣」的阈值（DPS）**——2026-09-12 船长「按照 DPS 上限 150 算」定其值，
   * **2026-09-15 船长改判其形态**：「**不是钳制到150，而是超过150的部分进行一个约15%的折扣**」。
   * 舰级路径（`anomaly.ships`）按**整卡每波舰体总 DPS** `D` 判线——Σ（舰级单发 × `dmgMul` ×
   * 多舰补偿 2N/(N+1)）÷ 装填秒；`D ≤ 本值` ⇒ 逐字不动，`D > 本值` ⇒ **只对超出部分打折**
   * （折扣率见 `foeDpsOverCapDiscount`），再把该系数**等比例**施加于全卡舰体单发。
   * - **不含机群**（`src:'drone'`）：机群另有机制（受击增程 · 备用机库 · A5 火力守恒），且您已裁定不吃多舰补偿；
   * - **不含被 `droneFireShare` / `firepowerAnchor` 拆分的条目**（那条链自带总火力锚定，再打折会让锚点失准）；
   * - **未写 / 非正（含 0）⇒ 不折扣**（零行为变化开关）；
   * - ⚠ **口径沿革**：2026-09-12 首落为**硬钳制**（越线一律压到上限），同日按船长「火力钳制也暂时关闭」置 0；
   *   **2026-09-15 改为折扣制并写回 150**（含虫洞——船长「是，都生效」）。
   */
  foeDpsCap?: number
  /**
   * **越线折扣率**（2026-09-15 船长：「超过150的部分进行一个约15%的折扣」）：
   * 越线时目标总 DPS `D′ = foeDpsCap + (D − foeDpsCap) × (1 − 本值)`，缩放系数 `= D′ / D`
   * 施加于**全卡舰体单发**（条目相对权重不变、逐条取整同旧口径）。
   * - 现值 **0.15**（超出部分打 85 折）；「约 15%」⇒ 本值即调校旋钮，验收后要改只动它；
   * - **不封顶**：`D → ∞` 时 `D′ ≈ 0.85 × D`（斜率由 1 降为 0.85，火力仍随威胁继续增长）；
   * - **未写 / 非正（含 0）⇒ 不缩放**（与 `foeDpsCap` 同为开关；⚠ **0 不会退回旧硬钳制语义**）。
   */
  foeDpsOverCapDiscount?: number
  foeHitRate: number
  /**
   * 动能/爆炸高命中等效补偿（2026-09-08 船长方案 A）：命中提高 + 单发按 1/命中 等比降后，
   * 守方回避 >0 时期望承伤仍会上升——本系数对非能量敌单发再乘（锚点 ≈ 典型回避 0.22 ×
   * 中距衰减 0.7 的旧 0.55 模型折算 ≈0.62，可迭代校准）；能量光束（effHit=1）不消费。
   */
  foeHitCompMul: number
  foeReloadMs: number
  foeFalloff: number
  /* C4-#3 敌方"虚拟装配"模板（2026-09-05 船长拍板：威胁越高全属性越高，侧重随战术风格） */
  /**
   * **舰种基准速度**（m/s，**敌我共用**；2026-09-11 船长给定：1 护卫舰 340 / 2 驱逐舰 295 /
   * 3 巡洋舰 258 / 4 战列舰 205 / 5 旗舰 155）——**敌舰级的实速 = 本表[舰种档] × `FoeShipDef.speedRatio`
   * （再乘编成条目的 `speedMul`，若有）后取整**；旧路径（威胁推导）不读本表。
   * ⚠ **数值字面量只在本表这一处**：core 不能 import data 包，故由 data 包
   * `packages/data/src/hullClass.ts` 的 `HULL_CLASS_BASE_SPEED` **反向读本字段**，避免两包各写一份调参数字而静默漂移。
   * `content:check`「舰种契约」校验取值落在合理值域 100~500。
   */
  hullClassBaseSpeedMps: Record<1 | 2 | 3 | 4 | 5, number>
  /** 参考船速分段表（threat 上界 → 等效船体 maxSpeed m/s；与玩家船速同池，无推进口径） */
  foeRefSpeedTable: ReadonlyArray<{ upToThreat: number; maxSpeedMps: number }>
  /** 敌速基数端点：threat 10 → 玩家参考 ×lo；threat 100 → ×hi（无推进玩家多数持平/略快） */
  foeSpeedAtThreat10: number
  foeSpeedAtThreat100: number
  /** 战术风格速度系数（brawl 贴脸再高 10~20%，见船长指示） */
  foeSpeedTacticMul: Record<FoeTactic, number>
  /** 敌速绝对上限 = 参考船速 × 此值（留"推进可甩/脱战"窗口） */
  foeSpeedCapMul: number
  /** 射程成长侧重系数：scale = 1 + 系数×(threat−10)/90（brawl 少增、kite 多增） */
  foeRangeGrowMul: Record<FoeTactic, number>
  /** 敌最远射程封顶（玩家射程天花板 + 余量；压制穿越时间目标 ≤12s） */
  foeRangeCapM: number
  /** 敌期望交战距离系数 = 自身武器带内站位（0.2 贴脸近端 / 0.55 环绕 / 0.85 风筝远端；值域 [0.05,0.95]） */
  tacticDesireFactor: Record<FoeTactic, number>
  /** 弹药预载：估计交战时长上限 ms 与余量系数（出发按射速预载，结束退回） */
  ammoTimeCapMs: number
  ammoMargin: number
  /** 战斗时长硬上限：打满即判负并按被迫撤退结算（2026-09-10 船长定；旧口径"按剩余血量比判胜"已作废） */
  maxBattleMs: number;
  /** **无法交战的提前脱战阈值**（2026-09-11 船长裁定「乙2 · 事件为 120 秒」）：
   *  开战满本毫秒数时，若**我方全程一炮未发**（`stats.meShots === 0`）**且当前距离仍在我方最远射程之外**
   *  **且敌人已经开火**（`stats.foeShots > 0`）⇒ 判负并按撤退结算（`escapeReason = 'cannot-engage'`），
   *  不再空转到 `maxBattleMs`。动机 = 远程型（kite）敌把交战距离拉在自己带内时，短射程/无推进器装配
   *  会全程 0 开火、空转 140~600 秒（灰霾打满 600s 触顶；蜃影/赤潮在 140/373s 被击毁）。
   *  `0` = 关闭本判定。 */
  cannotEngageMs: number;
  /* ═══ 推进器周期爆发（2026-09-10 船长定：60 秒爆发 / 60 秒冷却 / 开场即启动）═══ */
  /** 爆发窗口时长（毫秒）；周期由战斗时钟推导，不占存档字段 */
  thrusterBoostMs: number
  /** 冷却窗口时长（毫秒）；冷却期内推进器**不提供任何速度加成** */
  thrusterCooldownMs: number
  /* ═══ 敌冲锋（2026-09-10 船长定；2026-09-11 改判结束条件；**2026-09-14 逐单位 + 命中解除 + 冷却 10 秒**）═══
   * ⚠ 船长 2026-09-10：**暂时先取消实装，仅实现功能** → `foeChargeEnabled` 默认 false，
   *   机制齐备但"老路"（威胁门槛 + brawl）不触发；舰级级 opt-in 不受该开关约束。 */
  /** 冲锋总开关（默认 false = "老路"未实装；舰级级 opt-in 不走这里） */
  foeChargeEnabled: boolean
  /** 冲锋期敌机动倍率（**缺省值**；舰级 `FoeShipDef.foeChargeMul` 可覆写）——2026-09-14 船长定为 **3.0** */
  foeChargeMul: number
  /**
   * **冲锋触发余量**（船长 2026-09-14：「冲锋按乙方案来」）：距离 > 期望交距 + 本值 ⇒ 开始冲锋。
   * 与"够不着（超出自己射程）"**取或**；解除见 `foeChargeCooldownMs` 处的说明（命中解除 + 到达兜底）。
   * 例：噬口巨兽期望交距 543 ⇒ **1,543 m 起冲**（旧口径要 3,713 m 以外）。
   */
  foeChargeTriggerMarginM: number
  /** 进入自己武器射程后再维持多久，随后突进结束 */
  foeChargeMaxHoldMs: number
  /** 冲锋冷却（毫秒）：**解除后**这么久内不能再次冲锋（2026-09-14 船长由 20 秒改判为 **10 秒**） */
  foeChargeCooldownMs: number
  /** 冲锋威胁门槛：只有威胁 ≥ 此值、且战术为近战（brawl）的敌卡会冲锋（与 pdThreatFloor 同口径；只管老路） */
  foeChargeThreatFloor: number
  /* ═══ 单波次内增援（2026-09-11 机制落地 → **2026-09-19 船长批「支援呼叫装置」启用**）═══
   * 启用依据 = 船长 2026-09-19：「战斗开始20秒后，增援2艘幽灵舰。如果对方在自己最远射程之外时，
   * 增援2艘静滞卫舰。」⇒ `foeReinforceEnabled = true`；守卫由 content:check 的
   * 「**支援呼叫装置契约**」接管（只允许挂了该件的卡写 `enterAt`/`enterBranch`、两支成对且守恒）。
   * ⚠ **与多舰补偿系数 `2N/(N+1)` 是结构解法 vs 数值补偿两条路**：洞内派生会把总量归一
   * （补偿只影响血/火力比 `r`）⇒ 不叠加；全局复核仍挂着（见 `docs/design/foe-reinforce-20260911.md`）。 */
  /** 单波次内增援总开关（**2026-09-19 起 = true**；关掉 = 建档期不写 `foeReinforceAt`，零行为变化） */
  foeReinforceEnabled: boolean
  /** 增援入场时的**距离重开比例**（语义同 `waveReopenFrac`：向开战距离回拉这个比例；
   * 0 = 原地入场不重开 = 缺省口径） */
  foeReinforceReopenFrac: number
  /**
   * **「支援舰船召唤装置」总开关**（船长 2026-09-25：「给入侵母舰添加类似D族挂载件的独立挂载件，
   * 只不过改为复活被摧毁的友军（但是表现形式上为敌方支援舰船入场），增援时间是60秒，每次随机复活一艘」）；
   * 见 `FoeMountDef.reviveEscort`。
   *
   * `false`（缺省形态）= 建档期照旧写 `foeReviveEscort`（读数可见），但**战斗中一次都不召唤**
   * ——与 `foeChargeEnabled` / `foeReinforceEnabled` 同款总开关形态；本批随船长令**置 true**
   * （只有挂了该件的单位会召唤 ⇒ 其余战斗零行为变化）。
   */
  foeReviveEnabled: boolean
  /** 预估胜率扩散（logit 拉伸倍数，0.5 为不动点）：越高胜率加成越高、越低胜率惩罚越重——
   * 作用于悬赏展示与 AI 接单门槛（实际战斗结算不变） */
  winSpread: number
  /** AI 远征 favor 强度：开战按该船对此目标的模型胜率算优势 adv=(raw−0.5)×2，
   * 整场 AI 方命中 ×(1+k·adv)（上限 100%）、敌方 ×(1−k·adv)（上限保留 97%）——
   * 保证已过门槛的简单局接近必胜；仅 AI 远征生效，玩家手动战斗不受影响 */
  aiFavorStrength: number
  /** 击杀慢镜：战斗分出胜负后延迟结算的毫秒数（给最后一击动画与战败演出留时间；
   * 仅主控远征生效，AI 后台任务即时结算） */
  killcamMs: number
  /** 带伤预警扣分（2026-09-08 船长定：只作用于悬赏展示胜率——预计装甲全损扣 winPenaltyArmorPerFull、
   * 预计结构损耗额外按 winPenaltyHullPerFull；实际结算与 AI/模拟预估一律不变） */
  winPenaltyArmorPerFull: number
  /** 结构损耗预警扣分系数（结构伤比装甲伤扣得更重 = 船长的"更大幅度下调"） */
  winPenaltyHullPerFull: number  /* ═══ 敌舰近防炮（2026-09-10 船长拍板「无人机可被击落」，永久损失制）═══ */
  /** 点防起始威胁：威胁 < 此值的敌舰不装近防炮（2026-09-10 船长：60） */
  pdThreatFloor: number
  /** 判定周期（毫秒）：每艘点防舰每 0.5 秒判定一次伤害 */
  pdJudgementMs: number
  /** 判定命中率（直接与机型闪避相减；不叠敌方通用命中加成） */
  pdAcc: number
  /** **命中率下限**（2026-09-12 船长「允许命中下限 10%」）：`命中 = clamp(pdHitFloor, 1, pdAcc − 机型闪避)`
   *  ——防"机型闪避 ≥ pdAcc ⇒ 近防炮永远打不到"（首例 = 专属无人机闪避 0.55）。 */
  pdHitFloor: number
  /** **近防炮舰种档系数**（2026-09-12 船长「敌人防空火力受舰船级别影响。越大的舰船防空火力越强」）：
   *  索引 0 = T1 护卫舰 … 4 = T5 旗舰；每次命中伤害 = `pdDmg × 本系数`。 */
  pdTierMul: readonly number[]
  /** 命中单发伤害（走该机型三层抗性） */
  pdDmg: number
  /**
   * **按族的近防炮覆写**（**船长 2026-09-25 令**：「增强 H 族敌人的近防炮强度：其近防炮伤害增加50%，
   * 命中提高5%」）——`dmgMul` 与 `pdDmg × pdTierMul` **连乘**；`accAdd` 是**百分点**加在 `pdAcc` 上
   * （仍走 `pdHitFloor` 下限与机型闪避那套 clamp）。
   * 缺省/该族没登记 ⇒ 逐字走全局值（零行为变化）。族从 `UnitSpec.family` 取。
   *
   * **2026-10-03 加两个字段**（**船长令**：「**给光环势力的近防炮换成能量伤害的光束近防炮，
   * 特点是和光束武器一样，必中**」）：
   * - `dmgType`：本族近防炮的**伤害类型**（缺省 `kinetic` —— 三档动能近防炮那条线；R 族 = `plasma` 能量）；
   * - `autoHit`：**必中** = **完全不掷命中、也不吃机型闪避**（与光束武器同一句语义：
   *   引擎里 `autoHit ⇒ meHit = 1`、连骰子都不掷）⇒ 连 `pdHitFloor` 与闪避一起绕过。
   */
  pdFamilyOverride?: Partial<
    Record<FoeFamily, { dmgMul?: number; accAdd?: number; dmgType?: DamageType; autoHit?: boolean }>
  >
}
