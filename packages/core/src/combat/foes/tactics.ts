/** 战斗域职责拆分，保持原计算与顺序。 */
import type { BattleBalance } from '../../types'
import type { UnitSpec, WeaponSpec } from '../model'
import { foeGunMaxRangeOf, foeDroneRangeOf, foeRangeWithDebuff } from '../foeRange'
import { isAlive, clamp } from '../combatMath'
import { TACTIC_RANGE } from '../foePower'

/** 主系（权重最高；未写/空 = 动能）——**正权重键才参战**（2026-09-10 语义变更：旧"缺省键权重 1"作废）
 * （2026-10-02 批次 4f 迁到 wormholeFoes.ts） */

export const FOE_BEAM_USABLE_SHARE = 0.7

/**
 * 🔴 **闪现演出的时长 = 平衡表旋钮**（**船长 2026-10-02 令**：「**给闪现发生速度做一个旋钮，
 * 我感觉现在可能太短导致看不出来，先将整个过程延长到2000ms**」；同日复测后「**闪现观感上没问题了，
 * 将发生时间回调到400ms进行测试**」）。
 *
 * 两个数都在 `balance.battle` 上（改一处、引擎与界面同时跟随）：
 * - `foeBlinkProcessMs` = **单次闪现的整个动画过程**（UI **三等分**：消失 / 等待（发生时间）/ 出现）；
 * - `foeBlinkGapMs` = **相邻两次闪现的间隔**（排队时一段播完空这么久，下一段才开始）。
 *
 * ⚠ 这两条同时定义**禁火窗口**（船长：「敌舰消失时，玩家的武器不会开火」）——过程调长 = 停火同步变长。
 * ⚠ **取值沿革**：§27 落码时 200ms → 2026-10-02 延到 2000ms（看不出来）→ 同日回调到 **400ms**（实机复测）。
 * 队列总时长 = 段数 × (过程 ＋ 间隔)。
 */
export function blinkProcessMs(bal: BattleBalance): number {
  return Math.max(1, Math.round(bal.foeBlinkProcessMs ?? 200))
}

/** 段与段的间隔（同旋钮；缺省 200ms = 旧口径） */
export function blinkGapMs(bal: BattleBalance): number {
  return Math.max(0, Math.round(bal.foeBlinkGapMs ?? 200))
}

/**
 * 🔴 **一段闪现的三等分**（**船长 2026-10-01 原话**：「**播放动画的同时舰船消失-等待发生时间-在新位置
 * 播放动画同时舰船出现**」）——整个过程 `foeBlinkProcessMs` 平分成三份：
 *
 * | 段 | 占比 | 谁在动 |
 * |---|---|---|
 * | ① 消失 | **1/3** | 舰船淡出（旧位置） |
 * | ② **等待（发生时间）** | **1/3** | 舰船不可见；**位移在这一段的起点兑现**（`moveAtMs`） |
 * | ③ 出现 | **1/3** | 舰船在新位置淡入 |
 *
 * ⚠ **为什么是三等分而不是对半劈**（**2026-10-02 船长实机反馈**）：「**我原先中间插入的发生时间等待
 * 怎么被取消了？**」——对半劈的版本只有"淡出 ＋ 淡入"，**没有中间那段等待**（且位置在触发那刻就换）。
 */
export const BLINK_VANISH_SHARE_NUM = 1

export const BLINK_SHARE_DEN = 3

/**
 * **该敌舰的「决策用最远射程」**——它心里那把尺（**只给站位/期望距离用**，`inRange` 门不吃它）。
 *
 * - **激光武器**（`kind === 'beam'`）：`0.7 ×` 有效射程（后 30% 是它自己认为的无效射程）；
 * - **其余武器**（实弹 `fixed` / 炮台 `gun` / 机群）：原样 = 有效射程（**零行为变化**）。
 *
 * ⚠ 逐武器取 `max`（不是"整船打七折"）：混装敌人只有激光那一条被折（裁定 1）。
 * ⚠ `foeGunMaxRangeOf` 走的是**与开火门同一把尺**（含「受击增程 × 我方电子舰压制」）
 *   —— 这正是裁定 2 要的"当前有效射程"口径。
 */
export function foeDecideReachM(
  b: import('../../state').BattleState | undefined,
  unit: UnitSpec,
): number {
  let top = 0
  for (const w of unit.weapons) {
    /**
     * **当前有效射程**：传了战斗态 ⇒ 与开火门同一把尺（`foeGunMaxRangeOf`，含「受击增程 × 我方压制」）；
     * 没传（纯函数场合，如 `foeDesiredRange`） ⇒ 按基础射程算 —— 那两道的折算由调用方自己套。
     */
    const reach = b !== undefined ? foeGunMaxRangeOf(b, unit, w) : w.maxRangeM
    top = Math.max(top, w.kind === 'beam' ? Math.round(reach * FOE_BEAM_USABLE_SHARE) : reach)
  }
  return top
}

/** 开战距离 = 双方最大射程 ×factor + 缓冲；缓冲 = max(固定 100m, 最大射程×10%)（船长 2026-09-05：
 * 远程武器不再 100m 即接战，按射程比例拉开，保证开场有可见的接近窗口） */
export function battleOpenM(me: UnitSpec, foes: UnitSpec[], bal: BattleBalance): number {
  let top = 0
  for (const w of me.weapons) top = Math.max(top, w.maxRangeM)
  for (const f of foes) for (const w of f.weapons) top = Math.max(top, w.maxRangeM)
  const pad = Math.max(bal.openRangePadM, Math.round(top * (bal.openRangePadShare ?? 0.1)))
  return Math.round(top * bal.openRangeFactor + pad)
}

/**
 * 🔴 **R 族族格：以「玩家的射程盲区 / 射程线」为期望距离**（**船长 2026-10-01 令**，原话照抄）：
 *
 * > 「这个机制是给敌人用的，是R族以玩家的盲区为期望目标。并不是玩家使用的。等于R族敌人会寻找玩家的
 * > 射程漏洞，玩家如果射程短，则R族采取风筝玩家，玩家射程长、有近盲区，则R族会主动贴身。」
 * > 「**R 族也按照头目/队长算。期望距离优先选择靠近对方最大射程的位置。比如我方4000射程，
 * > 敌人10000射程。优先选择4000更远一点的距离。而不是按照默认的。**」
 * > 「按你推荐」（= 风筝距离取 `我方射程上限 + 100`；多波卡**每波各自取本波第一个 R 族单位**当队长）
 *
 * **队长**（2026-10-01 定案）= **本波编成里第一个 R 族单位**——
 * 与既有引擎"期望距离由 `foes[0]` 决定"同一把尺（`foeDesiredRange` 的 `head = foes[0]`），
 * 只是跳过非 R 族：混编卡里若第一个是别的族，队长仍取**第一个 R 族**（族格的决策者必须是 R 族）。
 * 多波卡**逐波各取自己那一波**的第一个（与既有"每波各自算"一致）。
 *
 * 三类优先级（高 → 低）：
 * 1. **① 风筝（最高）**：队长射程 `capTop > meTop`（它打得比我方远）⇒ 站 **`meTop + 100`**
 *    （就地贴在我方射程线**外侧**：我方刚够不着、它却在自己火力最强的区间）。
 *    ⚠ 这一条是**船长明确纠正**过的取值：早先版本往"队长射程的 8 成"跑（我方 4000 / 它 10000 会站到 8000），
 *    船长要的是**靠近我方最大射程的位置**（⇒ 4100）。
 * 2. **② 钻近盲区**：①不成立、且我方 `0 < meBlindM < meTop` ⇒ 贴到我方近界下沿 `meBlindM − 100`；
 *    "全船都在盲区内"（`meBlindM ≥ meTop`，纯近战装配）⇒ 取 `meTop + 500`。
 * 3. **③ 默认**：都不成立（我方射程 ≥ 队长射程、且我方无近界）⇒ **不覆写**（返回 `null`），
 *    由 `foeDesiredRange` 按队长自己的射程带 ×战术系数算。
 *
 * 用途三层：① 写进各 R 族单位的 `foeDesireRangeM`（`foeDesiredRange` 读它 ⇒ 逐拍走位按它拉扯）；
 * ② **本场目标交战距离**（`battle.myDesireM`）；③ 放在 `if (wormhole) / else` **之外** ⇒ 洞内洞外都生效。
 * **非 R 族 `null` ⇒ 整段不执行、逐字走原口径。**
 */
export function rFamilyDesireOf(
  me: UnitSpec,
  foes: readonly UnitSpec[],
  bal: BattleBalance,
  /**
   * **战斗态（可选）**——传了就吃「挨打增程」后的有效射程（与开火链同一把尺，船长 2026-10-01 裁定 2：
   * 有效射程的基准 = **当前**有效射程）；不传 = 只按"基础射程 × 我方电子舰压制"算（老调用点零改动）。
   */
  b?: import('../../state').BattleState,
): number | null {
  let meTop = 0
  let meBlindM = 0
  for (const w of me.weapons) {
    if (w.disabled) continue
    meTop = Math.max(meTop, w.maxRangeM)
    meBlindM = Math.max(meBlindM, w.minRangeM ?? 0)
  }
  if (meTop <= 0) return null
  // **队长 = 本波编成里第一个 R 族单位**（跳过其它族；一族都没有 ⇒ 本函数不介入）
  const cap = foes.find((f) => f.family === 'R')
  if (!cap) return null
  /**
   * 队长的射程：**决策用「有效射程」**（**船长 2026-10-01 令**，见 `FOE_BEAM_USABLE_SHARE`）——
   * R 族五档全是激光（`energyForm: 'beam'`）⇒ 这里取的就是 `0.7 × 当前有效射程`。
   * ⚠ 只影响 **①风筝的"够不够得着"判定**；风筝的**落点**仍是 `meTop + 100`（贴的是**我方**射程线，
   *   与它自己射程多长无关）。⇒ 效果 = 它更不容易选择"站到你射程线外侧"，转而走 ②/③。
   */
  const capTop = foeDecideReachM(b, cap as UnitSpec)
  if (capTop <= 0) return null
  const floor = bal.minDistanceM
  /** ⚠ 钳制上限用**原始射程带**（不是 `capTop`）：允许族格把它压进"它自己的无效射程"里 */
  const capReachRaw = Math.max(cap.foeRangeBand?.max ?? 0, ...cap.weapons.map((w) => w.maxRangeM))
  const clampTo = (v: number): number => Math.max(floor, Math.min(Math.round(v), capReachRaw))
  // ① 风筝（最高优先）：队长打得比我方远 ⇒ 贴到我方射程线外侧
  if (capTop > meTop) return clampTo(meTop + 100)
  // ② 钻近盲区：贴到我方近界的下沿（纯近战装配 ⇒ 站到我方射程之外）
  if (meBlindM > 0) {
    return clampTo(meBlindM < meTop ? Math.max(floor, meBlindM - 100) : meTop + 500)
  }
  // ③ 都没有 ⇒ 不覆写（走默认期望距离）
  return null
}

/**
 * **战场远端的距离上限**（2026-09-19 船长裁定「甲」）。
 *
 * 由来：船长报「部分敌人会增加射程的情况下，战场可以移动的距离还是很短，**无法逃离对方射程**」，
 * 并定口径「**计算战场宽度时考虑到技能的增程就行，不用直接乘**」⇒ 本函数**沿用 `battleOpenM`
 * 那套"射程 + 10% 缓冲"公式**（不引入任何常数放大），但两处不同：
 * 1. **取"当前"射程**——我方那一侧已含技能 / 装配 / 谜质科技的增程（每拍重建的规格带的），
 *    敌方那一侧读**受击增程生效后**的有效射程（`foeGunMaxRangeOf` / `foeDroneRangeOf`，
 *    与开火门同一把尺），不再用开战那一刻的旧值；
 * 2. **只增不减**——`开战距离` 是地板 ⇒ 没有增程时**逐字等于旧行为**（`maxM === openM`）。
 *
 * 例（本批实测）：导弹残段基础 11,000m ⇒ 开战距离 12,100m；它挨打增程后射程 16,500m
 * ⇒ 上限抬到 **18,150m** ⇒ 玩家重新退得到它射程之外（改前上限钉在 12,100m，退不出去）。
 *
 * ⚠ 上限只由"双方射程"决定，**与谁快谁慢无关**：能不能真的站到那么远，仍看每拍那场
 * 速度拔河（`steerStep` 双方各拽一把）——所以"有地方可退" ≠ "一定退得掉"。
 *
 * ⚠ **2026-09-22 船长令（本次修正）**：「**虫洞内交战距离上限不应该只看玩家操作的舰船和敌人，
 * 应该将队伍里所有舰船都考虑到。**」⇒ 新增可选入参 `ours`（我队**全队**规格）；
 * **"远端"（`top`）遍历全队的最远武器射程**，而 **`open`（开战距离）仍只按主控**（船长明确：
 * 要改的是距离上限，不是初始距离/期望距离）。不传 `ours` ⇒ **逐字等于旧行为**（老调用零改动）。
 */
export function battleMaxDistanceM(
  b: import('../../state').BattleState,
  me: UnitSpec,
  foes: readonly UnitSpec[],
  bal: BattleBalance,
  /**
   * 我队**全队**（含 `me` 本身也无妨，取 max 幂等）——2026-09-22 船长令：
   * 战场距离上限要把僚舰的射程一并算进去（原先只看主控 ⇒ 僚机装远射武器也拉不开战场）。
   */
  ours?: readonly UnitSpec[],
): number {
  const open = battleOpenM(me, foes as UnitSpec[], bal)
  let top = 0
  for (const w of me.weapons) top = Math.max(top, w.maxRangeM)
  /** 全队（船长令）：任一僚舰射程更远 ⇒ 战场远端随之抬高 */
  for (const u of ours ?? []) for (const w of u.weapons) top = Math.max(top, w.maxRangeM)
  for (const f of foes) {
    // 机群武器也在这张表里（`src === 'drone'`）⇒ 按**各自的增程/削减口径**取有效射程，别混用炮台那条
    for (const w of f.weapons) {
      top = Math.max(top, w.src === 'drone' ? foeDroneRangeOf(b, w, f) : foeGunMaxRangeOf(b, f, w))
    }
  }
  const pad = Math.max(bal.openRangePadM, Math.round(top * (bal.openRangePadShare ?? 0.1)))
  return Math.max(open, Math.round(top * bal.openRangeFactor + pad))
}

/** **玩家主武器（战术距离口径；船长 2026-09-12 裁定「甲」）** = **射程最远的武器**；
 *  并列射程时取**名义火力大的**（再并列保持武器表顺序）。**三按钮（贴脸/中距/风筝）、出发前战术、
 *  战斗界面「我方射程带」共用这一处**。
 *
 *  为什么改（玩家报障「战斗界面下方的快速选择贴脸/中距/风筝，现在的距离不正确」）：
 *  旧口径 `weapons.find(w => w.kind === 'gun') ?? weapons[0]` 有两处系统性取错——
 *  **激光是 `beam`、基础舰炮是 `fixed`，都不算 `gun`** ⇒ 纯激光/无人机船回落到恒在的「基础舰炮」(2,500m)；
 *  **近防炮是 `gun`（2,500m）** ⇒ 装了它的船一律被 PD 抢位。实测（真数据真引擎）：
 *  激光船（主武器 4,600m）三按钮 **200/1250/2375 → 200/2300/4370**、
 *  近防炮 + 导弹架 MK2（11,760m）**200/1251/2375 → 540/6330/11172**；
 *  炮台船与纯导弹船一字不变（旧口径恰好取对）；战斗界面「我方射程带」随之从
 *  「基础舰炮 0~2500」/「近防炮 1~2500」修正为真实主武器射程带。 */
export function mainWeaponOf(me: UnitSpec): WeaponSpec | undefined {
  let best: WeaponSpec | undefined
  let bestDps = -1
  for (const w of me.weapons) {
    if (w.disabled) continue
    if (best === undefined || w.maxRangeM > best.maxRangeM) {
      best = w
      bestDps = nominalWeaponDps(w)
    } else if (w.maxRangeM === best.maxRangeM) {
      const d = nominalWeaponDps(w)
      if (d > bestDps) {
        best = w
        bestDps = d
      }
    }
  }
  return best
}

/** 名义单发/秒（并列射程时的取舍依据；与装配页 `rawDpsOf` 同口径）：
 *  炮台取首弹种单发、其余取 `shotDmg`，乘门数除以装填秒。 */
export function nominalWeaponDps(w: WeaponSpec): number {
  const per = w.kind === 'gun' ? (Object.values(w.shotsByType ?? {})[0] ?? 0) : (w.shotDmg ?? 0)
  return (per * (w.count ?? 1)) / Math.max(0.1, w.reloadMs / 1000)
}

/** 玩家战术期望距离（贴脸/中距/风筝）。
 * "主武器" = **射程最远的武器**（见 `mainWeaponOf`）。
 *
 * ⚠ **中距档 = 射程带内的位置**（2026-09-15 船长两次裁定）：缺省 = `bal.desireBandMid`（**0.8 = 射程带高位**），
 * **星图与洞内同值**（当天先落成"星图 0.8 / 洞内 0.5"分档，船长更正「这个是我口误，可以回滚那句」⇒ 取消分档）。
 * 起因＝玩家报「赏金任务一开始就在近距离、对远程武器不利」：开战那一瞬其实是最远的（16,368 m），
 * 真正"近"的是稳态期望（旧口径中点 = 射程的 54%），战斗 ~30 秒后必然收拢到那里。
 * ⚠ **洞内"近战怪开局距离"另走 `bal.wormholeBrawlOpenBand`（0.5）**，见 `startFleetBattleFor` 的洞内分支。
 * 贴脸 / 风筝两档是固定位置，不受 `midPos` 影响。 */
export function desiredRangeFor(
  me: UnitSpec,
  tactic: 'assault' | 'mid' | 'kite',
  bal: BattleBalance,
  midPos = bal.desireBandMid,
): number {
  const main = mainWeaponOf(me) ?? me.weapons[0]
  const mainMin = main ? main.minRangeM : 0
  const mainMax = main ? main.maxRangeM : 0
  if (tactic === 'assault') return Math.max(bal.minDistanceM, Math.round(mainMin * 0.6))
  if (tactic === 'kite') return Math.max(bal.minDistanceM + 1, Math.round(mainMax * 0.95))
  // mid：有效射程带内的位置（缺省中点；钳到 0~1 免得数据写坏时飞出射程带）
  const pos = Math.min(1, Math.max(0, midPos))
  return Math.max(bal.minDistanceM, Math.round(mainMin + (mainMax - mainMin) * pos))
}

/**
 * 敌方编队期望交战距离。
 *
 * **2026-09-11 船长裁决②（本函数的口径修正）**：**战术只决定"带内的偏好位置"，带由单位自己决定**。
 * - **舰级路径**（写了 `AnomalyDef.ships` 的卡）：带 = **该单位自己的有效射程带**
 *   （`foeRangeBand`，含条目 `rangeMul`/`rangeMinM`/`rangeMaxM` 覆写后的绝对值）。
 * - **旧威胁推导路径**：带 = 全局战术表 `TACTIC_RANGE[战术]`——**一字不动**
 *   （旧路径的"射程带与期望交距同源"本来是自洽的，故不修）。
 *
 * **动机（实测）**：旧口径把带写死成旧表的绝对区间，于是"敌人想站的位置"与"敌人打得到的距离"脱钩：
 * 快艇（1~1883m）被要求站 440m 还凑合，但狙击舰（1255~9619m）按 kite 站 8000m、按 orbit 站 2688m
 * 都可能**站在自己射程之外**；反过来慢速玩家追不上 → 双方都够不着 → 打满 600s 判负
 * （演习场/新港裸船实测；见 `docs/design/p0-foe-desired-range-20260911.md`）。
 *
 * **与旧口径的可比映射**（同一张 `tacticDesireFactor`，只把带换成"自己的带"）：
 * 期望交距 = `自己带.min + factor[战术] × (自己带.max − 自己带.min)`，
 * 其中 factor 沿用旧口径的**相对位置**语义（brawl 0.20 靠带内近端 / orbit 0.55 居中 / kite 0.85 贴远端）。
 * 取值依据 = **保持"带内相对位置"这一层语义不变**，只让"带"随舰级伸缩（船长口径：
 * 「射程和战术仅仅的弱相关，并不实时强绑定」）。A 族实测差异举例：
 * 快艇 440 → **377m**、护卫舰 2688 → **2498m**、狙击舰 8000 → **8364/8885/10102m**、
 * B 小艇 2688 → **1210m**（后者正是"教学卡敌人一炮未放/双方锁死"的解）。
 *
 * **混编卡取哪一个单位**：取 `foes[0]`（卡上**首个主体单位**，与既有"战术取自 foes[0]"一致）。
 * 需要让头目站得与杂鱼一致（或不同）时，用条目 `rangeMinM`/`rangeMaxM` 覆写（"同卡同带"，
 * A 族四张 kite 卡已用此旋钮把 60% 的头目火力救回来）——**不引入加权平均**（避免"谁都不到位的中间值"）。
 */
/**
 * 🔴 **激光敌人的「有效射程」占比**（**船长 2026-10-01 令**，原话照抄）：
 *
 * > 「**添加新的敌人规则，所有使用激光的敌人，其射程的前70%视作有效射程，后30%视作无效射程，
 * > 考虑各种情况时，忽略无效射程。比如在选择期望距离时，只根据有效射程来选择。
 * > 但是开火战斗还是按照全射程来开火。**」
 *
 * ⇒ **只影响"它想站多远"（决策），不影响"它能不能打到你"（开火）**：
 * 射程的**前 70% = 有效**、**后 30% = 无效**；凡是"考虑站位/期望距离"的场合按**有效**算，
 * 而 `inRange` 门、远端衰减、命中与伤害结算**一律仍按全射程**。
 *
 * **同日四条裁定**（船长逐条答复）：
 * 1. **按武器认**：只看**那条激光武器**（`kind === 'beam'`）⇒ 混装的实弹武器照旧按全射程；
 * 2. **基准 = 当前有效射程**：先走完既有的「挨打增程」「我方电子舰射程压制」，**再 ×0.7**
 *    （⇒ 静滞卫挨打增程 8,000→12,000 时，有效射程 5,600→8,400：**增程仍全额是收益**）；
 * 3. **只改期望距离**（走位/站位）——开场距离、胜率预估、界面显示**都不动**；
 * 4. **战场远界照最大射程**（`battleMaxDistanceM` 一行不改）。
 *
 * ⚠ 船长同日的纠正（记下来免得再想歪）：「**你说的副作用实际上不存在，因为开火射程没有变，
 * 正常情况下只影响期望距离。**」——所以这不是"削弱激光敌人"，而是**改变它选位**。
 */

export function foeDesiredRange(
  _me: UnitSpec,
  foes: UnitSpec[],
  bal: BattleBalance,
  /**
   * **我方电子舰对敌舰射程的削减率**（缺省 0 = 旧口径，逐字不变）。
   *
   * **船长 2026-09-18：「削减射程后，敌人的期望距离也要随之改变」** ⇒ 敌人**主动压近**以恢复火线：
   * 把射程带的上界换成"**只被削减后**的有效上界"（`foeRangeWithDebuff(band.max, 1, r)`），
   * 再在**有效带**里取同一相对位置（band 路径）；显式钉住的期望距离（`foeDesireRangeM`）
   * 按同一比例 `有效上界 ÷ 原上界` 收缩。
   *
   * ⚠ **只随「削减」变化，「受击增程」照旧不改期望距离**（2026-09-12 既有口径：增程让它够得更远、
   * 不必挪窝）——所以这里的倍率固定传 1，不读 `foeGunRangeBuff`。
   */
  foeRangeDebuffR = 0,
  battle?: import('../../state').BattleState,
): number {
  const acidRoster = battle !== undefined && foes.some(f => f.acidBurst)
  if (acidRoster && foes.some(f => f.acidBurst && isAlive(battle!, f.tag))) return bal.minDistanceM
  const head = acidRoster ? foes.find(f => isAlive(battle!, f.tag)) : foes[0]
  // **期望距离覆写优先**（船长 2026-09-11 E 族：「战术调整、期望距离不改」）
  const pinned = head?.foeDesireRangeM
  // 舰级路径：带 = 自己的有效射程带；旧路径：带 = 全局战术表（原样）
  const band = head?.foeRangeBand ?? TACTIC_RANGE[head?.foeTactic ?? 'orbit']!
  // **削减后的有效上界**（只吃削减、不吃增程；基础 <3000m 或没有电子舰 ⇒ 等于原上界）
  const effMax = foeRangeDebuffR > 0 ? foeRangeWithDebuff(band.max, 1, foeRangeDebuffR) : band.max
  /**
   * 🔴 **激光敌人：选位只看「有效射程」（前 70%）**（**船长 2026-10-01 令**，见 `FOE_BEAM_USABLE_SHARE`）。
   *
   * 本函数是**纯函数**（不读战斗态）⇒ 只能按"**基础射程 × 削减**"折算 0.7，
   * **不叠加**"挨打增程"（那条要读 `BattleState.foeGunRangeBuff`，而它只在**开火**链上生效）。
   * 结果 = 没有增程的场合与 `foeDecideReachM` **完全一致**；有增程时这里略保守（不放大）。
   *
   * ⚠ 射程带的 **`min` 不动**：近界不是"打不着的远端"，把它折 0.7 反而凭空造出一个近盲区。
   * ⚠ 返回值的**上限钳制仍是原始 `effMax`** ⇒ 允许它站到自己的"无效射程"里
   *   （那是"族格/盲区把它压过去的位置"，不是"它自己想要的位置"）。
   */
  const isBeam = head !== undefined && head.weapons.some((w) => w.kind === 'beam')
  const decideMax = isBeam ? Math.round(effMax * FOE_BEAM_USABLE_SHARE) : effMax
  if (pinned !== undefined && Number.isFinite(pinned)) {
    const ratio = band.max > 0 ? decideMax / band.max : 1
    return Math.max(bal.minDistanceM, Math.round(pinned * ratio))
  }
  const pos = clamp(0.05, 0.95, bal.tacticDesireFactor[head?.foeTactic ?? 'orbit'] ?? 0.5)
  return Math.max(bal.minDistanceM, Math.min(effMax, Math.round(band.min + pos * (decideMax - band.min))))
}
