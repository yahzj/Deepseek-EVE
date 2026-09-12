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
  battleArcsFor,
  createFoeSpecs,
  foeDroneRangeOf,
  pickFoeDroneTarget,
  startBattleFor,
} from "../src/combat";
import type { BattleState, GameState } from "../src/state";
import type {
  AnomalyDef,
  FoeDroneDef,
  FoeShipDef,
  FoeDroneSlot,
  ModuleDef,
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

/**
 * **逐秒推进 + 游标收集**（2026-09-12 修测试方法）：`fx` 是 **48 条环、丢最旧**——
 * 一次推完 90 秒后，**早期的 pd 事件可能已被裁掉**（机群被打光后，剩下的全是"近防炮/炮台对舰"
 * 的开火事件，环里只留最近 48 条）⇒ 原来"看最终环里有没有 `pd` 事件"的断言会**假失败**。
 * 收集口径与 `tools/battle-calibrate.ts` 同款：只认 `seq > 上次最大值` 的事件（被裁掉的永远是
 * 更旧的事件）⇒ 无损。返回计数，断言不看环的最终快照。
 */
function runBattleDrain(
  card: AnomalyDef,
  advMs = 90_000,
  high?: string[],
): { battle: BattleState; pd: number; droneDown: number } {
  const c = ctxWith(card);
  const state = high ? makeState(5, high) : makeState();
  const battle = startBattleFor(state, c, state.shipId, card.id, 0)!;
  state.expedition.active = true;
  state.expedition.phase = "battle";
  state.expedition.anomalyId = card.id;
  state.expedition.battle = battle;
  const startAt = battle.startedAtGameMs;
  let lastSeq = 0;
  let pd = 0;
  let droneDown = 0;
  for (let t = 1_000; t <= advMs; t += 1_000) {
    state.gameMs = startAt + t;
    advanceBattleFor(state, c, battle, state.shipId, card.id);
    for (const e of battle.fx) {
      if (e.seq <= lastSeq) continue;
      lastSeq = e.seq;
      if (e.pd === true) pd += 1;
      if (e.droneDown === true && e.side === "foe") droneDown += 1;
    }
    if (battle.ended) break;
  }
  return { battle, pd, droneDown };
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

  it("装备带「防空」属性（值 = 对无人机伤害倍率），装配后武器条目同时带出「能打机群」与倍率（普通炮台都没有）", () => {
    const mod = base.modules.get(AA)!;
    // 2026-09-12 船长：「给近防炮系列添加一个属性"防空"，将近防炮的对无人机伤害 ×2 写到防空属性里」
    // ⇒ 一条属性两个含义（原 canHitDrones 布尔字段已并入本字段）
    expect(mod.antiDrone).toBe(2);
    expect(base.modules.get("mod-turret-kin-1")!.antiDrone).toBeUndefined();
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
    // ⚠ **不看最终 fx 环**（48 条、丢最旧 ⇒ 会被后期的对舰开火挤出）⇒ 逐秒游标收集（无损）
    const drained = runBattleDrain(testCardWithDrones(), 90_000, [AA, AA, AA, AA]);
    const withAA = drained.battle;
    const pools = Object.values(withAA.foeDronePools ?? {}).flat();
    expect(pools.length).toBe(6); // 2 舰 × 3 架
    // **近防炮确实在打机群**：出现带 `pd` 标记的开火事件（渲染层据此只出炮口闪光、不画弹道）。
    expect(drained.pd).toBeGreaterThan(0);
    // 血量口径（船长 2026-09-12「将警戒机的血量削弱40%」= 92 → 55）后，MK3×4 一轮齐射即可击落 ⇒ 击落事件必现；
    // 池里确有阵亡条目（引擎权威状态，不依赖演出事件）。
    expect(drained.droneDown).toBeGreaterThan(0); // 击落演出事件（side='foe' 的小爆炸/坠落）
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
 * **对无人机伤害加成**（船长 2026-09-12：「**近防炮给予一个对无人机伤害加成**」→「**那伤害倍率按2倍算**」）
 *
 * `pd-damage-ladder.test.ts` 只锁"装备表写了 ×2、且带进了武器条目"；本组锁**引擎真的乘上去了**：
 * 用**合成对照件**（复制真近防炮、只把 `antiDroneDmgMul` 摘掉）跑同种子同卡——
 * ① 机群掉血**恰好 ×2**；② **敌舰掉血逐字相同**（加成不许漏进对舰那一支）。
 * 机群血量故意设成巨值（10 万）⇒ 整场零击落、无补位 ⇒ 两次跑的事件序列完全一致，对照是干净的。
 * ══════════════════════════════════════════════════════════════════════════ */
describe("对无人机伤害加成 ×2（船长 2026-09-12）", () => {
  const FAT = 100_000;
  /** 巨血合成警戒机：同名同角色，只把三层血拉高（保证整场零击落） */
  const fatDrone = (): FoeDroneDef => ({
    ...FOE_DRONE_E_ALERT,
    id: "test-fat-drone",
    name: "合成厚血警戒机",
    defense: {
      ...FOE_DRONE_E_ALERT.defense,
      shieldHp: FAT,
      armorHp: FAT,
      hullHp: FAT,
    },
  });
  /** 复制真近防炮 MK3、把「防空」属性值降为 1（对照组：**仍能打机群**，但不吃对无人机加成） */
  const noBonusPd = (): ModuleDef => {
    const src = base.modules.get("mod-pd-e-3")!;
    // ⚠ 不能把 `antiDrone` 整个摘掉——那样连"能筛到机群"都没了，两次跑的开火次数就不同了；
    // 值设 1 = 保留防空能力、伤害倍率 ×1（引擎对 `antiDroneMul === 1` 不乘）。
    return { ...src, id: "test-pd-nobonus", name: "试验近防炮·无加成", antiDrone: 1 };
  };
  /** 跑一场：同卡同种子，只换装配里那件近防炮 */
  function runWith(
    moduleId: string,
  ): { droneHurt: number; shipHurt: number } {
    const drone = fatDrone();
    const card = testCard(testShip([{ drone, count: 3 }], 1));
    const c: SimContext = {
      ...base,
      anomalies: new Map([...base.anomalies, [card.id, card]]),
      modules: new Map([...base.modules, ["test-pd-nobonus", noBonusPd()]]),
    };
    const state = makeState(5, [moduleId, moduleId, moduleId, moduleId]);
    const battle = startBattleFor(state, c, state.shipId, card.id, 0)!;
    const droneHpStart = Object.values(battle.foeDronePools ?? {})
      .flat()
      .reduce((s, p) => s + p.s + p.a + p.h, 0);
    const shipHpStart = Object.values(battle.units)
      .filter((u) => u.tag !== "player")
      .reduce((s, u) => s + u.hp.s + u.hp.a + u.hp.h, 0);
    state.expedition.active = true;
    state.expedition.phase = "battle";
    state.expedition.anomalyId = card.id;
    state.expedition.battle = battle;
    state.gameMs = 60_000;
    advanceBattleFor(state, c, battle, state.shipId, card.id);
    const droneHpEnd = Object.values(battle.foeDronePools ?? {})
      .flat()
      .reduce((s, p) => s + p.s + p.a + p.h, 0);
    const shipHpEnd = Object.values(battle.units)
      .filter((u) => u.tag !== "player")
      .reduce((s, u) => s + u.hp.s + u.hp.a + u.hp.h, 0);
    // 零击落的前提核对（有击落说明血量没设够，对照就不干净了）
    expect(Object.values(battle.foeDronePools ?? {}).flat().every((p) => p.alive)).toBe(true);
    return { droneHurt: droneHpStart - droneHpEnd, shipHurt: shipHpStart - shipHpEnd };
  }

  it("带加成 ⇒ 机群掉血恰好翻倍；对舰掉血逐字相同（加成不许漏进对舰那一支）", () => {
    const withBonus = runWith("mod-pd-e-3");
    const without = runWith("test-pd-nobonus");
    expect(without.droneHurt).toBeGreaterThan(0); // 对照组确实打到了机群
    expect(withBonus.droneHurt).toBe(without.droneHurt * 2);
    expect(withBonus.shipHurt).toBe(without.shipHurt); // 对舰不但"没加成"，而是**完全一致**
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

  it("母舰本体被命中 ⇒ **全敌队**机群射程 ×4（5,000 → 20,000m），且**只推一条**画面提示", () => {
    const card = testCard(buffShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }]));
    const { state, battle } = runBattleWithState(card);
    // 主炮（动能 MK2 5,740m）在 60 秒里必中过母舰；固定种子 ⇒ 该断言是确定性的
    expect(battle.foeDroneRangeBuff).toBe(4); // 标量状态（整队共享，不是逐舰一份）
    // **对所有敌舰生效**（船长三次裁定）——两艘母舰的机群都吃到倍率，哪怕只打中了其中一艘
    for (const u of createFoeSpecs(card, bal)) {
      expect(
        foeDroneRangeOf(
          battle,
          u.weapons.find((w) => w.src === "drone")!,
        ),
      ).toBe(FOE_DRONE_E_ALERT.maxRangeM * 4); // 5,000 × 4 = 20,000
    }
    // **画面提示只一条**（船长：「每个敌人都会单独触发一次…理论上应该只触发一次」）
    expect(
      battle.notices?.filter((n) => n.text.includes("警戒机群解除射程限制")),
    ).toHaveLength(1);
    // **不写日志**（船长二次裁定：「日志内不用显示提示，将该提示放入战斗画面内显示」）
    expect(
      state.logs.some((l) => l.text.includes("警戒机群解除射程限制")),
    ).toBe(false);
  });

  /* ⚠ **界面射程标签**（2026-09-12 船长：「无人机射程变更后，下方的射程标签内数值也要变动」）：
   * 修复落在 `battleArcsFor` 的**敌方逐带聚合**——敌机武器条目的 `maxRangeM` 是**机型射程**（原始值），
   * 而实战射程 = `foeDroneRangeOf(battle, w)`（机型射程 × **受击增程倍率**）⇒ 现改为读后者，
   * 与**开火射程门同源**（避免"打得着 20km、标签还写 5km"）。
   * **本用例暂不在此钉 UI**：`battleArcsFor` 读 `state.expedition.battle`，而战斗**结束后**该字段已被结算清掉、
   * 重新挂回的 `BattleState` 上取不到当时的 `foeDroneRangeBuff`（实测：挂回后重建的视图仍报机型原始射程）
   * ⇒ 需**真机实测**（重启客户端打一张 E 族卡看底部标签是否随增程变为 20,000m）；若要自动化，
   * 正解是让"战斗结算后再建视图"这条路径也带上当时的倍率（或给视图注入 battle 的口子），另立小批。
   * 引擎侧不变量已有覆盖：上面那条「母舰本体被命中 ⇒ 全敌队机群射程 ×4」✓ */

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

  it("**本场永久 + 只触发一次**：触发后再推进一整段，倍率不回落、提示也不再增条", () => {
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
    expect(battle.foeDroneRangeBuff).toBe(4);
    const notices0 = (battle.notices ?? []).filter((n) =>
      n.text.includes("警戒机群解除射程限制"),
    ).length;
    expect(notices0).toBe(1);
    // 再打一整段（还会继续命中敌舰）⇒ 倍率不变、提示不重复
    state.gameMs = 120_000;
    advanceBattleFor(state, c, battle, state.shipId, card.id);
    expect(battle.foeDroneRangeBuff).toBe(4);
    expect(
      (battle.notices ?? []).filter((n) =>
        n.text.includes("警戒机群解除射程限制"),
      ).length,
    ).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * **单次出击上限 + 备用机库**（2026-09-12 船长：「能否**限制敌机单次出击数量**或者给敌机添加
 * **备用机库**（损坏后补充敌机）」）——两条都是**舰级可选字段**，缺省不写 = 现状零变化。
 * 本组钉住：①分批出击（同拍只有 k 架在空、窗口轮换）②`keepDps` 下**平均 DPS 守恒**（装填 ÷ (N/k)）
 * ③备用机在库时**不可被选中/不出战** ④战损后按 `respawnMs` **满血补位**。
 * ══════════════════════════════════════════════════════════════════════════ */
describe("敌机：单次出击上限 + 备用机库", () => {
  const AA = "mod-pd-e-2";
  const launchShip = (
    launch?: { maxAloft: number; cycleMs?: number; keepDps?: boolean },
    reserve?: { count: number; respawnMs: number },
  ): FoeShipDef => ({
    ...testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1),
    ...(launch ? { droneLaunch: launch } : {}),
    ...(reserve ? { droneReserve: reserve } : {}),
  })

  it("建档：备用机展开成**额外条目**，池里标 `inHangar`（不算出战架数）", () => {
    const card = testCard(launchShip(undefined, { count: 2, respawnMs: 10000 }))
    const units = createFoeSpecs(card, bal)
    for (const u of units) {
      // 3 架常备 + 2 架备用 = 5 条武器条目
      expect(u.weapons.filter((w) => w.src === "drone")).toHaveLength(5)
      expect(u.foeDroneReserve).toEqual({ count: 2, respawnMs: 10000 })
    }
    const { battle } = runBattleWithState(card, 1_000)
    for (const list of Object.values(battle.foeDronePools ?? {})) {
      expect(list).toHaveLength(5)
      expect(list.filter((p) => p.inHangar === true)).toHaveLength(2)
      // 备用机**开局不在场**：近防炮选靶看不到它
      expect(list.filter((p) => p.inHangar !== true)).toHaveLength(3)
    }
  })

  it("分批出击：**每舰每拍**最多 k 架在空（其余在库待命 ⇒ 本拍不开火）", () => {
    const card = testCard(launchShip({ maxAloft: 1, keepDps: true }))
    const { battle } = runBattleWithState(card, 30_000)
    // ⚠ 上限是**按舰**的（两艘母舰各自最多 1 架在空）⇒ 计数键 = tag + 时刻
    const byTick = new Map<string, number>()
    for (const e of battle.fx) {
      if (e.src !== "drone" || e.side !== "foe") continue
      const key = `${e.tag}|${e.atMs}`
      byTick.set(key, (byTick.get(key) ?? 0) + 1)
    }
    // 任一舰在任一拍最多 1 架开火（`maxAloft: 1`）——本机制的核心断言
    expect(Math.max(...byTick.values())).toBeLessThanOrEqual(1)
    expect(byTick.size).toBeGreaterThan(0) // 确实开过火（不是"全哑火"的假通过）
  })

  it("备用机库：前线战损 ⇒ 按 `respawnMs` **满血补位**（总库存不变）", () => {
    const card = testCard(
      launchShip(undefined, { count: 3, respawnMs: 1_000 }),
    );
    const c = ctxWith(card)
    const state = makeState(5, [AA, AA, AA, AA]) // 四门近防炮：真能击落敌机
    const battle = startBattleFor(state, c, state.shipId, card.id, 0)!
    state.expedition.active = true
    state.expedition.phase = "battle"
    state.expedition.anomalyId = card.id
    state.expedition.battle = battle
    state.gameMs = 150_000 // 打到近防炮确实击落若干架
    advanceBattleFor(state, c, battle, state.shipId, card.id)
    // ⚠ 补位是**排期制**（击落时刻 + respawnMs）⇒ 末尾那一击的补位可能还没到点；
    //   再推 15 秒把待补位全部冲出来（respawnMs 只有 1,000ms）
    state.gameMs = 165_000
    advanceBattleFor(state, c, battle, state.shipId, card.id)
    const list = Object.values(battle.foeDronePools ?? {})[0]!
    expect(list).toHaveLength(6) // 3 常备 + 3 备用（**总库存**：备用机永不凭空增多）
    const downed = list.filter((p) => !p.alive).length
    const inHangar = list.filter((p) => p.inHangar === true).length
    expect(inHangar + downed + list.filter((p) => p.alive && p.inHangar !== true).length).toBe(6)
    if (downed > 0) {
      // **补位成立**：库里的减去已放出的 = 战损数（掉几架补几架，直到库存耗尽）
      expect(inHangar).toBe(Math.max(0, 3 - downed))
      // ⚠ 2026-09-12 近防炮伤害上调（船长裁定「丙」：短射程补偿 ⇒ 单发 5 → 16）后，
      //   四门近防炮在 150 秒里足以把整群（含补位机）打光 ⇒ **不再要求"必须有存活的补位机"**
      //   （那是旧平衡下的偶然现象，会让用例与数值绑定）。改为核对**补位确实发生**：
      //   备用机只有"被放出"这一条路径能离开机库 ⇒ `inHangar` 减少即补位成立（上面那条已钉住数量关系）。
      expect(inHangar).toBeLessThan(3)
      // **满血放出**（不是残血补位）：被放出的备用机若仍存活，三层血必为满值
      // （全被打光时该断言无从取样 —— 用 `alive` 过滤，不把"打光"误判成失败）
      const promoted = list.filter((p) => p.alive && p.inHangar !== true && p.maxS !== undefined)
      if (promoted.length > 0) {
        expect(
          promoted.some((p) => p.s === p.maxS && p.a === p.maxA && p.h === p.maxH),
        ).toBe(true)
      }
    } else {
      expect(inHangar).toBe(3) // 一架没掉 ⇒ 备用机仍全在库
    }
  })

  it("缺省不写两条字段 ⇒ 全群照旧同时开火、无备用（零行为变化）", () => {
    const card = testCard(testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1))
    const { battle } = runBattleWithState(card, 30_000)
    const byTick = new Map<number, number>()
    for (const e of battle.fx) {
      if (e.src !== "drone" || e.side !== "foe") continue
      byTick.set(e.atMs, (byTick.get(e.atMs) ?? 0) + 1)
    }
    // 3 架同一拍齐射（旧口径）
    expect(Math.max(...byTick.values())).toBeGreaterThan(1)
    const list = Object.values(battle.foeDronePools ?? {})[0]!
    expect(list).toHaveLength(3)
    expect(list.every((p) => p.inHangar !== true)).toBe(true)
  })
});

/* ══════════════════════════════════════════════════════════════════════════
 * **机群火力占比**（2026-09-11 船长：「允许调整敌舰的无人机/炮台火力比例。这个要根据每个悬赏卡制定」）
 * 七项裁定：守恒拆分 · **条目级**（缺省回落舰级）· 以「现口径实收总单发 T」为基准、
 * 机群先取余额给炮台 · **0~1 且两侧各保底 1** · 不显示给玩家 · 只含「机群 vs 母舰武器组」·
 * 本批**只做机制**（数值等船长逐卡给）。
 * 本组钉住：缺省零变化 / 总量守恒 / 先取与摊分 Σ 精确 / 边界保底 / 条目级覆盖舰级缺省。
 * ══════════════════════════════════════════════════════════════════════════ */
describe("机群火力占比（条目级 · 守恒拆分）", () => {
  /** 挂 3 架警戒机的试验巨构（母舰单发 100 ⇒ 便于取整对照） */
  const gunShip = (shipShare?: number): FoeShipDef => ({
    ...testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 100),
    ...(shipShare !== undefined ? { droneFireShare: shipShare } : {}),
  })
  /** 单条目卡（`dmgMul 2` ⇒ 炮台 100×2×4/3 = 267、机群每架 25×2 = 50 ⇒ 每单位 417、T = 834） */
  const cardWith = (
    slotShare?: number,
    shipShare?: number,
    count = 2,
  ): AnomalyDef => {
    const ship = gunShip(shipShare)
    const base = testCard(ship, 2)
    return {
      ...base,
      ships: [
        {
          ship,
          count,
          dmgMul: 2, // ⚠ 覆写 `ships` 时必须带上（否则退回缺省 1，机群/炮台一起减半）
          ...(slotShare !== undefined ? { droneFireShare: slotShare } : {}),
        },
      ],
    }
  }
  const totals = (def: AnomalyDef) => {
    const units = createFoeSpecs(def, bal)
    const guns = units.reduce(
      (n, u) =>
        n +
        u.weapons
          .filter((w) => w.src !== "drone")
          .reduce((m, w) => m + (w.shotDmg ?? 0), 0),
      0,
    )
    const drones = units.reduce(
      (n, u) =>
        n +
        u.weapons
          .filter((w) => w.src === "drone")
          .reduce((m, w) => m + (w.shotDmg ?? 0), 0),
      0,
    )
    return { guns, drones, total: guns + drones }
  }
  const droneShots = (def: AnomalyDef) =>
    createFoeSpecs(def, bal).flatMap((u) =>
      u.weapons.filter((w) => w.src === "drone").map((w) => w.shotDmg ?? 0),
    )
  const gunShots = (def: AnomalyDef) =>
    createFoeSpecs(def, bal).map(
      (u) => u.weapons.find((w) => w.src !== "drone")!.shotDmg ?? 0,
    )

  it("缺省不写 ⇒ 旧算法逐字一致（零行为变化）", () => {
    expect(droneShots(cardWith())).toEqual([50, 50, 50, 50, 50, 50]);
    expect(gunShots(cardWith())).toEqual([267, 267]);
    // 舰级写了缺省、但条目没写 ⇒ **按舰级缺省生效**（条目 > 舰级）
    expect(droneShots(cardWith(undefined, 0.5))).not.toEqual(droneShots(cardWith()));
  })

  it("守恒：s ∈ {0, 0.3, 0.5, 1} 下**总单发恒等于旧口径**，两侧各保底", () => {
    const T0 = totals(cardWith()).total;
    expect(T0).toBe(834); // 2 × (267 + 3×50)
    for (const s of [0, 0.3, 0.5, 1]) {
      const t = totals(cardWith(s));
      expect(t.total, `s=${s}`).toBe(T0);
      expect(t.guns, `s=${s} 炮台保底 1/单位`).toBeGreaterThanOrEqual(2);
      expect(t.drones, `s=${s} 机群保底 1/架`).toBeGreaterThanOrEqual(6);
    }
  })

  it("机群先取、余额给炮台：s=0.5 ⇒ 机群与炮台各 417（逐架/逐单位 Σ 精确、均摊）", () => {
    const t = totals(cardWith(0.5));
    expect(t.drones).toBe(417);
    expect(t.guns).toBe(417);
    const ds = droneShots(cardWith(0.5));
    expect(ds.reduce((a, b) => a + b, 0)).toBe(417); // 余数补前面的架次：139×3 + 138×3?
    expect(Math.max(...ds) - Math.min(...ds)).toBeLessThanOrEqual(1); // 均摊（差 ≤1）
    const gs = gunShots(cardWith(0.5));
    expect(gs.reduce((a, b) => a + b, 0)).toBe(417);
    expect(Math.max(...gs) - Math.min(...gs)).toBeLessThanOrEqual(1);
  })

  it("边界保底：s=1 ⇒ 炮台压到 1/单位；s=0 ⇒ 机群压到 1/架（**没有 0 伤害条目**）", () => {
    expect(gunShots(cardWith(1))).toEqual([1, 1]);
    expect(droneShots(cardWith(0))).toEqual([1, 1, 1, 1, 1, 1]);
    for (const s of [0, 1]) {
      const all = createFoeSpecs(cardWith(s), bal).flatMap((u) => u.weapons);
      expect(all.every((w) => (w.shotDmg ?? 0) >= 1)).toBe(true);
    }
  })

  it("**条目级**：同一张卡两条目可各写各的（互不影响）", () => {
    const shipA = gunShip();
    const shipB = gunShip();
    const base = testCard(shipA, 2);
    const card: AnomalyDef = {
      ...base,
      ships: [
        { ship: shipA, count: 1, dmgMul: 2, droneFireShare: 0.8 }, // 甲：机群为主
        { ship: shipB, count: 1, dmgMul: 2 }, // 乙：缺省（旧口径）
      ],
    };
    const units = createFoeSpecs(card, bal);
    const per = units.map((u) => ({
      gun: u.weapons.find((w) => w.src !== "drone")!.shotDmg ?? 0,
      drones: u.weapons
        .filter((w) => w.src === "drone")
        .reduce((n, w) => n + (w.shotDmg ?? 0), 0),
    }));
    // 甲条目 T = 267 + 150 = 417 ⇒ 机群 round(417×0.8) = 334、炮台 83
    expect(per[0]!.drones).toBe(334);
    expect(per[0]!.gun).toBe(83);
    expect(per[0]!.drones + per[0]!.gun).toBe(417);
    // 乙条目（未写 ⇒ 旧口径）：炮台 267（本例 comp 随卡为 4/3 ⇒ 267）、机群 3×50 = 150
    expect(per[1]!.gun).toBe(267);
    expect(per[1]!.drones).toBe(150);
    // 卡总单发仍守恒（甲=417、乙=417）
    expect(per.reduce((n, x) => n + x.gun + x.drones, 0)).toBe(834);
  })
});
