/**
 * **敌方炮台受击增程**用例（2026-09-12 船长：「给 D 族静滞卫舰加入类似 E 族挨打加炮台射程的效果，
 * 不过**仅影响所有静滞卫舰**。挨打后射程增加 50%」）。
 *
 * 船长当日三条裁决：
 * - **甲**：任一静滞卫舰挨打 ⇒ **全体静滞卫舰** ×1.5（本场永久、**只推一条**画面提示）；
 * - **乙**：**只延长最远射程**（12,000 → **18,000m**），近界 2,062 不动；**原射程内的命中/伤害折减
 *   **一字不变**，延长段**按同斜率**继续线性衰减（18 km 处 ≈ ×0.20，而不是趴在 `falloff` 的平台上）；
 * - **甲**：挨打时弹战斗画面提示（与 E 族同一处提示位）。
 *
 * 口径对照（**两套独立**，互不覆盖）：E 族的 `droneRangeMulOnHit` 作用于"**整支敌队的机群**"；
 * 本条的 `gunRangeMulOnHit` **只作用于带该字段的敌舰**（= 所有静滞卫舰）。
 *
 * 数据侧 = **真卡真舰级**：穹顶守卫 96（`ano-vault-sentinel`）= 静滞卫舰 ×2 + 守墓长舰 ×1，
 * 正好同时覆盖"该型舰吃倍率 / 同场其它舰级不吃"两面。
 */
import { describe, expect, it } from "vitest";
import { buildSimContext, FOE_SHIPS } from "@whale/data";
import { addShipToFleet, addWare, createInitialState } from "../src/index";
import {
  advanceBattleFor,
  battleArcsFor,
  beamPowerFactor,
  createFoeSpecs,
  foeGunMaxRangeOf,
  foeGunPowerFactorOf,
  foeGunRangeMulOf,
  startBattleFor,
} from "../src/combat";
import type { BattleState, GameState } from "../src/state";
import type { AnomalyDef, SimContext } from "../src/types";

const base = buildSimContext();
const bal = base.balance.battle;
/** 真卡：穹顶守卫 96（D 族 · 静滞卫舰 ×2 + 守墓长舰 ×1） */
const VAULT = base.anomalies.get("ano-vault-sentinel")!;
/** 找到某舰级（舰级表在 data 包，不进 SimContext） */
function shipDef(shipId: string) {
  const s = FOE_SHIPS.find((x) => x.id === shipId);
  if (!s) throw new Error(`舰级不存在：${shipId}`);
  return s;
}

function ctxWith(card: AnomalyDef): SimContext {
  return { ...base, anomalies: new Map([...base.anomalies, [card.id, card]]) };
}

/** 玩家侧：王鲭（厚甲多槽，够活到触发）+ 动能炮与备弹（炮台要弹才打得出去） */
function makeState(seed = 5): GameState {
  const state = createInitialState({ nowWallMs: 0, seed });
  const uid = addShipToFleet(state, "sh-sentinel");
  state.shipId = uid;
  state.fleet[uid]!.fitted = {
    high: ["mod-turret-kin-2"],
    mid: ["mod-shield-kin-2", "mod-track-2"],
    low: ["mod-stab-kin-2"],
  };
  addWare(state, "ammo-kinetic-l", 500);
  return state;
}

/** 跑到 `advMs` 就停（把 battle 与 state 一并返回：射程标签要读 `state.expedition.battle`） */
function runBattle(
  card: AnomalyDef,
  advMs = 60_000,
): { state: GameState; battle: BattleState; ctx: SimContext } {
  const ctx = ctxWith(card);
  const state = makeState();
  const battle = startBattleFor(state, ctx, state.shipId, card.id, 0)!;
  state.expedition.active = true;
  state.expedition.phase = "battle";
  state.expedition.anomalyId = card.id;
  state.expedition.battle = battle;
  state.gameMs = advMs;
  advanceBattleFor(state, ctx, battle, state.shipId, card.id);
  return { state, battle, ctx };
}

/** 合成卡：单具指定舰级、**拉到 1.5 km 打**（否则远程档的静滞卫舰会把距离钉在 10 km 外，
 *  我方炮台够不着 ⇒ 永远触发不了） */
function closeCard(shipId: string, hpMul = 6): AnomalyDef {
  const ship = shipDef(shipId);
  return {
    ...VAULT,
    id: "ano-test-gun-range",
    name: "炮台增程试验卡",
    threat: 60,
    ships: [{ ship, count: 1, hpMul, desireRangeM: 1500 }],
    waves: [{ units: 1, hpShare: 1 }],
  };
}

describe("敌方炮台受击增程（D 族静滞卫舰 · 仅该型舰）", () => {
  it("建档：静滞卫舰带倍率 1.5，同场的守墓长舰不带（真卡穹顶守卫 96）", () => {
    const units = createFoeSpecs(VAULT, bal);
    const stasis = units.filter((u) => u.name === "静滞卫舰");
    const longship = units.filter((u) => u.name === "守墓长舰");
    expect(stasis.length).toBeGreaterThan(0);
    expect(longship.length).toBeGreaterThan(0);
    expect(stasis.every((u) => u.foeGunRangeMulOnHit === 1.5)).toBe(true);
    expect(longship.every((u) => u.foeGunRangeMulOnHit === undefined)).toBe(true);
  });

  it("射程：静滞卫舰 12,000 → 18,000m（×1.5）；守墓长舰 7,391m 一个字不动", () => {
    const { battle } = runBattle(closeCard("foe-d-stasis"));
    const units = createFoeSpecs(VAULT, bal);
    const stasis = units.find((u) => u.name === "静滞卫舰")!;
    const longship = units.find((u) => u.name === "守墓长舰")!;
    const wStasis = stasis.weapons[0]!;
    const wLong = longship.weapons[0]!;

    // 未触发：都是档案值（⚠ 这一场 60 秒内已经自然打中过 ⇒ 先清掉状态再看"触发前"）
    battle.foeGunRangeBuff = undefined;
    expect(foeGunRangeMulOf(battle, stasis)).toBe(1);
    expect(foeGunMaxRangeOf(battle, stasis, wStasis)).toBe(12_000);
    expect(foeGunMaxRangeOf(battle, longship, wLong)).toBe(wLong.maxRangeM);

    battle.foeGunRangeBuff = 1.5; // 手动盖章（触发链由下面两条真引擎用例守）
    expect(foeGunRangeMulOf(battle, stasis)).toBe(1.5);
    expect(foeGunMaxRangeOf(battle, stasis, wStasis)).toBe(18_000); // 12,000 × 1.5
    expect(foeGunMaxRangeOf(battle, longship, wLong)).toBe(wLong.maxRangeM); // 同场其它舰级不受影响
  });

  it("折减（船长选乙）：原射程内与原公式逐字一致；延长段同斜率外推、不是平台", () => {
    const { battle } = runBattle(closeCard("foe-d-stasis"));
    const stasis = createFoeSpecs(VAULT, bal).find((u) => u.name === "静滞卫舰")!;
    const w = stasis.weapons[0]!;
    expect(w.minRangeM).toBe(2_062);
    expect(w.maxRangeM).toBe(12_000);
    expect(w.falloff).toBe(0.5);

    battle.foeGunRangeBuff = 1.5;
    // ① 原区间内：与 `beamPowerFactor`（光束原公式）逐字相等（含近端、中点、最远端）
    for (const dist of [2_062, 4_000, 7_000, 9_000, 12_000]) {
      expect(foeGunPowerFactorOf(battle, stasis, w, dist)).toBeCloseTo(beamPowerFactor(dist, w), 12);
    }
    // ② 原最远端仍是 falloff（0.5）——"旧距离内读数不变"的锚点
    expect(foeGunPowerFactorOf(battle, stasis, w, 12_000)).toBeCloseTo(0.5, 12);
    // ③ 延长段继续掉（同斜率）：斜率 = (1 − 0.5) / (12,000 − 2,062)
    const slope = (1 - 0.5) / (12_000 - 2_062);
    expect(foeGunPowerFactorOf(battle, stasis, w, 15_000)).toBeCloseTo(0.5 - slope * 3_000, 12);
    expect(foeGunPowerFactorOf(battle, stasis, w, 18_000)).toBeCloseTo(0.5 - slope * 6_000, 12);
    expect(foeGunPowerFactorOf(battle, stasis, w, 18_000)).toBeLessThan(0.25); // 明确不是 0.5 的平台
    // ④ 未触发时延长段的读数不存在（超射程照旧不打：门在外层，这里只证明不外推）
    battle.foeGunRangeBuff = undefined;
    expect(foeGunPowerFactorOf(battle, stasis, w, 18_000)).toBeCloseTo(0.5, 12);
  });

  it("触发（真引擎）：打中静滞卫舰本体 ⇒ 该型舰射程 ×1.5 + 一条战斗画面提示；只触发一次", () => {
    const card = closeCard("foe-d-stasis");
    const { state, battle } = runBattle(card);
    expect(battle.foeGunRangeBuff).toBe(1.5);
    const noticeText = (b: BattleState): string[] =>
      (b.notices ?? []).map((n) => n.text).filter((t) => t.includes("静滞阵列解除限幅"));
    expect(noticeText(battle)).toHaveLength(1); // 该型舰共享同一状态 ⇒ 只推一条（不逐舰各推）
    expect(noticeText(battle)[0]).toBe("静滞阵列解除限幅：静滞卫舰炮台射程 +50%");
    // 继续打：不重复盖章、不重复提示
    state.gameMs += 60_000;
    advanceBattleFor(state, ctxWith(card), battle, state.shipId, card.id);
    expect(noticeText(state.expedition.battle!)).toHaveLength(1);
  });

  it("负向：只有守墓长舰的卡（无该字段）跑满 60 秒 ⇒ 绝不触发", () => {
    const { battle } = runBattle(closeCard("foe-d-longship"));
    expect(battle.foeGunRangeBuff).toBeUndefined();
  });

  it("界面同源：触发后底部敌方射程标签出现 18,000m 那条带（不是旧值 12,000）", () => {
    const card = closeCard("foe-d-stasis", 60); // 血厚一点，保证建视图时还在打
    const { state, battle } = runBattle(card, 20_000);
    // 触发链由上面那条真引擎用例守；这里只钉"界面读数与射程同源"，故直接盖章
    battle.foeGunRangeBuff = 1.5;
    state.expedition.battle = battle; // 交火中：视图读的就是这一份
    const arcs = battleArcsFor(state, ctxWith(card))!;
    const bands = arcs.foeBands.map((b) => `${b.minM}~${b.maxM}`);
    expect(bands.some((b) => b.endsWith("~18000"))).toBe(true);
    expect(arcs.foe.maxM).toBe(18_000); // 聚合带（距离尺/战场弧）同步
  });
});
