import type { GameEngine } from '../../game/engine'
import { Achievements } from './Achievements'

export function AchievementsPage({ engine }: { engine: GameEngine }) {
  return (
    <div className="page-stack page-fill">
      <Achievements engine={engine} />
    </div>
  )
}
