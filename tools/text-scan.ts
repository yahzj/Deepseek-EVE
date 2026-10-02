/**
 * **扫源码文本的两个共用件**（2026-10-02 立 · 三号 · 船长「按你推荐来」批准的那两件护栏之一）。
 *
 * 为什么单独立这一份：`l10n:check`（表 ↔ 引用一致性）与 `l10n:core-zh`（裸中文上屏体检）
 * 都需要"**只看代码、不看注释**"的源码视图 + "把 `core.*` / `ui.*` 字面量抠出来"——
 * 两份各写一遍必然漂（先例：渲染层与 core 侧各写一份 id 表）。
 * 立此文件后两处 import 同一实现。
 *
 * 两个函数都**保持长度与行号不变**（注释换成等长空白、保留换行）⇒ 报错行号与源文件一一对应。
 */

/**
 * **剥注释**：`// …` 与 `/* … *\/` 整段换成等长空白，**字符串里的注释起始符不动**
 * （扫描器认得 `'` `"` `` ` `` 与反斜杠转义）。
 *
 * ⚠ 为什么必须剥：这两条判据原先直接扫原始文本 ⇒ **文档注释里写的示例**
 * （`addLog(…, 中文原串, …)`、`core.x.010` 这类教学串）会被当成真漏口/死引用报出来
 * （2026-10-02 实测：core 侧一次误报 4 处、裸中文体检一次误报 11 处）。
 */
export function stripComments(s: string): string {
  let out = ''
  let i = 0
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code'
  while (i < s.length) {
    const c = s[i]!
    const n = s[i + 1]
    if (mode === 'code') {
      if (c === '/' && n === '/') {
        mode = 'line'
        i += 2
        out += '  '
        continue
      }
      if (c === '/' && n === '*') {
        mode = 'block'
        i += 2
        out += '  '
        continue
      }
      if (c === "'") mode = 'sq'
      else if (c === '"') mode = 'dq'
      else if (c === '`') mode = 'tpl'
      out += c
      i += 1
      continue
    }
    if (mode === 'line') {
      if (c === '\n') {
        mode = 'code'
        out += c
      } else out += ' '
      i += 1
      continue
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') {
        mode = 'code'
        i += 2
        out += '  '
        continue
      }
      out += c === '\n' ? '\n' : ' '
      i += 1
      continue
    }
    /* 字符串里：原样保留（文案与 id 就在这里），只处理转义与收尾引号 */
    out += c
    if (c === '\\') {
      out += n ?? ''
      i += 2
      continue
    }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code'
    i += 1
  }
  return out
}

/** 一条 id 引用：`core.<段>.<三位>` / `ui.<段>.<三位>`（形态与 `l10n-check` 的 `ID_RE` 同口径） */
export interface IdLiteral {
  id: string
  line: number
}

/**
 * **抠出源码里的 id 字面量**（单/双/反引号三种引法都认；**不做插值**——`` `ui.x.0${n}` `` 这种
 * 动态拼的整条跳过，只认裸字面量）。
 *
 * 入参请传**已剥注释**的源码（`stripComments` 的产物）⇒ 文档示例不会误伤。
 */
export function idLiteralsIn(src: string): IdLiteral[] {
  const out: IdLiteral[] = []
  for (const m of src.matchAll(/['"`]((?:core|ui)\.[A-Za-z][A-Za-z0-9]*\.\d{3})['"`]/g)) {
    const line = src.slice(0, m.index).split('\n').length
    out.push({ id: m[1]!, line })
  }
  return out
}
