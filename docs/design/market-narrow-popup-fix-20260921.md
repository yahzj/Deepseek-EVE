# 修「手机模式下点订单不弹详情」＋ 记录手机市场的断点错位（2026-09-21）

> **状态：进行中**（已实现，闸门全绿，待船长复测）
>
> **船长报障（照抄）**：「**手机模式下，市场页面，点击订单不会弹出订单详细。**」
>
> **本件范围**：窄屏/手机那条「点订单 ⇒ 弹详情浮窗」的链（2026-09-21 二号批的功能）。
> **不做**：手机市场的两栏/单栏取舍（现状＝单栏，见 §三）· 详情内容本身 · 断点数值（仍 1180）。

## 一、根因：浮窗的渲染条件永远不成立（自己把自己挡住了）

浮窗的渲染条件是 `narrow && detailOpen && activeGood`（`pages/MarketPage.tsx` 末尾）：

```tsx
{narrow && detailOpen && activeGood ? ( …弹层… ) : null}
```

而 `activeGood` 由 `activeSelKey = selKey ?? defaultSelKey` 推出，**窄屏下 `defaultSelKey` 恒为 `null`**
（窄屏不默认选中第一个常驻商品，这是同批有意做的）。问题出在点击那条路上——

```ts
// 初版（坏）
const onPickGood = (goodKey: string): void => {
  if (narrow) setDetailOpen(true)   // 只开窗
  else setSelKey(goodKey)           // 窄屏不写 selKey（注释里写"免得列表留高亮"）
}
```

⇒ 窄屏点击：`detailOpen = true`，但 **`selKey` 仍是 null、`defaultSelKey` 也是 null** ⇒ `activeGood === null`
⇒ **浮窗一个都不渲染**：点了没反应，既没有浮窗、列表也没有行高亮。**与手机模式无关，任何窄屏都一样**
（真机只是最容易撞上）。

## 二、修法（两处，语义各归各位）

```ts
// ① 两条路都写 selKey——浮窗靠它取商品
const onPickGood = (goodKey: string): void => {
  setSelKey(goodKey)
  if (narrow) setDetailOpen(true)
}

// ② 「窄屏列表不留行高亮」那一半改在**传参**这侧掐掉，别拿"不写 selKey"去实现
const listSelKey = narrow ? null : activeSelKey   // 4 处列表都传它
```

- 宽屏路径**逐字未变**（`onPickGood` 仍只写 `selKey`；`listSelKey === activeSelKey`）。
- 窄屏：点击 ⇒ 浮窗渲染 ✓；关窗（`closeDetail`）继续把 `selKey` 一并清掉 ⇒ 不留高亮 ✓。
- 外部聚焦（舰船页「去市场」`focusSeq`）与「我的挂单」行内跳转（`jumpToOrder`）本来就走 `selKey`，
  现在两条路同源 ⇒ 那两条入口在窄屏也照常开窗（原先它们也是同款"开窗但取不到商品"）。

## 三、⚠ 顺带查清的一条：手机模式的断点错位（现状＝能自洽，但有两套口径在打架）

手机竖屏被 `.app-root.is-mobile-rot` 整窗 `rotate(-90deg) scale()` 成**虚拟横屏**（`--mob-w: 1200px`），
而**媒体查询看的是物理视口**（竖屏 ≈390px）⇒ 一进手机模式，`max-width: 1180px` 就会命中，
可 CSS 里还有两条互相打架的规则（**特异性都是 0,3,0，靠文件先后决胜**）：

| 位置 | 规则 | 意图 |
|---|---|---|
| `styles.css` 靠前（第 134 行） | `.app-root.is-mobile-rot .app-mkt-split { grid-template-columns: minmax(0,1fr) minmax(0,1.45fr) }` | 「**旋转时维持桌面横排布局**」（旋转后物理宽仍是竖屏宽，怕误触发折叠） |
| `styles.css` 靠后（第 5626 行，`@media (max-width:1180px)` 内） | 同选择器 → `grid-template-columns: 1fr` | 压回**单栏**——起因是玩家 2026-09-14 报「手机市场显示不正常」（两栏在 390px 里被挤出容器） |

⇒ **现行结果 = 手机市场是单栏**（后写的赢），与 JS 侧 `narrow = matchMedia('(max-width:1180px)')` **恰好一致** ✓
所以本次只需要修 §一 那条链；**没有**出现"CSS 两栏 / JS 窄屏"的错位。
⚠ 但这条一致性是"**靠文件顺序侥幸成立**"的：谁要是把第 5626 行那块挪到第 134 行前面，手机市场就会
变回两栏、而 JS 仍当窄屏 ⇒ 右栏详情不渲染、浮窗又只在点了才开——又会变成"点订单没反应"。
**已在本文件登记**；要彻底根治，得把「是否手机旋转」做成 JS 与 CSS 的同一个来源（例：`App` 把
`mobileRot` 往下传、或抽一个 `useMobileRot()` 共用），属结构改动，等船长点头再做。

## 四、验证

- `npm run typecheck` 四包 **0 错**；
- `npm run test -w @whale/core` **181 文件 / 2056 用例全绿**（本件只动渲染层，core 无变化）；
- `npm run l10n:check` ✅（无新增/删除文案 id）· `npm run ui:rot-check` ✅（断点仍 1180，与 CSS 同源）· `npm run build` ✓；
- ⚠ **手机上的实点复测请船长做**（"点订单弹不弹得出、浮窗会不会被旋转坐标带偏"这类只能真机判；
  本件是读数型的代码级定位，没跑真机）。

## 五、归档待办（§8）

- roadmap 一条（并入 2026-09-21 窄屏浮窗那条，写明"初版渲染条件取不到商品"的修法）；
- `docs/glossary.md`：窄屏浮窗那行若已登记，补一句"窄屏恒不默认选中 ⇒ 浮窗的商品只能来自点击写下的 `selKey`"。

---

_维护：本件是工作文档，验收后按 AGENTS §8 归档（关键内容并入 roadmap/词典 → 删文件 → 重跑 docs:index）。_
