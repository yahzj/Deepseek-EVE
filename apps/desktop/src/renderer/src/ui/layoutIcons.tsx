/**
 * **双模自适应界面图标（科幻未来 Carbon vs 旧版 Lucide 冻结）**
 *
 * 船长令（2026-11-02）：
 * 1. 「路线 A 吧 IBM Carbon Icons很不错，但是我们只做做到设计里“科幻未来”的界面布局的里头，不动旧版的UI」
 * 2. 「颜色和替换的形状还有抽象化的功能也要一致」
 *
 * 机制：
 * - 当布局为「科幻未来」（modern）时：渲染方正硬朗、零圆角、工控终端级别的 IBM Carbon Icons；
 * - 当布局为「旧版」（classic）时：原样冻结渲染既有 Lucide 图标，零改动、零破坏；
 * - 颜色（`currentColor` / `color` prop）、尺寸（`size`）与无障碍属性 1:1 严格对齐。
 */
import React from 'react'
import {
  X as LucideX,
  Crosshair as LucideCrosshair,
  Play as LucidePlay,
  Pause as LucidePause,
  RotateCcw as LucideRotateCcw,
  ChevronDown as LucideChevronDown,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  ArrowLeft as LucideArrowLeft,
  Users as LucideUsers,
  Radio as LucideRadio,
  History as LucideHistory,
  List as LucideList,
  Pin as LucidePin,
  Check as LucideCheck,
  Plus as LucidePlus,
  Radar as LucideRadar,
  Search as LucideSearch,
  Trash2 as LucideTrash2,
  Factory as LucideFactory,
  Globe2 as LucideGlobe2,
  ZoomIn as LucideZoomIn,
  ZoomOut as LucideZoomOut,
  AlertTriangle as LucideAlertTriangle,
  Copy as LucideCopy,
  Circle as LucideCircle,
  CircleHelp as LucideCircleHelp,
  CirclePause as LucideCirclePause,
  Hammer as LucideHammer,
  HardHat as LucideHardHat,
  MoveRight as LucideMoveRight,
  PowerOff as LucidePowerOff,
  ShieldAlert as LucideShieldAlert,
  UserRound as LucideUserRound,
  UsersRound as LucideUsersRound,
  Wrench as LucideWrench,
  Zap as LucideZap,
} from 'lucide-react'

import {
  Close as CarbonClose,
  Target as CarbonCrosshair,
  PlayFilled as CarbonPlay,
  PauseFilled as CarbonPause,
  Reset as CarbonRotateCcw,
  ChevronDown as CarbonChevronDown,
  ChevronLeft as CarbonChevronLeft,
  ChevronRight as CarbonChevronRight,
  ArrowLeft as CarbonArrowLeft,
  UserMultiple as CarbonUsers,
  Radio as CarbonRadio,
  Time as CarbonHistory,
  List as CarbonList,
  Pin as CarbonPin,
  Checkmark as CarbonCheck,
  Add as CarbonPlus,
  Radar as CarbonRadar,
  Search as CarbonSearch,
  TrashCan as CarbonTrash2,
  Industry as CarbonFactory,
  Globe as CarbonGlobe2,
  ZoomIn as CarbonZoomIn,
  ZoomOut as CarbonZoomOut,
  WarningAlt as CarbonAlertTriangle,
  Copy as CarbonCopy,
  CircleStroke as CarbonCircle,
  Help as CarbonCircleHelp,
  PauseOutline as CarbonCirclePause,
  Tools as CarbonHammer,
  Construction as CarbonHardHat,
  ArrowRight as CarbonMoveRight,
  Power as CarbonPowerOff,
  Security as CarbonShieldAlert,
  User as CarbonUserRound,
  UserMultiple as CarbonUsersRound,
  Tools as CarbonWrench,
  Flash as CarbonZap,
} from '@carbon/icons-react'

import { isModernLayout } from './layoutPreference'

export type LucideIcon = React.ComponentType<any>

export interface LayoutIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string
  color?: string
  strokeWidth?: number | string
  'aria-hidden'?: boolean | 'true' | 'false'
  'aria-label'?: string
  title?: string
  onClick?: React.MouseEventHandler<SVGSVGElement>
  [key: string]: any
}

function adapt(
  LucideComp: React.ComponentType<any>,
  CarbonComp: React.ComponentType<any>,
): React.FC<LayoutIconProps> {
  const Component: React.FC<LayoutIconProps> = (props) => {
    const isModern = isModernLayout()
    if (!isModern) {
      return <LucideComp {...props} />
    }
    const { size = 16, color, className, style, strokeWidth: _, ...rest } = props
    const numSize = typeof size === 'string' ? parseFloat(size) || 16 : size
    return (
      <CarbonComp
        size={numSize}
        fill={color ?? 'currentColor'}
        className={className}
        style={color ? { color, ...style } : style}
        {...rest}
      />
    )
  }
  Component.displayName = `AdaptiveIcon(${CarbonComp.displayName || CarbonComp.name || 'Icon'})`
  return Component
}

export const X = adapt(LucideX, CarbonClose)
export const Crosshair = adapt(LucideCrosshair, CarbonCrosshair)
export const Play = adapt(LucidePlay, CarbonPlay)
export const Pause = adapt(LucidePause, CarbonPause)
export const RotateCcw = adapt(LucideRotateCcw, CarbonRotateCcw)
export const ChevronDown = adapt(LucideChevronDown, CarbonChevronDown)
export const ChevronLeft = adapt(LucideChevronLeft, CarbonChevronLeft)
export const ChevronRight = adapt(LucideChevronRight, CarbonChevronRight)
export const ArrowLeft = adapt(LucideArrowLeft, CarbonArrowLeft)
export const Users = adapt(LucideUsers, CarbonUsers)
export const Radio = adapt(LucideRadio, CarbonRadio)
export const History = adapt(LucideHistory, CarbonHistory)
export const List = adapt(LucideList, CarbonList)
export const Pin = adapt(LucidePin, CarbonPin)
export const Check = adapt(LucideCheck, CarbonCheck)
export const Plus = adapt(LucidePlus, CarbonPlus)
export const Radar = adapt(LucideRadar, CarbonRadar)
export const Search = adapt(LucideSearch, CarbonSearch)
export const Trash2 = adapt(LucideTrash2, CarbonTrash2)
export const Factory = adapt(LucideFactory, CarbonFactory)
export const Globe2 = adapt(LucideGlobe2, CarbonGlobe2)
export const ZoomIn = adapt(LucideZoomIn, CarbonZoomIn)
export const ZoomOut = adapt(LucideZoomOut, CarbonZoomOut)
export const AlertTriangle = adapt(LucideAlertTriangle, CarbonAlertTriangle)
export const Copy = adapt(LucideCopy, CarbonCopy)
export const Circle = adapt(LucideCircle, CarbonCircle)
export const CircleHelp = adapt(LucideCircleHelp, CarbonCircleHelp)
export const CirclePause = adapt(LucideCirclePause, CarbonCirclePause)
export const Hammer = adapt(LucideHammer, CarbonHammer)
export const HardHat = adapt(LucideHardHat, CarbonHardHat)
export const MoveRight = adapt(LucideMoveRight, CarbonMoveRight)
export const PowerOff = adapt(LucidePowerOff, CarbonPowerOff)
export const ShieldAlert = adapt(LucideShieldAlert, CarbonShieldAlert)
export const UserRound = adapt(LucideUserRound, CarbonUserRound)
export const UsersRound = adapt(LucideUsersRound, CarbonUsersRound)
export const Wrench = adapt(LucideWrench, CarbonWrench)
export const Zap = adapt(LucideZap, CarbonZap)

