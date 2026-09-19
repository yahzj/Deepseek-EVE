# 战斗倍速（**挂起**）· 2026-09-19

**状态：挂起（未动工、无任何代码改动）**——船长 2026-09-19：「**先挂起，我打算用制作一个消耗谜质升级的研究科技树。**」
（原需求：「给游戏战斗加入倍速功能，允许玩家更快的进行战斗。」）

## 一、已查清的现状（复用时不必重查）

- **战斗时钟 = 全局游戏时钟**：引擎 10Hz 心跳 → `advanceGame(state, deltaMs, ctx, { nowWallMs })`
  （core `engine.ts`）→ 各宿主（`advanceExpedition` / `advanceWormhole` / `advanceEncounterWatch` / `advanceAi`）
  → `combat.advanceBattleFor(...)`：循环条件 `while (state.gameMs > battle.lastTickGameMs)`、
  步长 `dt = Math.min(BATTLE_STEP_MS(100ms), state.gameMs - battle.lastTickGameMs)`。
- **战斗逻辑的时值全走战斗时钟**（装填 / 推进器相位 / 波次 / 单波内增援 / 受击增程 / `maxBattleMs` 超时）
  ⇒ 正解 = **给战斗一条独立倍速时间轴**：`战斗目标时刻 = battle.startedAtGameMs + (state.gameMs − battle.startedAtGameMs) × 倍速`
  （倍速 1 时与现状**逐字等价**）。**不要**去乘全局时钟（会把采矿/制造/市场一起加速）。
- **三处混用真实墙钟**（倍速必须先改掉，否则 4× 时波次转场会等真实时间、卡顿）：
  1. `seedUnit({ arrivedAtMs: state.gameMs + … })`（入场动画时刻，combat.ts:2277/4888/4940）；
  2. 波次转场等待：`if (gapMs > 0 && battle.waveClearAt !== undefined && state.gameMs < battle.waveClearAt) break`
     （combat.ts:4913，以及 `waitedGap` 判定那一段）；
  3. 战斗提示条 `battle.notices[].atMs`（用 `battle.lastTickGameMs`，界面按哪个时钟读需一并核）。
- **界面落点**（战斗窗口 `panels/BattleScreen.tsx`）：操作行有「⚑ 撤退」按钮（含"再点确认"二段确认、"洞内不给撤退"分支）；
  距离条那行上方有双方速度读数（`.app-bts-speed`，2026-09-16 加）。战斗窗口顶部另有提示位（`battle.notices`）。
- 引擎心跳在交火中 100ms、闲置 500ms（`ensurePump` / `wantsFastPump`）⇒ 4× 时每拍需跑 4 个 `BATTLE_STEP_MS` 子步（`BATTLE_MAX_STEPS = 40_000` 足够）。

## 二、待船长定的八条（已问、未答复）

1. 档位：`1× / 2× / 4×`（建议就三档，不加慢放）。
2. 作用范围：只作用于玩家自己这一场（远征 / 低安遭遇 / 洞内）；AI 副船与后台不吃倍速。
3. 离线口径：倍速只在前台心跳生效，离线补算一律 1×。
4. 记忆方式：建议"跨场记住、不进存档"（零迁移）；跨档记忆要加存档字段 + 迁移。
5. 演出口径：演出照原速播（看得清），只把"动画没结束不开火"的保护窗口按倍速等比放大。
6. 界面落点：建议放操作行（与「撤退」同级，一格三档）。
7. 是否要「瞬间打完」档：建议先不做。
8. 洞内是否同样可倍速：可（洞内不能撤退，倍速只改时间刻度）。

## 三、复用提示

- 原始双向问答与调研结论都在本卡；恢复此工作时先读本卡第一节，再按第二节的确认项走 §2 四步闸门。
