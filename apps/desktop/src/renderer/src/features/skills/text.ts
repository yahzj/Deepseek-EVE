
export function plainSkillDesc(text: string): string {
  return text.replace(/⟦/g, '').replace(/⟧/g, '')
}
