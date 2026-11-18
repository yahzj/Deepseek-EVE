import type { ComponentType, CSSProperties, ReactNode } from 'react'
import { MessageSquare } from 'lucide-react'
import { isModernLayout } from './layoutPreference'
import {
  Rocket as CarbonRocket,
  Chip as CarbonChip,
  InventoryManagement as CarbonInventory,
  ArrowsHorizontal as CarbonMarket,
  ChartCandlestick as CarbonChartCandlestick,
  Industry as CarbonIndustry,
  Network_4 as CarbonSkills,
  Task as CarbonTask,
  Email as CarbonMail,
  Target as CarbonTarget,
  Gem as CarbonMine,
  Recycle as CarbonSalvage,
  Bot as CarbonAi,
  Radar as CarbonRadar,
  Chat as CarbonChat,
} from '@carbon/icons-react'
import { wreckTierOf } from './itemSubs'

const SHAPES: Record<string, ReactNode> = {
  'planet-base': <g><path d="M3 20h18M5 20V10h14v10M9 10V6h6v4M12 6V2m0 1h5M8 14h2m4 0h2M10 20v-3h4v3" /></g>,
  'planet-cryo': <g><rect x="6" y="3" width="12" height="18" rx="3" /><path d="M9 7h6M9 17h6M12 10v4m-2-3 4 2m-4 0 4-2" /></g>,
  'planet-power': <g><path d="M3 20h18M5 20V9l4-4h6l4 4v11M13 7l-4 6h4l-2 5 5-7h-4z" /></g>,
  'planet-water': <g><path d="M3 20h18M5 20V8M19 20V8M5 8h14M7 8V4h10v4M8 17h8M12 10c-2 2-3 3-3 4a3 3 0 0 0 6 0c0-1-1-2-3-4z" /></g>,
  'planet-nutrition': <g><path d="M3 20h18M5 20V7h14v13M8 7V3h8v4M8 16h8M9 11v2m3-2v2m3-2v2" /></g>,
  'planet-housing': <g><path d="M3 20h18M5 20V6h6v14M11 10h8v10M7 9h2m-2 4h2m-2 4h2m5-4h2m-2 4h2M5 6V3h6v3" /></g>,
  'planet-farm': <g><path d="M3 20h18M4 18V9l8-6 8 6v9M4 9h16M8 9v9m8-9v9M12 18v-4m0 1c-3 0-4-2-4-3 3 0 4 1 4 3m0 0c3 0 4-2 4-3-3 0-4 1-4 3" /></g>,
  'planet-mine': <g><path d="M3 20h18M5 20l4-14h6l4 14M7 14h10M8 10h8M10 3h4v3M12 6v14m-3-3 3 3 3-3" /></g>,
  'planet-rare': <g><path d="M3 20h18M5 20V7h4m6 0h4v13M12 3l4 5-4 5-4-5zM8 16h8M12 13v3" /></g>,
  'planet-industry': <g><path d="M3 20h18M4 20V10l5 3v-3l5 3V5h5v15M14 5V2h5v3M7 17h2m3 0h2m3 0h1" /></g>,
  'planet-research': <g><path d="M3 20h18M5 20v-9h14v9M8 11V7h8v4M12 7V3m-2 0h4M8 16h2m4 0h2" /><circle cx="12" cy="16" r="1" /></g>,
  'planet-maintenance': <g><path d="M3 20h18M5 20V7h14v13M8 7V3h8v4M9 17l6-6m-1-1 3 3M7 15l3 3" /></g>,
  'planet-logistics': <g><path d="M3 20h18M4 20V9l8-6 8 6v11M4 9h16M8 20v-8h8v8M8 16h8m-4-4v8M16 5V3h3v4" /></g>,
  'planet-food': <g><path d="M12 21V8m0 3c-5 0-7-3-7-6 5 0 7 2 7 6m0 4c5 0 7-3 7-6-5 0-7 2-7 6M5 21h14" /></g>,
  'planet-empty': <g><path d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M8 14l4-3 4 3" /></g>,
  'planet-rough': <g><path d="M2 20l6-12 4 7 3-11 7 16zM6 12l2 2 2-2m3-3 2 2 2-2" /></g>,
  'planet-ice': <g><path d="M3 20l4-14 5 4 4-7 5 17zM7 6l3 14m2-10 2 10m2-17 2 17M4 16h16" /></g>,
  'planet-corrosion': <g><path d="M12 3c-4 5-6 7-6 10a6 6 0 0 0 12 0c0-3-2-5-6-10zM3 21h5m8 0h5M9 12l6 4m-6 0 6-4" /></g>,
  'planet-rubble': <g><path d="M3 20h18M4 17l2-7 5 2 1 8m2 0 1-9 5 3 1 6M8 7l3-3 4 2-1 4M6 14l3 2m8-2 2 3" /></g>,
  ore: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6l4.4 5.4-4.4 5.4-4.4-5.4z" />
      <path d="M12 9l2.2 3-2.2 3-2.2-3z" />
    </g>
  ),
  mineral: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="7.4" y="7.4" width="9.2" height="9.2" rx="1.3" />
      <path d="M12 7.4v9.2" />
    </g>
  ),
  gas: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="7" cy="9.6" r="1.8" />
      <circle cx="11.8" cy="15.4" r="2.3" />
      <circle cx="16.6" cy="8.8" r="1.5" />
    </g>
  ),
  ice: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.8l4.6 2.6v5.2L12 17.2l-4.6-2.6V9.4z" />
      <path d="M12 11.2v1.6M10.6 12h2.8" />
    </g>
  ),
  ammo: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.2l5.7 8.3H6.3z" />
    </g>
  ),
  drone: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 8.9l3.1 3.1-3.1 3.1-3.1-3.1z" />
      <path d="M6 6l2.6 2.6M18 6l-2.6 2.6M6 18l2.6-2.6M18 18l-2.6-2.6" />
    </g>
  ),
  wreck: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M7.6 10.2l7.6-1.5.6 4.4-7.4 1.6z" />
      <path d="M11.4 8.9l-1 2.6 1.7 1.3-1.2 2.1" />
      <circle cx="16.2" cy="15.6" r="1" />
    </g>
  ),
  kit: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.3 15.7l4.9-4.9" />
      <path d="M13.4 8.2l2.4 2.4-1.7 1.7-2.4-2.4z" />
      <path d="M9 15l-1.2 1.2" />
    </g>
  ),
  part: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="8.7" y="8.7" width="6.6" height="6.6" rx="1" />
      <path d="M10.6 8.7V7.1M13.4 8.7V7.1M10.6 16.9v-1.6M13.4 16.9v-1.6M8.7 10.6H7.1M8.7 13.4H7.1M16.9 10.6h-1.6M16.9 13.4h-1.6" />
    </g>
  ),
  fragment: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M13.6 7.4l3 2.6-1.4 4.6-4.6.4-1.6-3.4z" />
      <path d="M12.2 11.2l1.6 1.4" />
      <path d="M8.6 15.4l1.4.8" />
    </g>
  ),
  container: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="7.2" y="8.8" width="9.6" height="6.4" rx="1" />
      <path d="M7.2 11.2h9.6" />
      <path d="M11.4 10.2v2" />
    </g>
  ),
  matter: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 8.4l2.8 3.6-2.8 3.6-2.8-3.6z" />
      <path d="M8.6 9.6h6.8" />
      <path d="M8.6 14.4h6.8" />
    </g>
  ),
  essence: (
    <g>
      <path d="M12 3.4l6.6 5.4-2.7 8.6H8.1L5.4 8.8z" />
      <path d="M12 7.4l3.1 2.7-1.3 3.7h-3.6L9 10.1z" />
      <circle cx="12" cy="11.4" r="1.1" />
    </g>
  ),
  luxury: (
    <g>
      <path d="M5.4 10.6h13.2v8.8H5.4z" />
      <path d="M4.4 7.4h15.2v3.2H4.4z" />
      <path d="M12 7.4v12" />
      <path d="M12 7.4c-2.7 0-4.1-1.3-3.4-2.7.6-1.2 2.5-.9 3.4 2.7zm0 0c2.7 0 4.1-1.3 3.4-2.7-.6-1.2-2.5-.9-3.4 2.7z" />
    </g>
  ),
  'box-relic': (
    <g>
      <path d="M4.8 9.2h14.4v8.6a1.4 1.4 0 0 1-1.4 1.4H6.2a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M4.8 12.6h14.4" />
      <path d="M9.2 9.2V6.6h5.6v2.6" />
      <circle cx="12" cy="15.2" r="1.5" />
      <path d="M12 16.7v1.3" />
    </g>
  ),
  'box-bp': (
    <g>
      <path d="M3.6 11.6h16.8v5a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M3.6 14.2h16.8" />
      <path d="M8.8 11.6V9.6h6.4v2" />
      <circle cx="12" cy="8" r="1.6" />
    </g>
  ),
  'box-valuables': (
    <g>
      <path d="M4.6 10.4h14.8v7a1.4 1.4 0 0 1-1.4 1.4H6a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M4.6 13h14.8" />
      <path d="M12 10.4v8.4" />
      <circle cx="12" cy="13" r="1.5" />
      <path d="M9.8 7.6a2.2 2.2 0 0 1 4.4 0" />
    </g>
  ),
  'box-military': (
    <g>
      <path d="M4.4 9.6h15.2v7.8a1.4 1.4 0 0 1-1.4 1.4H5.8a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M4.4 12.8h15.2" />
      <path d="M6.8 9.6V7.2h3v2.4M14.2 9.6V7.2h3v2.4" />
      <path d="M9.8 15.2l4.4 2.2M14.2 15.2l-4.4 2.2" />
    </g>
  ),
  'ai-core': (
    <g>
      <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.6" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="12" cy="12" r="1.2" />
      <path d="M12 6.4V3.8M12 20.2v-2.6M6.4 12H3.8M20.2 12h-2.6" />
    </g>
  ),
  blackbox: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="7.6" y="8.2" width="8.8" height="7.6" rx="1.2" />
      <path d="M7.6 10.8h8.8" />
      <circle cx="14.4" cy="13.9" r="0.9" />
      <path d="M9.6 13.6h2.4" />
    </g>
  ),
  aicore: (
    <g>
      <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.6" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="12" cy="12" r="1.2" />
      <path d="M12 6.4V3.8M12 20.2v-2.6M6.4 12H3.8M20.2 12h-2.6" />
    </g>
  ),
  consumable: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="8.6" y="8.4" width="6.8" height="8.4" rx="1.4" />
      <path d="M10.4 8.4V6.6h3.2v1.8" />
      <path d="M10.2 11.6h3.6" />
      <circle cx="10.6" cy="14.4" r="0.7" />
      <circle cx="13.4" cy="14.4" r="0.7" />
    </g>
  ),
  'ico-fuel': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.8 8.2h6.4v7.6a1.2 1.2 0 0 1-1.2 1.2h-4a1.2 1.2 0 0 1-1.2-1.2z" />
      <path d="M8.8 11.4c1.1-.9 2 -.9 3.2 0s2.1.9 3.2 0" />
      <path d="M8.8 13.6c1.1-.9 2 -.9 3.2 0s2.1.9 3.2 0" />
    </g>
  ),
  'ico-beacon': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 20V11.6" />
      <path d="M10.2 20h3.6" />
      <path d="M12 11.6 9.6 8.2h4.8z" />
      <path d="M7.2 6.4a6.4 6.4 0 0 1 2.2-2.2M16.8 6.4a6.4 6.4 0 0 0-2.2-2.2" />
      <path d="M5.6 8.6a8.6 8.6 0 0 1 1.4-1.6M18.4 8.6a8.6 8.6 0 0 0-1.4-1.6" />
    </g>
  ),
  'ico-boost': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M10.4 8.4 14 12l-3.6 3.6" />
      <path d="M13.6 8.4 17.2 12l-3.6 3.6" />
      <path d="M6.8 12h3.2" />
    </g>
  ),
  'mat-surveyor': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 12l4.4-3.2" />
      <path d="M6.8 12a5.2 5.2 0 0 1 5.2-5.2" />
      <circle cx="12" cy="12" r="1" />
    </g>
  ),
  'mat-chrono': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.6" />
      <path d="M12 9.4V12l2 1.5" />
    </g>
  ),
  'mat-nebula': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.6 10.2h4a1.7 1.7 0 1 0-1.7-1.7" />
      <path d="M8.4 13.8h5.4a1.8 1.8 0 1 1-1.8 1.8" />
    </g>
  ),
  'mat-expander': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="9" y="9" width="6" height="6" rx="1" strokeDasharray="2 2" />
      <path d="M6.4 12H4.8M17.6 12h1.6M12 6.4V4.8M12 17.6v1.6" />
    </g>
  ),
  'mat-crane': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.8 7.8h6.4" />
      <path d="M12 7.8v5" />
      <path d="M12 12.8a1.9 1.9 0 1 0 1.9 1.9" />
    </g>
  ),
  'mat-drill': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7v4.6" />
      <path d="M9.4 11.6h5.2L12 16.4z" />
    </g>
  ),
  'mat-enricher': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 13.8l2.2 2.2-2.2 2.2-2.2-2.2z" />
      <path d="M9.8 11L12 8.8l2.2 2.2" />
      <path d="M12 8.8v2.6" />
    </g>
  ),
  'mat-suppressor': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6v4.2" />
      <path d="M9.6 8.6L12 11l2.4-2.4" />
      <path d="M8 14.2h8" />
    </g>
  ),
  'mat-boss-analyzer': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.2l1.9 2.3h-3.8z" />
      <circle cx="12" cy="13.4" r="3.4" />
      <circle cx="12" cy="13.4" r="1" />
    </g>
  ),
  'mat-extract-cover': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8 8.4h2.6v7.2H8" />
      <path d="M12.4 12h4.8" />
      <path d="M14.8 9.8L17.2 12l-2.4 2.2" />
    </g>
  ),
  'mat-shield-res': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6l4.4 1.6v3.4c0 2.6-1.8 4.4-4.4 5.4-2.6-1-4.4-2.8-4.4-5.4V8.2z" />
    </g>
  ),
  'mat-armor-res': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="7.2" y="8.2" width="7" height="5.2" rx="1" />
      <rect x="9.8" y="11.4" width="7" height="5.2" rx="1" />
    </g>
  ),
  'mat-hull-res': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="7.2" y="8" width="9.6" height="8" rx="1" />
      <path d="M7.2 8l9.6 8M16.8 8l-9.6 8" />
    </g>
  ),
  'mat-tracker': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 6.2v2.4M12 15.4v2.4M6.2 12h2.4M15.4 12h2.4" />
    </g>
  ),
  'mat-gyro': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <ellipse cx="12" cy="12" rx="5.8" ry="2.6" />
      <ellipse cx="12" cy="12" rx="5.8" ry="2.6" transform="rotate(62 12 12)" />
    </g>
  ),
  'mat-jammer': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.2 9.4a3.6 3.6 0 0 1 0 5.2" />
      <path d="M7.2 7.6a6.6 6.6 0 0 1 0 8.8" />
      <path d="M14.4 14.4l3.4 3.4M17.8 14.4l-3.4 3.4" />
    </g>
  ),
  'mat-rangefinder': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M5.8 12h11.6" />
      <path d="M14.6 9.8L17.4 12l-2.8 2.2" />
      <path d="M9 10.2v3.6" />
    </g>
  ),
  'mat-blindspot': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="14.6" r="2.6" />
      <path d="M12 6.6v4" />
      <path d="M9.8 8.6L12 10.8l2.2-2.2" />
    </g>
  ),
  'mat-ammo-dmg': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.2c1.4 1.3 2.2 2.9 2.2 4.7v3.3H9.8v-3.3c0-1.8.8-3.4 2.2-4.7z" />
      <path d="M12 15.2v2" />
    </g>
  ),
  'mat-reload': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M16.4 12a4.4 4.4 0 1 1-1.5-3.3" />
      <path d="M16.6 6.6v2.8h-2.8" />
    </g>
  ),
  'mat-volley': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.4 9.6L6.6 12l2.8 2.4" />
      <path d="M14.6 9.6L17.4 12l-2.8 2.4" />
      <circle cx="12" cy="12" r="1.4" />
    </g>
  ),
  'mat-ammo-back': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M10.6 10h2.8v6.6h-2.8z" />
      <path d="M10.6 10c0-1.2.6-2.1 1.4-2.1s1.4.9 1.4 2.1" />
      <path d="M15.8 7.6h-3.4" />
      <path d="M13.6 6.4L12.4 7.6l1.2 1.2" />
    </g>
  ),
  'mat-drone-net': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6l1.8 2.2h-3.6z" />
      <path d="M8.2 11.2h7.6v5.4H8.2z" />
      <path d="M8.2 13.9h7.6M12 11.2v5.4" />
    </g>
  ),
  'mat-field-repair': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4v6.4M8.8 10.6h6.4" />
      <path d="M8.6 15.2a4.4 4.4 0 0 0 6.8 0" />
    </g>
  ),
  miner: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.2l3.8 3.8-3.8 3.8-3.8-3.8z" />
      <path d="M12 10.4v3.2" />
    </g>
  ),
  cargo: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M7.8 11.2h8.4M7.8 14.4h8.4" />
    </g>
  ),
  turret: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <circle cx="12" cy="12" r="2.7" />
      <path d="M12 7.6v2.3M12 14.1v2.3M7.6 12h2.3M14.1 12h2.3" />
    </g>
  ),
  missile: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M15.6 8.4l-6.6 6.6M13.6 8.4h2v2M10.4 15.6h-2v-2" />
      <path d="M8.9 15.1L15.1 8.9" />
    </g>
  ),
  shield: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.9c1.5 1 2.7 1.4 3.5 1.5v2.8c0 2.4-1.5 3.8-3.5 4.5-2-.7-3.5-2.1-3.5-4.5v-2.8c.8-.1 2-.5 3.5-1.5z" />
    </g>
  ),
  'shield-field': (
    <g>
      {/* 护盾充能力场装置（2026-09-20 船长）：护盾族**高槽**件 —— 盾形外套**两圈扩散环**
          （力场 = 向外扩散的场，与中槽 shield 的"盾 + 内层"造型区分开） */}
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 10.2c.9.6 1.6.8 2.1.9v1.7c0 1.4-.9 2.2-2.1 2.6-1.2-.4-2.1-1.2-2.1-2.6v-1.7c.5-.1 1.2-.3 2.1-.9z" />
      <path d="M8.6 12.6a3.4 3.4 0 0 0 6.8 0" />
      <path d="M7.4 13.8a4.6 4.6 0 0 0 9.2 0" />
    </g>
  ),
  armor: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M8.2 9.6h7.6M8.8 12.3h6.4M8.2 15h7.6" />
    </g>
  ),
  propulsion: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.6c1.7 2 2.7 3.4 2.7 5a2.7 2.7 0 1 1-5.4 0c0-1.6 1-3 2.7-5z" />
      <path d="M12 7.4V8.5" />
    </g>
  ),
  'drone-rack': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M9.3 9.8h1.6v1.6H9.3zM13.1 9.8h1.6v1.6h-1.6z" />
      <path d="M9 14.8h6" />
    </g>
  ),
  'drone-tac': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 9.4l2.6 2.6-2.6 2.6-2.6-2.6z" />
      <path d="M8 8l1.8 1.8M16 8l-1.8 1.8M8 16l1.8-1.8M16 16l-1.8-1.8" />
    </g>
  ),
  'drone-relay': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 16.5v-4.2" />
      <path d="M12 12.6l1 1-1 1-1-1z" />
      <circle cx="12" cy="8.2" r="0.9" />
      <path d="M8.8 10.6c-1.1.7-1.1 2.5 0 3.2" fill="none" />
      <path d="M15.2 10.6c1.1.7 1.1 2.5 0 3.2" fill="none" />
    </g>
  ),
  'drone-launch': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M9 14l3-4 3 4M12 10v6M9 9h6" />
    </g>
  ),
  'drone-deck': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M9.4 13.5h2.2v2.2H9.4z" />
      <path d="M14.3 15.8V11.1" />
      <path d="M12.9 12.5l1.4-1.4 1.4 1.4" fill="none" />
    </g>
  ),
  'drone-shield': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 9.2l2.9 1.1v3c0 1.6-1.2 2.6-2.9 3.2-1.7-.6-2.9-1.6-2.9-3.2v-3z" />
      <path d="M12 11v3.4" />
    </g>
  ),
  laser: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M8.4 15.6L15.6 8.4M8.4 8.4l7.2 7.2" />
      <path d="M10.9 8.4h4.7v4.7" />
    </g>
  ),
  support: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 15.2V9.4M9.8 11.4L12 9l2.2 2.4" />
    </g>
  ),
  cpu: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <rect x="9.9" y="9.9" width="4.2" height="4.2" rx="0.8" />
      <path d="M12 7.4v2.5M12 14.1v2.5M7.4 12h2.5M14.1 12h2.5" />
    </g>
  ),
  plug: (
    <g>
      <rect x="6.6" y="8.4" width="10.8" height="9" rx="1.6" />
      <path d="M9.4 5.6h5.2v2.8H9.4z" />
      <path d="M9.8 11.6h4.4M9.8 13.8h4.4" />
      <path d="M8.4 20v-2.6M15.6 20v-2.6" />
    </g>
  ),
  salvager: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.6v4.2" />
      <path d="M9.2 14.6l2.8-1.8 2.8 1.8" />
      <path d="M9.2 15.6v-1M14.8 15.6v-1" />
    </g>
  ),
  'target-lock': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 7.6v1.8M12 14.6v1.8M7.6 12h1.8M14.6 12h1.8" />
    </g>
  ),
  industrial: (
    <g>
      <path d="M12 3.4l9.2 8.6-9.2 8.6-9.2-8.6z" />
      <path d="M12 7.6l5.2 4.4-5.2 4.4-5.2-4.4z" />
    </g>
  ),
  armed: (
    <g>
      <path d="M12 2.9c2.6 1.8 4.9 2.4 6.4 2.6v6.1c0 4.7-3 7.7-6.4 9.1-3.4-1.4-6.4-4.4-6.4-9.1V5.5c1.5-.2 3.8-.8 6.4-2.6z" />
      <circle cx="12" cy="12.2" r="2" />
      <path d="M12 8.4v1.8M12 14.2v1.8M7.4 12.2h1.8M14.8 12.2h1.8" />
    </g>
  ),
  armored: (
    <g>
      <path d="M12 3.8l7 4v8.4l-7 4-7-4V7.8z" />
      <path d="M12 7.2l4.4 2.6v5.2L12 17.6l-4.4-2.6V9.8z" />
    </g>
  ),
  hauler: (
    <g>
      <rect x="3.6" y="7.2" width="16.8" height="9.6" rx="1.8" />
      <path d="M7.4 12h9.2M13.6 9.4l2.6 2.6-2.6 2.6" />
    </g>
  ),
  blueprint: (
    <g>
      <rect x="6.2" y="3.8" width="11.6" height="16.4" rx="1.5" />
      <path d="M6.2 8.6h11.6M9.6 11.8h4.8M9.6 14.6h3" />
    </g>
  ),
  'group-舰船': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M7.4 16.6L16.6 7.4M11.6 7.4h5v5" />
    </g>
  ),
  'group-工业': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4l4 2.3v4.6L12 16.6l-4-2.3V9.7z" />
      <circle cx="12" cy="12" r="1.4" />
    </g>
  ),
  'group-战斗': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </g>
  ),
  'group-工程': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="8.4" y="8.4" width="7.2" height="7.2" rx="1.2" />
      <circle cx="12" cy="12" r="1.2" />
    </g>
  ),
  'group-贸易': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6l3.4 3.4-3.4 3.4-3.4-3.4zM12 13.6l3.4 3.4-3.4 3.4-3.4-3.4z" />
    </g>
  ),
  'group-矿业': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.9 15.1l6.2-6.2" />
      <path d="M12.2 7l4.8 4.8" />
    </g>
  ),
  'nav-map': (
    <g>
      <path fill="currentColor" stroke="none" d="M12 2L14.9 9.1L22 12L14.9 14.9L12 22L9.1 14.9L2 12L9.1 9.1Z" />
    </g>
  ),
  'nav-ship': (
    <g>
      <path d="M4.8 16.6c-1.4 1.24-1.9 4.6-1.9 4.6s3.4-.5 4.6-1.9c.65-.77.64-1.96-.08-2.74a2 2 0 0 0-2.62-.06z" />
      <path d="M12.5 14.5l-3-3a20.3 20.3 0 0 1 1.9-3.6A11.9 11.9 0 0 1 22 2c0 2.5-.7 6.9-5.5 10.1a20.6 20.6 0 0 1-4 1.9z" />
      <path d="M9.5 12H4.8s.5-2.8 1.8-3.7c1.5-1 4.6 0 4.6 0" />
      <path d="M12.5 15v4.6s2.8-.5 3.7-1.8c1-1.5 0-4.6 0-4.6" />
    </g>
  ),
  'nav-fit': (
    <g>
      <rect x="8.1" y="8.1" width="3.4" height="3.4" rx="0.8" />
      <rect x="12.5" y="8.1" width="3.4" height="3.4" rx="0.8" />
      <rect x="8.1" y="12.5" width="3.4" height="3.4" rx="0.8" />
      <rect x="12.5" y="12.5" width="3.4" height="3.4" rx="0.8" />
    </g>
  ),
  'nav-items': (
    <g>
      <rect x="5.4" y="6.8" width="13.2" height="10.4" rx="1.5" />
      <path d="M5.4 10.6h13.2" />
      <path d="M8 6.8V5h8v1.8" />
    </g>
  ),
  'nav-market': (
    <g>
      <path d="M6.4 9.2h8.4a2.8 2.8 0 0 1 2.8 2.8" />
      <path d="M15.2 6.4l2.4 2.4-2.4 2.4" />
      <path d="M17.6 14.8H9.2a2.8 2.8 0 0 1-2.8-2.8" />
      <path d="M8.8 17.6l-2.4-2.4 2.4-2.4" />
    </g>
  ),
  'nav-industry': (
    <g>
      <path d="M12 4.9l6.2 3.6v7L12 19.1l-6.2-3.6v-7z" />
      <circle cx="12" cy="12" r="2.4" />
    </g>
  ),
  'nav-skills': (
    <g>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6v8.8M7.6 12h8.8" />
    </g>
  ),
  'nav-mail': (
    <g>
      <rect x="3.4" y="6.4" width="17.2" height="11.4" rx="1.8" />
      <path d="M4.6 7.8l7.4 5.2 7.4-5.2" />
    </g>
  ),
  'faction-octopus': (
    <g strokeWidth="0.7">
      <path d="M12 3.56c-3.43 0 -6.16 2.73 -6.16 6.09v4.41c0 1.26 1.01 2.24 2.24 2.24h7.84c1.23 0 2.24 -0.98 2.24 -2.24V9.65c0 -3.36 -2.73 -6.09 -6.16 -6.09Z" />
      <path d="M12 0.83V3.56" />
      <path d="M8.08 11.4c2.66 1.4 5.18 1.4 7.84 0" />
      <circle cx="9.06" cy="8.25" r="1.89" fill="currentColor" stroke="none" />
      <circle cx="14.94" cy="8.25" r="1.89" fill="currentColor" stroke="none" />
      <path d="M8.99 16.3c-0.7 1.82 -2.03 3.15 -3.85 4.27" />
      <path d="M10.6 16.3c-0.14 1.75 -0.84 3.29 -2.1 4.9" />
      <path d="M12 16.3v5.04" />
      <path d="M13.4 16.3c0.14 1.75 0.84 3.29 2.1 4.9" />
      <path d="M15.01 16.3c0.7 1.82 2.03 3.15 3.85 4.27" />
    </g>
  ),
  'nav-mine': (
    <g>
      <path d="M12 21V9.6" />
      <path d="M12 9.6C9.9 9.8 7.3 8.4 6.2 5.6" />
      <path d="M12 9.6c2.1.2 4.7-1.2 5.8-4" />
      <path d="M6.2 5.6l-.8-1.6M17.8 5.6l.8-1.6" />
    </g>
  ),
  'nav-bounty': (
    <g>
      <circle cx="12" cy="12" r="2.7" />
      <path d="M12 3.2v4.4M12 16.4v4.4M3.2 12h4.4M16.4 12h4.4" />
    </g>
  ),
  'nav-salvage': (
    <g>
      <circle cx="12" cy="12.4" r="2.5" />
      <rect x="3" y="10" width="5.4" height="4.8" rx="1" />
      <rect x="15.6" y="10" width="5.4" height="4.8" rx="1" />
      <path d="M12 4.4v5M12 4.4l1.7 1.7M12 4.4l-1.7 1.7" />
    </g>
  ),
  'nav-task': (
    <g>
      <rect x="5.6" y="4.8" width="12.8" height="14.4" rx="1.8" />
      <path d="M8.6 9.4h6.8M8.6 12.6h6.8M8.6 15.8h4.2" />
    </g>
  ),
  'nav-ai': (
    <g>
      <rect x="6.9" y="9" width="10.2" height="9.2" rx="2.4" />
      <path d="M12 5.4v2.6" />
      <circle cx="12" cy="4.9" r="1.1" />
      <path d="M9.7 12.6h.9v.9h-.9zM13.4 12.6h.9v.9h-.9z" />
    </g>
  ),
  'nav-shop': (
    <g>
      <path d="M12 4.6l7.4 7.4L12 19.4 4.6 12z" />
      <path d="M12 9.4l2.6 2.6-2.6 2.6-2.6-2.6z" />
    </g>
  ),
  'nav-wormhole': (
    <g>
      <path d="M12 3.6a8.4 8.4 0 1 1-8.4 8.4 5.6 5.6 0 1 1 5.6 5.6 2.8 2.8 0 1 1 2.8-2.8" />
    </g>
  ),
  'fam-a': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <path d="M8.6 8.6l6.8 6.8" />
      <path d="M15.4 8.6l-6.8 6.8" />
    </g>
  ),
  'fam-c': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <circle cx="12" cy="9.6" r="1.7" />
      <circle cx="9" cy="14.6" r="1.4" />
      <circle cx="15" cy="14.6" r="1.4" />
    </g>
  ),
  'fam-d': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <path d="M9.4 8.4v7.2M12 8.4v7.2M14.6 8.4v7.2" />
      <path d="M8.2 17.2h7.6" />
    </g>
  ),
  'fam-e': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <path d="M12 7.6l3.4 4.4L12 16.4l-3.4-4.4z" />
      <path d="M12 12v4.4" />
    </g>
  ),
  'fam-g': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <path d="M8.4 15.6l7.2-7.2" />
      <path d="M8.4 11.2l4.4-4.4" />
      <path d="M11.2 15.6l4.4-4.4" />
    </g>
  ),
  'fam-h': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <path d="M8.6 13.2c1.2-1.6 2.4-1.6 3.4 0s2.2 1.6 3.4 0" />
      <path d="M8.6 9.6c1.2-1.6 2.4-1.6 3.4 0s2.2 1.6 3.4 0" />
    </g>
  ),
'ico-home': (
    <g>
      <path d="M4 11l8-6.6L20 11" />
      <path d="M6.2 9.4V19h11.6V9.4" />
      <path d="M10.2 19v-4.4h3.6V19" />
    </g>
  ),
  'ico-lock': (
    <g>
      <rect x="6.6" y="10.6" width="10.8" height="8.2" rx="1.8" />
      <path d="M9.2 10.4V8.2a2.8 2.8 0 0 1 5.6 0v2.2" />
      <circle cx="12" cy="14.6" r="1.2" />
      <path d="M12 15.8v1.2" />
    </g>
  ),
  'ico-clock': (
    <g>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4V12l3.2 2" />
    </g>
  ),
  'ico-loop': (
    <g>
      <path d="M19.4 10.2A7.6 7.6 0 1 0 19.6 14" />
      <path d="M19.4 6.4v3.8h-3.8" />
    </g>
  ),
  'ico-flag': (
    <g>
      <path d="M6.2 20.4V4.6" />
      <path d="M6.2 5.2c3.8-2 6.4.6 9.8-.9v7c-3.4 1.5-6-1.1-9.8.9z" />
    </g>
  ),
  'ico-star': (
    <g>
      <path d="M12 3.6L14.12 9.09L19.99 9.4L15.42 13.11L16.94 18.8L12 15.6L7.06 18.8L8.58 13.11L4.01 9.4L9.88 9.09Z" />
    </g>
  ),
  'ico-scan': (
    <g>
      <circle cx="12" cy="12" r="5.6" />
      <path d="M12 12l4.2-4.2" />
      <path d="M9 3.4h6M3.4 9v6M15 20.6H9M20.6 15V9" />
    </g>
  ),
  'ico-swap': (
    <g>
      <path d="M8 6.6h8.4a3 3 0 0 1 0 6H11" />
      <path d="M14.8 4l2 2.6-2 2.4" />
      <path d="M16 17.4H7.6a3 3 0 0 1 0-6H13" />
      <path d="M9.2 20l-2-2.6 2-2.4" />
    </g>
  ),
  'ico-cross': (
    <g>
      <path d="M12 5.4v13.2M5.4 12h13.2" />
    </g>
  ),
  'ico-crane': (
    <g>
      <path d="M9 20.4V5" />
      <path d="M9 5h6.4" />
      <path d="M15.4 5v2.6" />
      <path d="M15.4 7.6v2.6M14 10.2h2.8" />
      <path d="M6.2 20.4h5.6" />
    </g>
  ),
  'ico-antenna': (
    <g>
      <path d="M5.6 14.4a7.8 7.8 0 0 1 12.8 0" />
      <path d="M12 14.4v5.2" />
      <path d="M9.6 19.6h4.8" />
      <circle cx="12" cy="10.6" r="1" />
    </g>
  ),
  'ico-tact': (
    <g>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12l4.2-4.2" />
      <path d="M9.6 8.4a4.4 4.4 0 0 1 2.4-1.2" />
    </g>
  ),
  'nav-haul': (
    <g>
      <rect x="4.6" y="10.2" width="9" height="7" rx="1.3" />
      <path d="M9.1 6.9v3.3" />
      <path d="M9.1 6.9l-1.8 1.8M9.1 6.9l1.8 1.8" />
      <path d="M15.6 13.7h3.6" />
      <path d="M17.4 11.9l1.8 1.8-1.8 1.8" />
    </g>
  ),
  'ico-hint': (
    <g>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.3v5.8" />
      <circle cx="12" cy="16.3" r="1" />
    </g>
  ),
  'ach-first': (
    <g>
      {/* 任务纪念徽：盾 + 中央星点 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M12 8.2l1.1 2.2 2.4.3-1.7 1.7.4 2.4-2.2-1.2-2.2 1.2.4-2.4-1.7-1.7 2.4-.3z" />
    </g>
  ),
  'ach-explorer': (
    <g>
      {/* 宇宙探索家：星图罗盘 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <circle cx="12" cy="10.6" r="3.2" />
      <path d="M12 8.4v4.4M9.8 10.6h4.4" />
    </g>
  ),
  'ach-digger': (
    <g>
      {/* 深空采掘者：镐与矿脉 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M8.4 12.6l3.4-3.4 3.4 3.4" />
      <path d="M11.8 9.2v6" />
    </g>
  ),
  'ach-scavenger': (
    <g>
      {/* 残骸拾荒者：断裂舱段 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M8.6 9.4h6.8v3.4H8.6z" />
      <path d="M11 9.4l-1.6 3.4M14 9.4l-1.6 3.4" />
    </g>
  ),
  'ach-mechanic': (
    <g>
      {/* 维修技师：扳手环 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M13.6 8.2a2.6 2.6 0 10-2.4 4.4l-2 2 .9.9 2-2a2.6 2.6 0 001.5-5.3z" />
    </g>
  ),
  'ach-hunter': (
    <g>
      {/* 赏金猎人：准星 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <circle cx="12" cy="10.8" r="2.6" />
      <path d="M12 6.6v1.6M12 13.4v1.6M7.8 10.8h1.6M14.6 10.8h1.6" />
    </g>
  ),
  'ach-refiner': (
    <g>
      {/* 精炼师：坩埚与滴液 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M8.6 9h6.8l-1.6 3.4H10.2z" />
      <path d="M12 12.4v2.2" />
    </g>
  ),
  'ach-lineboss': (
    <g>
      {/* 产线主管：传送带与齿轮 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <circle cx="12" cy="10.6" r="2.2" />
      <path d="M8.6 14.2h6.8" />
    </g>
  ),
  'ach-marketeer': (
    <g>
      {/* 市场老手：双向箭头 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M9 9.4h5.4l-1.4-1.4M15 12.4H9.6l1.4 1.4" />
    </g>
  ),
  'ach-shipwright': (
    <g>
      {/* 造船厂主：船体龙骨 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M8.4 11.6l3.6-2.2 3.6 2.2-3.6 1.6z" />
    </g>
  ),
  'ach-scholar': (
    <g>
      {/* 学而不厌：书册 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M9.2 8.6h5.6v4.6H9.2z" />
      <path d="M12 8.6v4.6" />
    </g>
  ),
  'ach-dispatch': (
    <g>
      {/* 舰队调度：三节点编队 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <circle cx="12" cy="8.8" r="1.4" />
      <circle cx="9.4" cy="12.8" r="1.4" />
      <circle cx="14.6" cy="12.8" r="1.4" />
    </g>
  ),
  'ach-freight': (
    <g>
      {/* 星际货运：货箱 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M9 9.2l3-1.6 3 1.6v3.4l-3 1.6-3-1.6z" />
    </g>
  ),
  'ach-abyss': (
    <g>
      {/* 深渊探索者：漩涡 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M12 7.6a3.2 3.2 0 103.2 3.2 2 2 0 10-2 2" />
    </g>
  ),
  'ach-mile-depth': (
    <g>
      {/* 深渊层深：向下的层叠箭标 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M12 7.4v7.2" />
      <path d="M9.4 12l2.6 2.6 2.6-2.6" />
    </g>
  ),
  'ach-mile-guard': (
    <g>
      {/* 层末守卫：交叉双刃 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M9 8.4l6 6.4M15 8.4l-6 6.4" />
    </g>
  ),
  'ach-mile-cache': (
    <g>
      {/* 高级箱：箱体与锁扣 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M8.6 10h6.8v3.6H8.6z" />
      <path d="M8.6 11.4h6.8" />
    </g>
  ),
  'ach-mile-core': (
    <g>
      {/* AI 核心：核与轨道环 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <circle cx="12" cy="11.2" r="1.6" />
      <path d="M8.8 11.2a3.2 3.2 0 106.4 0 3.2 3.2 0 00-6.4 0" />
    </g>
  ),
  'ach-mile-outpost': (
    <g>
      {/* 副空间站：站体与对接口 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <path d="M9.4 12.6V9.2h5.2v3.4" />
      <path d="M12 9.2V7" />
    </g>
  ),
  'ach-mile-tech': (
    <g>
      {/* 谜质科技：节点与连线 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      <circle cx="9.6" cy="9.4" r="1.2" />
      <circle cx="14.4" cy="13" r="1.2" />
      <path d="M10.6 10.2l2.8 2" />
      <path d="M12 12.4v2.8" />
    </g>
  ),
  'ach-ironman': (
    <g>
      {/* 盾徽底 */}
      <path d="M12 3.4l7 2.6v6.2c0 4-3 6.8-7 8.4-4-1.6-7-4.4-7-8.4V6z" />
      {/* 铁砧：砧面 + 左角 + 砧腰 + 底座 */}
      <path d="M9.2 9.4h5.6v1.6H9.2z" />
      <path d="M9.2 9.4l-1.7 1.6h1.7" />
      <path d="M11.1 11h1.8v2.2h-1.8z" />
      <path d="M9.4 13.2h5.2v1.4H9.4z" />
    </g>
  ),
  'ico-furnace': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.4 15.6V9.2h7.2v6.4z" />
      <path d="M10.2 15.6v-2.2a1.8 1.8 0 0 1 3.6 0v2.2" />
      <path d="M12 6.6V4.6M9.6 7.4 8.4 5.9M14.4 7.4l1.2-1.5" />
    </g>
  ),
  'ico-assembler': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M7.6 17.4v-3.2l3.4-1.6" />
      <path d="M11 12.6l3.4-2.2 2.6 1.6" />
      <circle cx="14.6" cy="9.4" r="1.6" />
      <path d="M16.2 9.4h2.2" />
    </g>
  ),
  'ico-drydock': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M5.6 10.2h12.8" />
      <path d="M7.4 10.2v6.4M16.6 10.2v6.4" />
      <path d="M9.4 15.4h5.2l-1 1.6h-3.2z" />
      <path d="M12 7.2v3" />
    </g>
  ),
  'ico-lab': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M10.4 6.4v4.2L8 15.6a1.2 1.2 0 0 0 1 1.8h6a1.2 1.2 0 0 0 1-1.8l-2.4-5V6.4" />
      <path d="M9.8 6.4h4.4" />
      <path d="M9.2 13.6h5.6" />
    </g>
  ),
  'ico-play': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M10.2 8.6l5 3.4-5 3.4z" />
    </g>
  ),
  'ico-stop': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="9.4" y="9.4" width="5.2" height="5.2" rx="0.8" />
    </g>
  ),
  'ico-eff': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M7.6 15.4a5.6 5.6 0 0 1 8.8 0" />
      <path d="M12 13.2l3-3.4" />
      <circle cx="12" cy="13.6" r="0.9" />
    </g>
  ),
  'ico-feed': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.4 8.4h7.2l-2.6 3.4v4.2l-2 1.6v-5.8z" />
    </g>
  ),
  'ico-fold': (
    <g>
      <path d="M5 6.4h14" />
      <path d="M12 19.2V9.6" />
      <path d="M8.6 13L12 9.6L15.4 13" />
    </g>
  ),
  'ico-unfold': (
    <g>
      <path d="M5 6.4h14" />
      <path d="M12 9.6v9.6" />
      <path d="M8.6 15.8L12 19.2L15.4 15.8" />
    </g>
  ),
  fallback: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="2.4" />
    </g>
  ),
}

const ADVANCED_PART_IDS = new Set([
  'part-drone-neural', 'part-shield-gen', 'part-jet-array', 'part-qchip',
  'part-keel', 'part-fire-control', 'part-grav-comp',
])

export function partToneKeyOf(itemId: string): string {
  return ADVANCED_PART_IDS.has(itemId) ? 'part-advanced' : 'part-basic'
}

SHAPES['part-basic'] = SHAPES.part
SHAPES['part-advanced'] = SHAPES.part

import { ICO_TONES, NAV_TONES, SCALARS, TONES } from './tones'

export { ICO_TONES, NAV_TONES, TONES }

export const ITEM_GLYPH_OVERRIDES: Readonly<Record<string, string>> = {
  'jump-fuel': 'ico-fuel',
  'invasion-beacon': 'ico-beacon',
  'invasion-beacon-r': 'ico-beacon',
  'invasion-beacon-c': 'ico-beacon',
  'invasion-beacon-h': 'ico-beacon',
  'invasion-beacon-d': 'ico-beacon',
  'synaptic-accelerant': 'ico-boost',
}

export function itemGlyphName(itemId: string | undefined, kind: string): string {
  return itemId !== undefined ? (ITEM_GLYPH_OVERRIDES[itemId] ?? kind) : kind
}

export const RARE_WRECK_TONE = SCALARS.RARE_WRECK_TONE

export function toneOf(key: string | undefined): string {
  return (key && TONES[key]) || 'rgb(var(--wui-dim))'
}

export function itemIconOf(itemId: string, kind?: string): string {
  if (itemId.startsWith('box-relic-')) return 'box-relic'
  if (itemId.startsWith('box-bp-')) return 'box-bp'
  if (itemId === 'box-valuables' || itemId === 'box-military') return itemId
  if (itemId.startsWith('ai-core-')) return 'ai-core'
  if (itemId.startsWith('mat-')) return itemId
  if (kind === 'part') return partToneKeyOf(itemId)
  return kind ?? 'fallback'
}

export function itemToneOf(itemId: string, iconKey: string): string {
  return TONES[itemId] ?? toneOf(iconKey)
}


export function inventoryItemTone(itemId: string, kind: string): string {
  if (kind === 'part') return toneOf(partToneKeyOf(itemId))
  return wreckTierOf(itemId) === 'rare' ? RARE_WRECK_TONE : toneOf(kind)
}

const MODERN_NAV_GLYPHS: Record<string, ComponentType<any>> = {
  'nav-ship': CarbonRocket,
  'nav-fit': CarbonChip,
  'nav-items': CarbonInventory,
  'nav-market': CarbonMarket,
  'nav-industry': CarbonIndustry,
  'nav-skills': CarbonSkills,
  'nav-task': CarbonTask,
  'nav-mail': CarbonMail,
  'nav-chat': CarbonChat,
  'nav-bounty': CarbonTarget,
  'nav-mine': CarbonMine,
  'nav-salvage': CarbonSalvage,
  'nav-ai': CarbonAi,
  'ico-scan': CarbonRadar,
}

export function Glyph({
  name,
  size = 26,
  color,
  className,
}: {
  name: string
  size?: number
  color?: string
  className?: string
}) {
  if (name === 'nav-chat' && !isModernLayout()) {
    return <MessageSquare size={size} strokeWidth={1.7} className={className} style={color ? { color } : undefined} aria-hidden="true" />
  }
  if (isModernLayout() && name === 'nav-exchange') {
    const layerStyle = (colorValue: string, clip: string): CSSProperties => ({
      position: 'absolute',
      inset: 0,
      color: colorValue,
      clipPath: clip,
    })
    return (
      <span
        className={className}
        aria-hidden="true"
        style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flex: '0 0 auto' }}
      >
        <CarbonChartCandlestick
          size={size}
          style={layerStyle('rgb(var(--wui-tone-loss))', 'inset(0 50% 0 0)')}
        />
        <CarbonChartCandlestick
          size={size}
          style={layerStyle('rgb(var(--wui-tone-gain))', 'inset(0 0 0 50%)')}
        />
      </span>
    )
  }

  if (isModernLayout()) {
    const ModernIcon = MODERN_NAV_GLYPHS[name]
    if (ModernIcon) {
      return (
        <ModernIcon
          size={size}
          fill={color ?? 'currentColor'}
          className={className}
          style={color ? { color } : undefined}
          aria-hidden="true"
        />
      )
    }
  }

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      style={{ stroke: color ?? 'currentColor' }}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[name] ?? SHAPES.fallback}
    </svg>
  )
}
