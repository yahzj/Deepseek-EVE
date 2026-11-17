import type { PageProps } from './common'
import { TaskPanel } from '../panels/Expedition'

export interface TaskFocusTarget {
  tab: string
  seq: number
}

export function TaskCenterPage({ engine, onToast, taskFocus = null, onOpenComms, onJump }: PageProps & {
  taskFocus?: TaskFocusTarget | null
  onOpenComms?: (messageId: string) => void
  onJump?: (t: {
    page: string
    mapTab?: string
    shipTab?: string
    industrySec?: 'refine' | 'shelf' | 'craft' | 'shipyard'
    skillGroup?: string
  }) => void
}) {
  return (
    <div className="page-stack page-fill">
      <TaskPanel engine={engine} onToast={onToast} focusTab={taskFocus} onOpenComms={onOpenComms} onJump={onJump} />
    </div>
  )
}
