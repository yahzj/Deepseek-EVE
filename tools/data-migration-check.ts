/** 仅本批迁移验收：固定旧Git基线全字段对照，不把旧数值作为日常编辑硬锁。 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const result = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/static-data-migration-20261006.test.ts'], {
  cwd: resolve('packages/core'), env: { ...process.env, DATA_MIGRATION_VERIFY: '1' }, stdio: 'inherit', windowsHide: true,
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
