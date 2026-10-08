/** 英文延期登记体检；由l10n-check调用，不准备或写入译文。
 * 输入唯一表与docs/l10n-pending.md，输出标记/登记不一致问题。
 * 游戏v0.1.0/存档v31；2026-10-09核对英文显式启动裁定。
 */
import type { L10nEntry } from '../packages/data/src/l10n/table'

/** 待译仅凭明确标记与文档登记放行，不能全局关闭英文检查。 */
export function deferredL10nIssues(entries: Readonly<Record<string, L10nEntry>>, document: string): string[] {
  const recorded = new Set([...document.matchAll(/^\| `([^`]+)` \|[^\n]*\| 待本地化 \|\s*$/gm)].map(match => match[1]!))
  const issues: string[] = []
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.enDeferred === true) {
      if (!recorded.has(id)) issues.push(`${id}：延期英文未登记待本地化文档`)
      if (entry.en !== '') issues.push(`${id}：延期英文不得包含占位或已准备译文`)
    } else if (recorded.has(id)) issues.push(`${id}：待本地化记录与条目标记不一致`)
  }
  for (const id of recorded) if (!entries[id]) issues.push(`${id}：待本地化记录指向不存在的ID`)
  return issues
}
