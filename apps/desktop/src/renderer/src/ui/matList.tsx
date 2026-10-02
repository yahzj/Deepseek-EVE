/**
 * **原材料列表的折叠开关**（**2026-10-01 船长令**：「**「原材料列表」折叠，超过2个材料就进行折叠**」，
 * 承接同日那句「经典页面的卡牌所需原料太多时能否压缩成一个'原材料列表'的按钮，点击后才会拉开显示全部原材料」）。
 *
 * **为什么收成公共件**：经典页**两张卡**要用同一条规则——组装机／造船厂卡（`panels/Industry.tsx`
 * 的 `BlueprintCard`）与实验室卡（`pages/IndustryPage.tsx` 的 `LabCard`）——门槛与文案各写一份必然漂
 * （§十五之二 取数与派生纪律：单一来源）。
 *
 * **形态**：
 * - **折叠态**：`.app-bp-mats` 里只留一行开关（复用本块既有的可点样式 `.app-bp-mat-act`，**不新增 CSS**）；
 *   有缺料时行尾补一枚红字「缺 N 项」（⟪2026-10-02 船长令⟫ 原文是「缺 N 味」）（复用 `.app-bp-mat.is-short` 那条红＋粗），**只在未开工时**标 ——
 *   与材料行同款理由：在跑的红字会被误读成故障。⇒ **缺料不许因为折叠而看不见**。
 *   另：两张卡的开工键 tooltip 本来就带着缺料明细（组装机 `feedTxt` / 实验室 `ui.lab.013` 那条拒绝文本），
 *   折叠不会把"缺什么"这条信息埋掉。
 * - **展开态**：开关文案变「收起原材料列表」，下面是全部 N 行（含每行的「去哪弄」跳转链）。
 * - **在卡内拉开，不做二级浮层**：船长原话就是"拉开"；且这是一次**玩家主动点击**的展开 ——
 *   §6「容器/卡片尽量固定尺寸防跳动」针对的是心跳里内容自己变，用户点的折叠件高度变化属预期。
 * - **状态不落盘、也不跨挂载记忆**：每张卡各自的 `useState(false)`，切页/重挂载即回到折叠。
 * - **无障碍**（技能 `ui-ux-pro-max` · Accessibility「ARIA Labels（High）：**Interactive elements need
 *   accessible names**」）：可见文案就是它的名字，再补 `aria-expanded` ＋ `aria-controls`（指向那个 `<ul>` 的 id）、
 *   `role="button"` ＋ `tabIndex` 与 Enter/Space 切换 —— 与工业 HUD 页既有的折叠件同一套口径
 *   （`ui/hud.tsx` 的 `IconBtn` 也带 `aria-expanded` / `aria-controls`）。
 */
import type { ReactNode } from 'react'
import { tr } from '../i18n/locale'

/** **折叠门槛**：**材料味数 > 2** 才折叠（船长令「超过2个材料就进行折叠」）⇒ 1~2 味照旧平铺。 */
export const MATS_COLLAPSE_OVER = 2

export function MatListToggle({
  count,
  open,
  shortCount,
  running,
  listId,
  onToggle,
}: {
  /** 材料**味数**（＝折叠前那一列的行数） */
  count: number
  /** 当前是否展开 */
  open: boolean
  /** 缺料的**味数**（0 = 不缺；判据由调用方按各卡自己的尺算好传进来） */
  shortCount: number
  /** 该卡是否在跑（在跑不标红，与材料行同一口径） */
  running: boolean
  /** 被控制元素（那个 `<ul>`）的 id —— 无障碍用，见头注 */
  listId: string
  onToggle: () => void
}): ReactNode {
  return (
    <li className="app-bp-mat">
      <span
        className="app-bp-mat-act"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={listId}
        title={open ? tr('ui.Industry.164') : tr('ui.Industry.163', { n: count })}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        {open ? tr('ui.Industry.161') : tr('ui.Industry.160', { n: count })}
      </span>
      {!open && shortCount > 0 && !running ? (
        <span className="app-bp-mat is-short"> {tr('ui.Industry.162', { n: shortCount })}</span>
      ) : null}
    </li>
  )
}
