/**
 * **入侵演出**（**船长 2026-09-25 令**）：
 * ① 开场：「**打算给入侵发生添加一个开场动画，当入侵发生时，游戏屏幕的正上方和正下方出现警告式的
 *    红灯闪烁，然后这里预留一个声效的接口，用于之后接入警报声。警告灯闪烁数次后，再弹出通讯。**」
 *    （同日补定：**开局 ＋ 旗舰现身各闪一次**）
 * ② 收场：「**且入侵结束后的通讯发送给玩家时，屏幕上出现类似庆祝的烟火动画**」。
 *
 * 两条铁律（都在 `styles.css` 那两族里落着）：
 * - **一律 `pointer-events: none`**：演出不挡任何点击（弹窗、战场、星图照常可用）；
 * - **z-index 110（压在战场 100 之上）**：警报就是要打断注意力 —— 玩家正在打别的战斗时也该看见。
 *
 * 声效只留接口：`game/sfx.ts` 的 `playSfx('invasion-alarm' | 'invasion-end')`（本批空实现）。
 */
import type { ReactNode } from 'react'

/** 单次闪烁时长（ms）· 闪烁次数 —— **改这两个数即改整套节奏**（界面计时与 CSS 迭代次数同源，不会漂） */
export const ALARM_FLASH_MS = 800
export const ALARM_FLASH_COUNT = 3
/** 警报总时长（界面按它自熄；也是"通讯弹窗被压住"的时长） */
export const ALARM_TOTAL_MS = ALARM_FLASH_MS * ALARM_FLASH_COUNT
/** 烟火演出总时长（自熄） */
export const FIREWORKS_MS = 4_200

/**
 * **警报红灯**：屏幕正上方 ＋ 正下方各一条红色灯带，闪 `ALARM_FLASH_COUNT` 次。
 * `kind` 只作语义标记/调试用（`start` = 入侵开局 · `flagship` = 旗舰现身），两档观感目前同款。
 */
export function InvasionAlarm({ kind }: { kind: 'start' | 'flagship' }): ReactNode {
  const beat = {
    animationDuration: `${ALARM_FLASH_MS}ms`,
    animationIterationCount: ALARM_FLASH_COUNT,
  }
  return (
    <div className={`app-alarm is-${kind}`} aria-hidden>
      <span className="app-alarm-band is-top" style={beat} />
      <span className="app-alarm-band is-bottom" style={beat} />
    </div>
  )
}

/**
 * **庆祝烟火**：六处爆散（环 ＋ 八向射线 ＋ 芯点），逐处错峰绽放后淡出。
 * ⚠ 形状一律**SVG 线稿**（与舰船/爆炸同一套语言），CSS 只负责时序与缩放 —— 不用 CSS 拼形状。
 * 位置写死在 `viewBox 1000×620` 的上三分之二（避开底部界面条）。
 */
const BURSTS: Array<{ x: number; y: number; cyan?: boolean; delayMs: number }> = [
  { x: 210, y: 150, delayMs: 0 },
  { x: 500, y: 105, cyan: true, delayMs: 260 },
  { x: 790, y: 165, delayMs: 520 },
  { x: 330, y: 320, cyan: true, delayMs: 780 },
  { x: 665, y: 300, delayMs: 1_040 },
  { x: 500, y: 425, cyan: true, delayMs: 1_300 },
]

export function InvasionFireworks(): ReactNode {
  return (
    <div className="app-fireworks" aria-hidden>
      <svg viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid slice">
        {BURSTS.map((b) => (
          <g
            key={`${b.x}-${b.y}`}
            className={`app-fw-burst${b.cyan ? ' is-cyan' : ''}`}
            transform={`translate(${b.x} ${b.y})`}
            style={{ animationDelay: `${b.delayMs}ms` }}
          >
            {/* 爆散环（向外扩张淡出） */}
            <circle className="app-fw-ring" r="14" />
            {/* 八向射线 */}
            <path
              className="app-fw-rays"
              d="M0 -10 L0 -20 M7 -7 L14 -14 M10 0 L20 0 M7 7 L14 14 M0 10 L0 20 M-7 7 L-14 14 M-10 0 L-20 0 M-7 -7 L-14 -14"
            />
            {/* 芯点 */}
            <circle className="app-fw-core" r="3.2" />
          </g>
        ))}
      </svg>
    </div>
  )
}
