/** 功能域职责拆分，保持原计算与顺序。 */
import type { ReactNode } from 'react'
import { A_SKIFF, A_CORVETTE, A_RAIDER, A_SNIPER, A_WARLORD, B_SKIFF, B_ARMED } from './piratesScavengers'
import { C_RIFT_LARVA, C_SC_LARVA, C_SC_ADULT, C_SPORE_HIVE, C_MAW } from './alien'
import { D_GHOST, D_LONGSHIP, D_STASIS, D_THRONE, D_PATROL, D_BASTION, D_OATHKEEPER, D_ETERNAL_TOMB } from './gravekeeper'
import { E_MISSILE, E_AURO, E_TITAN, E_CORE } from './titan'
import { G_SKIFF, G_ECHO, G_NADIR, G_TENDER, G_EXILE } from './remnant'
import { H_CORVETTE, H_TORPEDO, H_JAMMER, H_BATTLECRUISER, H_FLAGSHIP } from './ink'
import { R_GLINT, R_ECHO, R_OVERLAY, R_DUSK, R_NEXUS } from './corona'

/**
 * 键 = `packages/data/src/foe-ships.ts` 的 `id`（35 条一一对应）。
 * 未收录的敌舰 → 回退族形 `FOE_ART[族字母]` → 再回退 role 剪影（链路见 `ShipSprite.tsx`）。
 */
export const FOE_SHIP_ART: Record<string, ReactNode> = {
  'foe-alien-acid-burster': (
    <>
      <path d="M54 56 C66 28 104 22 132 38 C158 22 190 34 199 52 L219 43 L210 60 L222 78 L200 69 C188 90 154 91 132 76 C99 91 69 82 54 64 Z" />
      <ellipse className="shipart-acc" cx="116" cy="57" rx="31" ry="21" />
      <path className="shipart-panel" d="M76 37 Q67 24 48 29 M76 79 Q62 96 43 86 M154 33 L149 51 M158 82 L149 65 M185 43 L178 55" />
      <path className="shipart-accf" d="M181 56 L198 59 L183 66 Z" />
    </>
  ),
  'foe-alien-brood-worker': (
    <>
      <path d="M35 54 Q45 39 74 41 Q93 24 121 33 Q153 26 177 45 L205 37 L221 50 L208 59 L223 75 L206 87 L175 76 Q138 91 112 82 Q87 91 68 76 Q38 78 35 54 Z" />
      <path className="shipart-panel" d="M69 42 Q88 61 69 77 M107 35 Q125 61 110 82 M149 35 Q165 61 149 83 M177 46 Q182 61 176 75" />
      <ellipse className="shipart-acc" cx="93" cy="60" rx="13" ry="19" />
      <path className="shipart-acc" d="M159 49 Q194 24 218 31 M160 72 Q190 102 220 94 M181 58 L213 57 M182 66 L213 70" />
    </>
  ),
  'foe-alien-hiveback': (
    <>
      <path d="M25 58 Q34 37 61 37 Q84 11 126 19 Q171 9 194 42 Q214 43 224 55 L214 66 L221 80 L194 87 Q159 108 114 94 Q75 101 57 80 Q27 82 25 58 Z" />
      <path className="shipart-panel" d="M57 38 Q80 60 57 80 M98 21 Q113 63 97 96 M142 18 Q159 58 141 99 M181 30 Q195 65 180 93" />
      {[76, 113, 151, 180].map(x => <ellipse key={x} className="shipart-acc" cx={x} cy="55" rx="10" ry="17" />)}
      <path className="shipart-accf" d="M204 52 L224 57 L204 62 Z" />
      <path className="shipart-panel" d="M38 42 L24 28 M38 78 L22 93 M80 24 L70 11 M155 20 L164 6" />
    </>
  ),
  'foe-alien-broodmother': (
    <>
      <path d="M13 55 Q25 27 62 30 Q93 3 125 14 Q158 1 190 25 L214 34 L233 46 L219 59 L234 73 L213 88 L189 93 Q150 111 120 96 Q83 109 54 86 Q23 83 13 55 Z" />
      <path className="shipart-panel" d="M60 31 Q77 58 55 86 M94 17 Q109 57 90 99 M134 12 Q151 57 131 100 M175 18 Q190 56 174 98" />
      {[67, 98, 129, 160, 187].map(x => <g key={x}><ellipse className="shipart-acc" cx={x} cy="46" rx="9" ry="12" /><ellipse className="shipart-acc" cx={x} cy="73" rx="9" ry="12" /></g>)}
      <path d="M20 42 Q7 25 20 14 L49 30 M20 78 Q4 96 20 106 L51 86 M82 20 L81 5 M159 18 L172 5" />
      <path className="shipart-accf" d="M206 40 L231 46 L207 51 Z M207 71 L232 77 L207 82 Z" />
    </>
  ),
  // A 族 · 海盗
  'foe-pirate-skiff': A_SKIFF,
  'foe-pirate-corvette': A_CORVETTE,
  'foe-pirate-raider': A_RAIDER,
  'foe-pirate-sniper': A_SNIPER,
  'foe-pirate-warlord': A_WARLORD,
  // B 族 · 拾荒
  'foe-scav-skiff': B_SKIFF,
  'foe-scav-armed': B_ARMED,
  // C 族 · 异形
  'foe-alien-rift-larva': C_RIFT_LARVA,
  'foe-alien-starcore-larva': C_SC_LARVA,
  'foe-alien-starcore-adult': C_SC_ADULT,
  'foe-alien-spore-hive': C_SPORE_HIVE,
  'foe-alien-maw': C_MAW,
  // D 族 · 守墓古舰
  'foe-d-ghost': D_GHOST,
  'foe-d-longship': D_LONGSHIP,
  'foe-d-stasis': D_STASIS,
  'foe-d-throne': D_THRONE,
  'foe-d-invasion-cruiser': D_PATROL,
  'foe-d-invasion-bastion': D_BASTION,
  'foe-d-invasion-oathkeeper': D_OATHKEEPER,
  'foe-d-invasion-eternal-tomb': D_ETERNAL_TOMB,
  // E 族 · 泰坦巨构
  'foe-missile-hulk': E_MISSILE,
  'foe-auro-hulk': E_AURO,
  'foe-titan-hulk': E_TITAN,
  'foe-core-section': E_CORE,
  // G 族 · 鱿鱼亡军
  'foe-g-swarm-skiff': G_SKIFF,
  'foe-g-echo-remnant': G_ECHO,
  'foe-g-nadir-lock': G_NADIR,
  'foe-g-remnant-tender': G_TENDER,
  'foe-g-exile-battleship': G_EXILE,
  // H 族 · 墨潮帮（v3 几何原样搬入）
  'foe-h-ink-corvette': H_CORVETTE,
  'foe-h-ink-torpedo': H_TORPEDO,
  'foe-h-ink-jammer': H_JAMMER,
  'foe-h-ink-battlecruiser': H_BATTLECRUISER,
  'foe-h-ink-flagship': H_FLAGSHIP,
  // R 族 · 光环科技（2026-10-03 补：此前五档全部落 role 兜底剪影）
  'foe-r-corona-glint': R_GLINT,
  'foe-r-corona-echo': R_ECHO,
  'foe-r-corona-overlay': R_OVERLAY,
  'foe-r-corona-dusk': R_DUSK,
  'foe-r-corona-nexus': R_NEXUS,
}
