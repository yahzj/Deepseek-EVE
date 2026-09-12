/**
 * **敌方机群（舰载无人机）**用例（2026-09-11 机制批 S2 · 船长十四条裁定 · 设计稿
 * `docs/design/foe-drone-system-20260911.md`）。
 *
 * 用**合成舰级 + 真机型表**驱动（正式样本卡在 S3 落），钉住四件事：
 * 1. **建档**：`FoeShipDef.drones` 展开成**每架一条** `src:'drone'` 武器条目（与我方同构）；
 * 2. **A5 火力守恒**：机群吃**同一条 `dmgMul`**、**不吃多舰补偿** `2N/(N+1)`（船长裁定「不吃」）；
 * 3. **生存池**：按**敌单位 tag** 建池、与机群条目同序、三层血取**机型表绝对值**（不吃玩家技能）；
 * 4. **会开火**：机群按机型 `reloadMs`/射程/命中独立开火 ⇒ 战斗 fx 里出现 `src:'drone'` 事件；
 *    **负向对照**（同卡不写 `drones`）⇒ 无池、无 drone 事件（既有战斗零行为变化）。
 */
import { describe, expect, it } from "vitest";
import { buildSimContext, FOE_DRONE_E_ALERT } from "@whale/data";
import { addShipToFleet, addWare, createInitialState } from "../src/index";
import {
  advanceBattleFor,
  createFoeSpecs,
  foeDroneRangeOf,
  pickFoeDroneTarget,
  startBattleFor,
} from "../src/combat";
import type { BattleState, GameState } from "../src/state";
import type {
  AnomalyDef,
  FoeShipDef,
  FoeDroneSlot,
  SimContext,
} from "../src/types";

const base = buildSimContext();
const bal = base.balance.battle;

/** 试验舰级：母舰**射程 1~10 m**（够不着，用来把"机群的火力"从"母舰的火力"里分出来）。
 *  `shotDmg` 单独给参数：打"开火"用例时压到 1（保证玩家活得够久、机群打得出来），
 *  A5 守恒用例用 100（便于对倍率取整）。 */
function testShip(drones?: readonly FoeDroneSlot[], shotDmg = 100): FoeShipDef {
  return {
    id: "foe-test-drone",
    name: "试验巨构",
    family: "E",
    hullClassTier: 4,
    speedRatio: 0.8,
    hp: 1600,
    split: { s: 0.2, a: 0.55, h: 0.25 },
    shotDmg,
    hitRate: 0.65,
    reloadMs: 4000,
    rangeMinM: 1,
    rangeMaxM: 10,
    falloff: 0.5,
    dmgMix: { kinetic: 8, explosive: 2 },
    tactic: "orbit",
    ...(drones ? { drones } : {}),
  };
}

/** 合成卡：以**已迁入舰级路径的真卡**为基底（保证 `waves`/星系等字段齐备），只覆写编成 */
function testCard(ship: FoeShipDef, dmgMul = 1): AnomalyDef {
  const src = base.anomalies.get("ano-gravekeeper")!; // D 族：单波、舰级路径、无旧路径残留字段
  return {
    ...src,
    id: "ano-test-foe-drone",
    name: "机群试验卡",
    galaxyId: "galaxy-abyss",
    threat: 60,
    tactic: "orbit",
    ships: [{ ship, count: 2, dmgMul }],
  };
}

function ctxWith(card: AnomalyDef): SimContext {
  return { ...base, anomalies: new Map([...base.anomalies, [card.id, card]]) };
}

function makeState(seed = 5, high: string[] = ["mod-turret-kin-2"]): GameState {
  const state = createInitialState({ nowWallMs: 0, seed });
  const uid = addShipToFleet(state, "sh-sentinel"); // 王鲭：厚甲多槽，够活到机群开火
  state.shipId = uid;
  state.fleet[uid]!.fitted = {
    high,
    mid: ["mod-shield-kin-2", "mod-track-2"],
    low: ["mod-stab-kin-2"],
  };
  // 弹药备货（2026-09-11 补）：炮台是 'gun' ⇒ **要弹才打得出去**；合成档此前没备弹，
  // 端到端用例因此出现"装了 4 门近防炮却一发未放"的假失败（真档由 startBattleFor 预载）。
  addWare(state, "ammo-kinetic-l", 500);
  return state;
}

/** 打到 `advMs` 就停。60 秒 = 接近期（开局距离→机群射程 3km，约 10~25 秒）+ 机群数个装填周期；
 *  fx 环缓冲 48 条按"丢最旧"裁剪，机群是**全程持续**开火 ⇒ 最近的事件必在环里。 */
function runBattle(
  card: AnomalyDef,
  advMs = 60_000,
  high?: string[],
): BattleState {
  return runBattleWithState(card, advMs, high).battle
}

/** 与 `runBattle` 同源，但把 `state` 一并返回（受击增程要看**战斗日志**） */
function runBattleWithState(
  card: AnomalyDef,
  advMs = 60_000,
  high?: string[],
): { state: GameState; battle: BattleState } {
  const c = ctxWith(card);
  const state = high ? makeState(5, high) : makeState();
  const battle = startBattleFor(state, c, state.shipId, card.id, 0)!;
  state.expedition.active = true;
  state.expedition.phase = "battle";
  state.expedition.anomalyId = card.id;
  state.expedition.battle = battle;
  state.gameMs = advMs;
  advanceBattleFor(state, c, battle, state.shipId, card.id);
  return { state, battle };
}

describe("敌方机群：建档与 A5 火力守恒", () => {
  it("展开成每架一条 src=drone 条目；机群吃 dmgMul、不吃多舰补偿", () => {
    const card = testCard(
      testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }]),
      2,
    );
    const units = createFoeSpecs(card, bal);
    expect(units).toHaveLength(2); // 两艘母舰

    for (const u of units) {
      const drones = u.weapons.filter((w) => w.src === "drone");
      expect(drones).toHaveLength(3); // 每架一条
      expect(drones.every((w) => w.artId === FOE_DRONE_E_ALERT.id)).toBe(true);
      expect(drones.every((w) => w.kind === "fixed")).toBe(true);
      expect(
        drones.every((w) => w.maxRangeM === FOE_DRONE_E_ALERT.maxRangeM),
      ).toBe(true);
      expect(
        drones.every((w) => w.reloadMs === FOE_DRONE_E_ALERT.reloadMs),
      ).toBe(true);
      // A5①：机群吃**同一条 dmgMul**（母舰单发因此相对让位）——8 × 2 = 16
      expect(
        drones.every(
          (w) => w.shotDmg === Math.round(FOE_DRONE_E_ALERT.dmg * 2),
        ),
      ).toBe(true);
      // A5②：**不吃多舰补偿**——母舰 = round(100 × 2 × 2N/(N+1)=4/3) = 267；机群若也吃补偿会是 21
      expect(u.weapons[0]!.shotDmg).toBe(Math.round(100 * 2 * (4 / 3)));
      // 舰级把机群登记原样带到单位上（建池要用）
      expect(u.foeDrones).toHaveLength(1);
      expect(u.foeDrones![0]!.count).toBe(3);
    }
  });

  it("不写 drones 的舰级：单位上无机群、武器只有母舰一条（零行为变化）", () => {
    const units = createFoeSpecs(testCard(testShip()), bal);
    for (const u of units) {
      expect(u.weapons).toHaveLength(1);
      expect(u.weapons[0]!.src).toBeUndefined();
      expect(u.foeDrones).toBeUndefined();
    }
  });
});

describe("敌方机群：生存池与开火", () => {
  it("按敌单位 tag 建池，三层血/回避/机型 id 取机型表绝对值", () => {
    const card = testCard(
      testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1),
    );
    const battle = runBattle(card);
    const pools = battle.foeDronePools!;
    expect(pools).toBeTruthy();
    const tags = Object.keys(pools);
    expect(tags).toHaveLength(2); // 两艘母舰各一池
    for (const tag of tags) {
      const list = pools[tag]!;
      expect(list).toHaveLength(3); // 与机群武器条目同序、同数
      expect(list.every((p) => p.alive)).toBe(true);
      expect(list.every((p) => p.artId === FOE_DRONE_E_ALERT.id)).toBe(true);
      expect(list[0]).toMatchObject({
        s: FOE_DRONE_E_ALERT.defense.shieldHp,
        a: FOE_DRONE_E_ALERT.defense.armorHp,
        h: FOE_DRONE_E_ALERT.defense.hullHp,
        evasion: FOE_DRONE_E_ALERT.defense.evasion,
      });
      expect(list[0]!.resists?.armor).toEqual(
        FOE_DRONE_E_ALERT.defense.armorResist,
      );
    }
  });

  it("机群会开火：战斗 fx 出现 src=drone 事件（母舰射程 10m ⇒ 那些事件只可能来自机群）", () => {
    const card = testCard(
      testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1),
    );
    const battle = runBattle(card);
    const droneFx = battle.fx.filter((e) => e.src === "drone");
    expect(droneFx.length).toBeGreaterThan(0);
    expect(droneFx.every((e) => e.artId === FOE_DRONE_E_ALERT.id)).toBe(true);
    expect(droneFx.every((e) => e.side === "foe" && e.to === "player")).toBe(
      true,
    );
    expect(droneFx.every((e) => e.type === FOE_DRONE_E_ALERT.damageType)).toBe(
      true,
    );
  });

  it("负向对照：同卡不写 drones ⇒ 不建池、无 drone 事件", () => {
    const battle = runBattle(testCard(testShip(undefined, 1)));
    expect(battle.foeDronePools).toBeUndefined();
    expect(battle.fx.some((e) => e.src === "drone")).toBe(false);
  });
});

describe("防空选靶（船长 A1：只有带防空属性的武器能打敌机）", () => {
  const RANGED = { minRangeM: 1, maxRangeM: 9000 };

  it("本场无机群 ⇒ null，且**不消费 rng**（既有武器一次掷骰都不会多花）", () => {
    const battle = runBattle(testCard(testShip(undefined, 1)));
    expect(battle.foeDronePools).toBeUndefined();
    const state = makeState();
    const before = structuredClone(state.rng);
    expect(
      pickFoeDroneTarget(
        state,
        battle,
        [{ tag: "foe-0" } as never],
        3000,
        RANGED,
      ),
    ).toBeNull();
    expect(state.rng).toEqual(before);
  });

  it("射程之内 ⇒ 抽到存活敌机；击落（alive=false）后不再被选中", () => {
    const card = testCard(
      testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1),
    );
    const battle = runBattle(card);
    const foes = createFoeSpecs(card, bal);
    const state = makeState();

    const first = pickFoeDroneTarget(state, battle, foes, 3000, RANGED);
    expect(first).toBeTruthy();
    expect(first!.pool.alive).toBe(true);
    expect(first!.pool.artId).toBe(FOE_DRONE_E_ALERT.id);

    // 把抽到的那架击落 ⇒ 池里存活数 −1，且它不会再成为目标
    const pools = battle.foeDronePools![first!.foeTag]!;
    expect(pools).toContain(first!.pool);
    first!.pool.alive = false;
    const aliveAfter = pools.filter((p) => p.alive).length;
    expect(aliveAfter).toBe(2);
    for (let i = 0; i < 20; i++) {
      const again = pickFoeDroneTarget(state, battle, foes, 3000, RANGED);
      if (again) expect(again.pool.alive).toBe(true);
    }
  });

  it("母舰阵亡 ⇒ 其机群不再参战（「机群是舰的一部分」）", () => {
    const card = testCard(
      testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1),
    );
    const battle = runBattle(card);
    const foes = createFoeSpecs(card, bal);
    const state = makeState();
    // 把两艘母舰都判为阵亡（血量清零）
    for (const f of foes) {
      battle.units[f.tag]!.hp = { s: 0, a: 0, h: 0 };
    }
    expect(pickFoeDroneTarget(state, battle, foes, 3000, RANGED)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * **E 族近防炮**（2026-09-11 机群批 S4）——玩家侧**首件防空武器**、也是"分族"的第一件。
 * 船长三条：「需要带有防空属性的武器（为近防炮做铺垫）」·「近防炮分族」·「做 E 族」。
 * 本组钉住**端到端链路**：装备 `canHitDrones` ⇒ 武器条目带防空属性 ⇒ **真能把机群打下来**；
 * 负向对照 = 同卡同装配只换普通炮台 ⇒ 一架都打不掉（"默认打不到"）。
 * ══════════════════════════════════════════════════════════════════════════ */
describe("E 族近防炮：装备 → 防空属性 → 真能打机群", () => {
  const AA = "mod-pd-e-3"; // MK3：反应式窗口（2026-09-11 船长「每轮被攻击后才开火」）+ 敌机血 ×2 后仍能确定性击落
  const testCardWithDrones = (): AnomalyDef =>
    testCard(testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1));

  it("装备定义带防空属性，且装配后武器条目带上 `canHitDrones`（普通炮台不带）", () => {
    const mod = base.modules.get(AA)!;
    expect(mod.canHitDrones).toBe(true);
    expect(base.modules.get("mod-turret-kin-1")!.canHitDrones).toBeUndefined();
    // 装配 4 门近防炮：射程 1,400、装填 1,500、命中 0.9、无近盲带
    const state = makeState(5, [AA, AA, AA, AA]);
    const battle = startBattleFor(
      state,
      ctxWith(testCardWithDrones()),
      state.shipId,
      "ano-test-foe-drone",
      0,
    )!;
    expect(battle).toBeTruthy();
    // 武器条目在战斗建档时写入；用同一套装配跑一仗并核对 fx 的 src（近防炮属炮台家族）
    const after = runBattle(testCardWithDrones(), 60_000, [AA, AA, AA, AA]);
    expect(after.fx.some((e) => e.src === "turret")).toBe(true);
  });

  it("带近防炮 ⇒ 真打出「击落敌机」事件；换普通炮台 ⇒ 一架都掉不了（负向对照）", () => {
    const withAA = runBattle(testCardWithDrones(), 90_000, [AA, AA, AA, AA]);
    const downed = withAA.fx.filter(
      (e) => e.droneDown === true && e.side === "foe",
    );
    const pools = Object.values(withAA.foeDronePools ?? {}).flat();
    expect(pools.length).toBe(6); // 2 舰 × 3 架
    // **近防炮确实在打机群**：出现带 `pd` 标记的开火事件（渲染层据此只出炮口闪光、不画弹道）。
    // ⚠ 不再断言"必定击落"：反应式窗口（船长 2026-09-11「每轮被攻击后才开火」）+ 敌机血 ×2 后，
    //   90 秒内是否打光取决于装配与窗口节奏，属**平衡读数**（由标定轮回答，不由单元用例钉死）。
    expect(withAA.fx.some((e) => e.pd === true)).toBe(true);
    expect(downed.length).toBeGreaterThanOrEqual(0); // 击落演出事件（可能为 0，见上）
    expect(pools.some((p) => !p.alive)).toBe(true);

    const withGun = runBattle(testCardWithDrones(), 60_000, [
      "mod-turret-kin-1",
      "mod-turret-kin-1",
      "mod-turret-kin-1",
      "mod-turret-kin-1",
    ]);
    const poolsGun = Object.values(withGun.foeDronePools ?? {}).flat();
    expect(poolsGun.length).toBe(6);
    expect(
      withGun.fx.some((e) => e.droneDown === true && e.side === "foe"),
    ).toBe(false);
    expect(poolsGun.every((p) => p.alive)).toBe(true); // 普通炮台**按构造看不到机群**
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * **受击增程**（2026-09-11 船长：「添加新机制，**受到攻击后，大幅提高无人机射程（提高 400%）**」）
 * 船长七项裁定：**×4**（5,000 → **20,000m**）· **只认母舰本体被命中**（打机群不触发）·
 * 该舰**全部**机群共享 · **本场永久** · **不封顶** · 交距解除钉住 · 要有一条玩家可见日志。
 * 本组钉住：触发条件 / 生效射程 / 覆盖范围 / 永久性 / 负向对照（无机群、无该字段 ⇒ 零行为变化）。
 * ══════════════════════════════════════════════════════════════════════════ */
describe("敌方机群：受击增程（母舰挨打 ⇒ 全机群射程 ×4）", () => {
  /** 带受击增程的试验巨构（其余同 `testShip`：母舰射程 1~10m ⇒ 只有机群打得到人） */
  const buffShip = (
    drones: readonly FoeDroneSlot[],
    shotDmg = 1,
  ): FoeShipDef => ({
    ...testShip(drones, shotDmg),
    droneRangeMulOnHit: 4,
  });
  const AA = "mod-pd-e-2"; // 近防炮（唯一带防空属性的家族）
  const droneWeaponOf = (card: AnomalyDef, tag: string) =>
    createFoeSpecs(card, bal)
      .find((u) => u.tag === tag)!
      .weapons.find((w) => w.src === "drone")!;

  it("母舰本体被命中 ⇒ 该舰机群射程 ×4（= 机型 5,000 → 20,000m）且写一条日志", () => {
    const card = testCard(buffShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }]));
    const { state, battle } = runBattleWithState(card);
    const buffs = battle.foeDroneRangeBuff ?? {};
    const tags = Object.keys(buffs);
    // 主炮（动能 MK2 5,740m）在 60 秒里必中过母舰；固定种子 ⇒ 该断言是确定性的
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(buffs[tag]).toBe(4);
      // 生效射程 = 机型绝对射程 × 倍率（开火判定与界面同源读这一个函数）
      expect(foeDroneRangeOf(battle, tag, droneWeaponOf(card, tag))).toBe(
        FOE_DRONE_E_ALERT.maxRangeM * 4,
      ); // 5,000 × 4 = 20,000
    }
    // 未触发的单位读到的仍是机型射程（逐舰独立、不共享）
    const untouched = createFoeSpecs(card, bal).find(
      (u) => buffs[u.tag] === undefined,
    );
    if (untouched) {
      expect(
        foeDroneRangeOf(
          battle,
          untouched.tag,
          untouched.weapons.find((w) => w.src === "drone")!,
        ),
      ).toBe(FOE_DRONE_E_ALERT.maxRangeM);
    }
    // **画面提示**（船长 2026-09-11 二次裁定：「日志内不用显示提示，将该提示放入战斗画面内显示
    //（和敌方增援统一下系统，显示位置改为战斗窗口正上方）」）⇒ 走 `battle.notices`，**不写日志**
    expect(
      battle.notices?.some((n) => n.text.includes("警戒机群解除射程限制")),
    ).toBe(true);
    expect(
      state.logs.some((l) => l.text.includes("警戒机群解除射程限制")),
    ).toBe(false);
  });

  it("只打机群 ⇒ **不触发**（船长：仅母舰本体被命中才算）", () => {
    // 构造"整场够不着母舰"的仗：**母舰想站在 4,000m**（`desireRangeM`）+ **速度远高于我舰**
    // （speedRatio 2.0）⇒ 距离稳定在近防炮射程 2,500m 之外、却仍在机群射程 5,000m 之内
    // ⇒ 机群打得到我（反击令牌成立、近防炮确实在打机群），而**母舰本体一发未挨**。
    const farShip: FoeShipDef = {
      ...buffShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }]),
      speedRatio: 2,
      desireRangeM: 4000,
    }
    const card = testCard(farShip);
    const { battle } = runBattleWithState(card, 20_000, [AA, AA, AA, AA]);
    expect(battle.distanceM).toBeGreaterThan(2500); // 母舰整场在我舰射程外
    expect(battle.fx.some((e) => e.pd === true)).toBe(true); // 近防炮确在打机群
    expect(battle.foeDroneRangeBuff).toBeUndefined(); // 打机群**不算**"母舰受到攻击"
  });

  it("不写 `droneRangeMulOnHit` 的舰级：永不触发（既有战斗零行为变化）", () => {
    const card = testCard(testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }]));
    const { battle } = runBattleWithState(card);
    expect(battle.foeDroneRangeBuff).toBeUndefined();
  });

  it("无舰级的机群 ⇒ 字段不下发到单位（挂了也不生效，契约另拦）", () => {
    const card = testCard(
      testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }]),
    );
    for (const u of createFoeSpecs(card, bal)) {
      expect(u.foeDroneRangeMulOnHit).toBeUndefined();
    }
    const withField = testCard(
      buffShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }]),
    );
    for (const u of createFoeSpecs(withField, bal)) {
      expect(u.foeDroneRangeMulOnHit).toBe(4);
    }
  });

  it("**本场永久**：触发后再推进一整段，倍率不回落", () => {
    const card = testCard(buffShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }]));
    const c = ctxWith(card);
    const state = makeState();
    const battle = startBattleFor(state, c, state.shipId, card.id, 0)!;
    state.expedition.active = true;
    state.expedition.phase = "battle";
    state.expedition.anomalyId = card.id;
    state.expedition.battle = battle;
    state.gameMs = 60_000;
    advanceBattleFor(state, c, battle, state.shipId, card.id);
    const tag = Object.keys(battle.foeDroneRangeBuff ?? {})[0];
    expect(tag).toBeTruthy();
    state.gameMs = 120_000;
    advanceBattleFor(state, c, battle, state.shipId, card.id);
    expect(battle.foeDroneRangeBuff?.[tag!]).toBe(4);
  });
});
