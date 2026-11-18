import { useEffect, useState } from 'react'
import type { CompanyInfo, CompanyReport, ExchangeClient } from '../client'
import { T } from '../texts'

type BusinessMood = 'hot' | 'steady' | 'cooling' | 'loss'
type Outlook = 'up' | 'flat' | 'down'

function businessMood(report: CompanyReport | undefined): BusinessMood | null {
  if (!report) return null
  if (report.gross <= 0) return 'loss'
  if (report.grossDeltaBp >= 200) return 'hot'
  if (report.grossDeltaBp <= -200) return 'cooling'
  return 'steady'
}

function outlookOf(anchorShiftBp: number): Outlook {
  if (anchorShiftBp > 0) return 'up'
  if (anchorShiftBp < 0) return 'down'
  return 'flat'
}

function moodLabel(mood: BusinessMood | null): string {
  switch (mood) {
    case 'hot':
      return T.companyHot
    case 'steady':
      return T.companySteady
    case 'cooling':
      return T.companyCooling
    case 'loss':
      return T.companyLoss
    default:
      return T.companyNoReport
  }
}

function moodReason(mood: BusinessMood | null): string {
  switch (mood) {
    case 'hot':
      return T.companyReasonMore
    case 'steady':
      return T.companyReasonSame
    case 'cooling':
    case 'loss':
      return T.companyReasonLess
    default:
      return ''
  }
}

function outlookLabel(outlook: Outlook): string {
  switch (outlook) {
    case 'up':
      return T.companyOutlookUp
    case 'down':
      return T.companyOutlookDown
    default:
      return T.companyOutlookFlat
  }
}

export function CompanyPanel({ client }: { client: ExchangeClient }) {
  const [companies, setCompanies] = useState<CompanyInfo[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const pull = (): void => {
      if (!client.getCompanies) return
      client
        .getCompanies()
        .then((rows) => {
          if (!alive) return
          setCompanies(rows)
          setFailed(false)
        })
        .catch(() => {
          if (alive) setFailed(true)
        })
    }
    pull()
    const timer = window.setInterval(pull, 30_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [client])

  return (
    <div className="ex-company-panel">
      <div className="ex-company-head">
        <span className="ex-company-title">{T.companyTitle}</span>
        <span className="ex-dim ex-company-hint">{T.companyHint}</span>
      </div>
      {companies.length === 0 ? (
        <div className="ex-company-empty ex-dim">{failed ? T.companyLoadFailed : T.companyHint}</div>
      ) : (
        <div className="ex-company-list">
          {companies.map((company) => {
            const mood = businessMood(company.lastReport)
            const outlook = outlookOf(company.anchorShiftBp)
            return (
              <div className="ex-company-row" key={company.company}>
                <div className="ex-company-row-head">
                  <span className="ex-company-name">
                    {company.name}
                    <span className="ex-company-sector ex-dim">{company.sector}</span>
                  </span>
                  <span className={`ex-company-mood is-${mood ?? 'none'}`}>{moodLabel(mood)}</span>
                </div>
                {mood !== null ? (
                  <div className="ex-company-row-body">
                    <span className="ex-dim">{moodReason(mood)}</span>
                    <span className={`ex-company-outlook is-${outlook}`}>{outlookLabel(outlook)}</span>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
