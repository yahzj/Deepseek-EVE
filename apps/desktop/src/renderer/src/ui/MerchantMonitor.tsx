import { useId } from 'react'
import { tr } from '../i18n/locale'

/** 屏幕信号层独立动画，不对整幅立绘做动态滤镜或React换帧。 */
export function MerchantMonitor({ mood }: { mood: 'idle' | 'pitch' | 'deal' }) {
  const id = useId().replace(/:/g, '')
  const clip = `merchant-screen-${id}`
  const scan = `merchant-scan-${id}`
  return <div className={`app-bm-monitor is-${mood}`} role="img" aria-label={tr('ui.blackMarket.023')}>
    <svg viewBox="0 0 420 350" className="app-bm-monitor-art" aria-hidden="true">
      <defs>
        <clipPath id={clip}><rect x="26" y="24" width="368" height="282" rx="12" /></clipPath>
        <pattern id={scan} x="0" y="0" width="4" height="5" patternUnits="userSpaceOnUse">
          <path d="M0 0H4" className="app-bm-scanline" />
        </pattern>
      </defs>
      <rect x="4" y="3" width="412" height="329" rx="17" className="app-bm-monitor-case" />
      <path d="M19 317V20Q19 15 25 15H395Q401 15 401 20V317" className="app-bm-monitor-rim" />
      <rect x="26" y="24" width="368" height="282" rx="12" className="app-bm-monitor-glass" />
      <g clipPath={`url(#${clip})`}>
        <path d="M45 67H76M45 67V87M375 67H344M375 67V87M45 275H76M45 275V255M375 275H344M375 275V255" className="app-bm-screen-guide" />
        <g className="app-bm-merchant-image">
          <path d="M174 173L179 209L166 230L142 246L129 301H306L282 249L249 232L239 209L247 171Z" className="app-bm-robot-joint" />
          <g className="app-bm-robot-neck">
            <path d="M191 187L191 215L200 236M228 189L229 216L221 236M205 195L208 232M216 195L214 232" className="app-bm-robot-cable" />
            <path d="M183 207Q210 217 238 206L239 219Q211 231 181 219ZM183 225Q212 236 238 224L236 236Q212 247 184 235Z" className="app-bm-robot-plate" />
            <path d="M197 215L196 223M210 218V228M224 215L225 225" className="app-bm-robot-seam" />
          </g>
          <g className="app-bm-robot-shoulders">
            <path d="M166 221L112 236L78 271L85 297H141L155 254L184 242Z" className="app-bm-robot-plate" />
            <path d="M246 220L291 233L330 266L332 297H278L264 252L234 243Z" className="app-bm-robot-plate" />
            <path d="M165 243L146 270L149 302H274L273 267L251 243L215 260L205 260Z" className="app-bm-robot-plate" />
            <path d="M122 244L101 264L104 278H134L142 258M287 242L311 265L305 280H281L277 258M174 251L173 278L204 290M248 251L249 278L219 290M211 267V302" className="app-bm-robot-seam" />
            <path d="M89 287H133M287 287H322M165 287L179 294M167 293L178 299M239 295H262M239 301H259" className="app-bm-robot-detail" />
            <circle cx="136" cy="245" r="5" className="app-bm-robot-port" /><circle cx="282" cy="244" r="5" className="app-bm-robot-port" />
            <path d="M207 248L212 245L217 248V253L212 256L207 253Z" className="app-bm-robot-port" />
          </g>
          <g className="app-bm-robot-head" transform={mood === 'pitch' ? 'rotate(-2 212 210)' : mood === 'deal' ? 'rotate(1 212 210)' : undefined}>
            <path d="M162 70C133 51 110 68 106 104C101 139 117 174 110 202C106 219 92 222 91 208C88 222 92 242 106 245C133 250 140 213 135 185C130 151 142 126 163 115Z" className="app-bm-merchant-tentacle" />
            <path d="M254 57C287 46 310 72 316 113C320 146 302 172 309 200C313 215 329 209 328 198C341 217 332 239 315 236C289 234 279 197 288 166C295 133 276 115 256 105Z" className="app-bm-merchant-tentacle" />
            <path d="M155 76Q145 40 184 30Q224 18 260 44Q280 63 276 103L263 162L244 191L216 205L188 191L163 166L151 113Z" className="app-bm-robot-joint" />
            <path d="M159 94L171 58L208 40L247 52L265 86L262 126L248 160L215 173L181 158L162 128Z" className="app-bm-robot-plate" />
            <path d="M171 58L197 61L210 42M197 61L190 90M197 61L233 62L250 84M215 44L215 85M169 97L185 93M239 95L257 97" className="app-bm-robot-seam" />
            <path d="M176 62L187 55L182 83L171 90ZM224 49L243 58L248 76L235 65Z" className="app-bm-robot-highlight" />
            <path d="M144 98L155 91L162 103L161 150L153 165L143 151ZM268 97L282 101L286 141L274 158L263 143Z" className="app-bm-robot-plate" />
            <circle cx="152" cy="124" r="8" className="app-bm-robot-joint" /><circle cx="274" cy="124" r="8" className="app-bm-robot-joint" />
            <circle cx="152" cy="124" r="4" className="app-bm-robot-port" /><circle cx="274" cy="124" r="4" className="app-bm-robot-port" />
            <path d="M164 140L181 143L190 157L198 184L215 192L232 184L242 157L259 138L262 158L244 182L230 199L214 204L195 198L176 179L161 155Z" className="app-bm-robot-plate" />
            <path d="M164 148L178 153L185 169L177 173M258 146L247 154L242 170L248 174M198 184L197 194M232 184L234 194M202 195L215 200L226 195" className="app-bm-robot-seam" />
            <path d="M167 104L177 100L196 102L202 111L190 123L171 121L165 114ZM221 108L237 101L254 104L260 114L250 123L231 120Z" className="app-bm-robot-eye-socket" />
            <g className="app-bm-merchant-eyes">
              <path d="M170 112Q184 107 197 112Q184 120 172 117ZM227 112Q240 106 255 113Q243 121 231 117Z" />
              <circle cx={mood === 'idle' ? 184 : 187} cy="113" r="3.5" className="app-bm-robot-iris" />
              <circle cx={mood === 'idle' ? 241 : 244} cy="113" r="3.5" className="app-bm-robot-iris" />
              <circle cx="188" cy="112" r="1" className="app-bm-robot-glint" /><circle cx="245" cy="112" r="1" className="app-bm-robot-glint" />
            </g>
            <path d="M211 111L203 142L208 147H220L225 142L218 113M207 150L215 153L222 149" className="app-bm-robot-seam" />
            <path d="M196 159L203 156H224L234 157L228 166H201Z" className="app-bm-robot-eye-socket" />
            <path d={mood === 'deal' ? 'M202 160L215 163L228 159' : mood === 'pitch' ? 'M202 161H217L228 158' : 'M203 161H227'} className="app-bm-merchant-mouth" />
            <path d="M165 128L182 132M167 134L181 138M241 133L258 129M242 139L255 135M205 176H225" className="app-bm-robot-detail" />
            <path d="M155 54C159 35 183 28 202 31C211 55 183 68 173 95C168 107 162 114 156 105C148 91 148 70 155 54Z" className="app-bm-merchant-tentacle" />
            <path d="M231 31C254 29 275 47 280 70C284 91 273 109 269 130C263 150 284 160 289 145C286 163 269 174 258 159C244 141 252 120 256 102C262 75 243 64 231 54Z" className="app-bm-merchant-tentacle" />
            <path d="M159 51L168 44L174 60L164 69ZM233 33L244 36L254 51L243 56Z" className="app-bm-robot-port" />
            <g className="app-bm-robot-suckers">
              <ellipse cx="116" cy="119" rx="4" ry="7" /><ellipse cx="120" cy="143" rx="4" ry="7" /><ellipse cx="122" cy="168" rx="4" ry="7" /><ellipse cx="119" cy="191" rx="4" ry="7" />
              <ellipse cx="304" cy="116" rx="4" ry="7" /><ellipse cx="299" cy="139" rx="4" ry="7" /><ellipse cx="297" cy="162" rx="4" ry="7" /><ellipse cx="299" cy="186" rx="4" ry="7" />
              <ellipse cx="165" cy="81" rx="3" ry="5" /><ellipse cx="165" cy="95" rx="3" ry="5" /><ellipse cx="265" cy="123" rx="3" ry="5" /><ellipse cx="263" cy="138" rx="3" ry="5" />
            </g>
          </g>
        </g>
        <rect x="26" y="24" width="368" height="282" rx="12" fill={`url(#${scan})`} />
        <g className="app-bm-signal-band">
          <path d="M26 50H394M26 54H394M26 61H394" />
          <rect x="26" y="48" width="368" height="18" />
        </g>
        <path d="M33 30H181L34 166Z" className="app-bm-screen-reflection" />
      </g>
      <path d="M30 318H140M280 318H363M35 324H135M285 324H357" className="app-bm-monitor-vents" />
      <circle cx="378" cy="319" r="4" className="app-bm-monitor-led" />
      <path d="M178 332V340H242V332M153 345H267" className="app-bm-monitor-stand" />
    </svg>
  </div>
}
