/** 独立合成门槛档，不读取或覆盖个人存档。 */
const fs = require('node:fs')
const path = require('node:path')
require('tsx/cjs')
const { gameFixture } = require('./fixture.ts')
const { loadSaveFile } = require('../../packages/core/src/save.ts')

const output = path.resolve(__dirname, '../_ui-artifacts/player-station-game-saves')
fs.mkdirSync(output, { recursive: true })
for (const mode of ['unexplored', 'discovered', 'ready']) {
  const fixture = gameFixture(mode)
  loadSaveFile(fixture.save)
  const file = path.join(output, `test-save-player-station-${mode}-20261121.json`)
  fs.writeFileSync(file, fixture.save, 'utf8')
  console.log(file)
}
