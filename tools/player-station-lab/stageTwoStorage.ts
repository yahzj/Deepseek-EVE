/** 第二阶段外层快照结构，与现有经营v8分离；不使用浏览器存储或个人游戏档。 */
export const STAGE_TWO_FORMAT = 'whale-second-stage-preview'
export const STAGE_TWO_MAX_BYTES = 2 * 1024 * 1024
export function stageRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('第二阶段快照结构无效')
  return value as Record<string, unknown>
}
export function readStageEnvelope(text: string) {
  if (new TextEncoder().encode(text).length > STAGE_TWO_MAX_BYTES) throw new Error('第二阶段快照超过2MiB')
  const raw = stageRecord(JSON.parse(text))
  if (raw.format !== STAGE_TWO_FORMAT || raw.version !== 1 || typeof raw.base !== 'string') throw new Error('仅接受第二阶段独立预览快照')
  return { raw, base: raw.base }
}
