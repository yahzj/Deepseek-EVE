# 舰船状态窗 · 场景背景系统（2026-09-10，含扩展接口约定）

> 组件：`apps/desktop/src/renderer/src/ui/ShipStatusWin.tsx`（导航「出港」上方小窗）。
> 目的：状态窗随活动换背景；**接口留作将来其它环境（战斗/采矿大场景等）复用同一场景推导**。

## 一、场景枚举（唯一事实源）

```ts
export type ShipwinScene = 'combat' | 'travel' | 'work-mine' | 'work-salvage' | 'work-scan' | 'field' | 'docked'
export function sceneOfShipwin(state: GameState): ShipwinScene // 活动状态 → 场景（纯函数、独立导出）
```

- 推导优先级：交火 → 长途运输 → 采矿（返航=航行）/打捞（返航=航行）/扫描（返航=航行）→ 远征返航 → 返航/交付 → 掩护巡逻 → 野外停留 → 停靠。
- 任何新消费方（例如未来战斗场景把整窗背景也按场景变）直接调用 `sceneOfShipwin`，不要各自重写判定。

## 二、视觉分层（每场景改动点一览）

| 层 | 载体 | 场景差异内容 | 存放处 |
|---|---|---|---|
| ① 氛围底色 | `.app-shipwin-bg.bg-<scene>` div | 底色渐变 + 伪元素光带/扫描线/火光 | styles.css `.bg-*` 规则 |
| ② 星空/机库/远景物件 | `.app-shipwin-sky` 内联 SVG（舰后层，z1） | 星星点阵（`STAR_COUNT[scene]` 取前 N 颗）、机库结构（docked）、作业飘浮物 | ShipStatusWin.tsx `sky[]` |
| ③ 舰船 | ShipSprite 双层（z2） | 尾焰/浮动/摇摆/震动类（`.is-<scene>`） | styles.css |
| ④ 交火炮口火光 | `.app-shipwin-mz` SVG（舰前层，z3） | combat 双炮口 | ShipStatusWin.tsx |

## 三、新增一个场景的步骤（约定）

1. `ShipwinScene` 加值（如将来 `'zone-alien'` 外星环境）；
2. `sceneOfShipwin` 加推导分支（注意优先级顺序）；
3. `STAR_COUNT` 给星星数；在 `sky[]` 按场景追加远景物件（**一律 SVG 线稿**，禁止 CSS 拼形状——conventions 第九章）；
4. styles.css 加 `.bg-<scene>` 底色/光效与需要的新 keyframes；
5. 舰体动效类（如需）挂 `.is-<scene>`。

背景切换过渡：组件在场景变化时保留旧背景层 0.45s 交叉淡出（`bgPrev` 机制），无需额外工作。

## 四、既定视觉口径（2026-09-10 船长）

- **底色收敛主题色系**：全部场景底色都在深蓝黑青系（`#0a1522` 家族）内做明暗/微色温差异，语义色（警报红/琥珀）只出现在光效点缀，不与主题色差过大；
- 停靠 = **机库场景**（SVG 线稿：顶棚横梁、墙柱、地板停靠格、引导灯，主题青系低饱和）；
- 太空场景参考战斗画面背景画星星点阵（细点、低饱和、随机错落）；
- 航行（返航/运输/交付/远征返航）星带方向：**舰艏朝右 = 向右航行 → 背景自右向左流动**（与战斗星空视差同方向语义）；
- 图形物件一律 SVG（细则见约定第九章）。
