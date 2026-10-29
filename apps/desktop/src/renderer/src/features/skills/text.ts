/**
 * 技能说明文案工具（T2）：
 * description 中的"实际效果数值段"以 ⟦…⟧ 标记（见 data/src/skills.ts），
 * 界面显示时符号本身要去掉；SkillsPage 负责把标记段渲染成高亮，本模块提供纯文本版。
 */

/** 去掉 ⟦⟧ 标记后的纯文案（悬浮提示 / 手册等不带高亮的场合用） */
export function plainSkillDesc(text: string): string {
  return text.replace(/⟦/g, '').replace(/⟧/g, '')
}
