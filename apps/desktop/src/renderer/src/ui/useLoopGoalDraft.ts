import { useEffect, useRef, useState } from 'react'

export function useLoopGoalDraft(submitOnUnmount: (goal: number | null) => void): {
  draft: string
  typeDraft: (v: string) => void
  clearDraft: () => void
  clearTouched: () => void
  commitDraft: (text: string, submit: (goal: number | null) => void) => void
} {
  const [draft, setDraft] = useState('')
  const draftRef = useRef('')
  draftRef.current = draft
  const touchedRef = useRef(false)
  const submitRef = useRef(submitOnUnmount)
  submitRef.current = submitOnUnmount
  useEffect(
    () => () => {
      if (!touchedRef.current) return
      const n = Number.parseInt(draftRef.current, 10)
      submitRef.current(Number.isFinite(n) && n > 0 ? n : null)
    },
    [],
  )
  return {
    draft,
    typeDraft: (v) => {
      touchedRef.current = true
      setDraft(v)
    },
    clearDraft: () => setDraft(''),
    clearTouched: () => {
      touchedRef.current = false
    },
    commitDraft: (text, submit) => {
      touchedRef.current = false
      setDraft('')
      const n = Number.parseInt(text, 10)
      submit(Number.isFinite(n) && n > 0 ? n : null)
    },
  }
}
