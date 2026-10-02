/**
 * **循环目标输入的「防丢草稿」套件**（2026-09-17 组装机卡首创；**2026-10-02 模块化**：组装机卡 ·
 * 实验室卡（经典）· 实验室（HUD）三处共用这一份，删掉三份各写一套的 ref 对 ＋ 卸载 effect）。
 *
 * 为什么要它：「目标批数」原先**只在回车 / 失焦那一刻提交**，而**程序化跳页**（通讯「前往」、
 * 教程跳转、任务卡跳转）**不产生失焦** ⇒ 玩家刚打的数字从未提交，切回来输入框是空的、
 * 循环开关还开着 ⇒ **变成"无限生产"**（真浏览器复现：打字→不回车→合成点击导航 ⇒ 落盘 goal=null；
 * 鼠标点导航则因 mousedown 先失焦而侥幸不丢）。
 *
 * 口径（与 09-17 原实现逐字一致）：
 * - `typeDraft(v)`：输入框 onChange 用它 —— 置「玩家打过字」标记并更新草稿；
 * - `clearDraft()`：回车/失焦时先清草稿（原 `setGoalDraft('')` 那一下）；
 * - `clearTouched()`：**不经过草稿**的提交路径（开关切换）用它清标记（原 `commitLoop` 头部那一下）；
 * - `commitDraft(text, submit)`：把 text 解析成批数（≤0 / 非数 ⇒ null）后交给调用方 —— 三处若各自
 *   有带 toast 的提交函数，也可以用 `clearDraft` ＋ 自己的提交，二选一；
 * - 卸载时若「玩家打过字」标记还在 ⇒ 用**最新**的 `submitOnUnmount(n)` 补一次提交；没打过字
 *   不做任何动作 ⇒ 不凭空清掉已有目标、StrictMode 的"挂载即卸载"也不误提交。
 */
import { useEffect, useRef, useState } from 'react'

export function useLoopGoalDraft(submitOnUnmount: (goal: number | null) => void): {
  draft: string
  typeDraft: (v: string) => void
  clearDraft: () => void
  clearTouched: () => void
  commitDraft: (text: string, submit: (goal: number | null) => void) => void
} {
  const [draft, setDraft] = useState('')
  const draftRef = useRef('')
  draftRef.current = draft
  const touchedRef = useRef(false)
  /** 卸载时用最新闭包（`submitOnUnmount` 随调用方每拍新建，别把它放依赖里反复挂卸载器） */
  const submitRef = useRef(submitOnUnmount)
  submitRef.current = submitOnUnmount
  useEffect(
    () => () => {
      if (!touchedRef.current) return
      const n = Number.parseInt(draftRef.current, 10)
      submitRef.current(Number.isFinite(n) && n > 0 ? n : null)
    },
    [],
  )
  return {
    draft,
    typeDraft: (v) => {
      touchedRef.current = true
      setDraft(v)
    },
    clearDraft: () => setDraft(''),
    clearTouched: () => {
      touchedRef.current = false
    },
    commitDraft: (text, submit) => {
      touchedRef.current = false
      setDraft('')
      const n = Number.parseInt(text, 10)
      submit(Number.isFinite(n) && n > 0 ? n : null)
    },
  }
}
