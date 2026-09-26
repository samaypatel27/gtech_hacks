import { useEffect, useRef, useState } from 'react'
import Button from '../Button/Button.jsx'
import styles from './DrugMaker.module.css'

// Minimum time to hold the loading state so a fast response doesn't flash.
const MIN_LOADING_MS = 600
// Form fade+scale-out before it's removed from the layout.
const FORM_EXIT_MS = 220
// Success sequence stages (sum is the "roughly 1.2s total" from the spec).
const RING_CLOSE_MS = 250
const CHECK_DRAW_MS = 450
const POP_MS = 250

const STATUS_TEXT = {
  idle: 'Waiting',
  loading: 'Loading…',
  success: 'Done',
  error: 'Failed',
}

function usesReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function StatusRow({ label, status, message }) {
  return (
    <li className={styles.statusRow}>
      <span className={`${styles.dot} ${styles[status]}`} />
      <span className={styles.statusLabel}>{label}</span>
      <span className={styles.statusMessage}>{message || STATUS_TEXT[status]}</span>
    </li>
  )
}

// The existing per-endpoint debug output. Logic untouched -- only its
// placement (fixed, bottom-right) and size have changed, per spec. Rendered
// as a sibling of the form/result states so it stays visible regardless of
// which of those is currently mounted.
function DebugLog({ results, saveResult }) {
  const hasRun = results.some((r) => r.status !== 'idle')
  if (!hasRun) return null

  return (
    <ul className={styles.debugLog} aria-label="Launch endpoint log">
      {results.map((r) => (
        <StatusRow key={r.key} label={r.label} status={r.status} message={r.message} />
      ))}
      <StatusRow label="Save to database" status={saveResult.status} message={saveResult.message} />
    </ul>
  )
}

// One 64px ring, reused across loading (spinning accent arc), success
// (settled green circle) and error (settled red circle).
function Ring({ mode, reduced }) {
  const isSpinning = mode === 'spinning'
  const stroke = mode === 'error' ? '#e06b6b' : mode === 'done' ? '#34D399' : '#8c96dc'

  return (
    <svg
      className={styles.ringSvg}
      viewBox="0 0 64 64"
      role={isSpinning ? 'status' : undefined}
      aria-label={isSpinning ? 'Sending drug' : undefined}
      aria-hidden={isSpinning ? undefined : true}
    >
      <circle className={styles.track} cx="32" cy="32" r="28" />
      <circle
        className={`${styles.arc} ${isSpinning && !reduced ? styles.spinning : ''}`}
        cx="32"
        cy="32"
        r="28"
        pathLength="1"
        style={{
          strokeDashoffset: isSpinning ? 0.3 : 0,
          stroke,
          transition: reduced ? 'none' : 'stroke-dashoffset 250ms ease, stroke 250ms ease',
        }}
      />
    </svg>
  )
}

function CheckMark({ visible, reduced }) {
  return (
    <svg className={styles.checkSvg} viewBox="0 0 52 52" aria-hidden="true">
      <path
        d="M14 27 L22 35 L38 17"
        fill="none"
        stroke="#34D399"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1"
        style={{
          strokeDasharray: 1,
          strokeDashoffset: visible ? 0 : 1,
          transition: reduced ? 'none' : `stroke-dashoffset ${CHECK_DRAW_MS}ms ease-out`,
        }}
      />
    </svg>
  )
}

function XMark({ reduced }) {
  return (
    <svg className={styles.checkSvg} viewBox="0 0 52 52" aria-hidden="true">
      <path
        d="M16 16 L36 36 M36 16 L16 36"
        fill="none"
        stroke="#e06b6b"
        strokeWidth="4"
        strokeLinecap="round"
        pathLength="1"
        className={reduced ? '' : styles.xDraw}
        style={{ strokeDasharray: 1 }}
      />
    </svg>
  )
}

function DrugMaker({ onSubmit, isSubmitting, results, saveResult }) {
  const [drugName, setDrugName] = useState('')
  const [applicationId, setApplicationId] = useState('')

  // "idle" | "loading" | "success" | "error" -- the launch status from spec.
  const [status, setStatus] = useState('idle')
  // "visible" | "exiting" | "gone" -- drives the form's own exit choreography.
  const [formPhase, setFormPhase] = useState('visible')
  // 0: ring closing, 1: check drawing, 2: popped, 3: text shown.
  const [checkStep, setCheckStep] = useState(0)
  const [frozenHeight, setFrozenHeight] = useState(null)

  const formRef = useRef(null)
  const loadingStartRef = useRef(0)
  const wasSubmittingRef = useRef(false)
  const [reducedMotion] = useState(usesReducedMotion)

  const canSubmit = drugName.trim() && applicationId.trim() && status === 'idle'

  // Detects when the existing launch logic (all requests + the save) has
  // fully settled, by watching the isSubmitting prop flip back to false --
  // avoids reading a stale saveResult from inside an awaited closure.
  useEffect(() => {
    const wasSubmitting = wasSubmittingRef.current
    wasSubmittingRef.current = isSubmitting

    if (wasSubmitting && !isSubmitting && status === 'loading') {
      const elapsed = Date.now() - loadingStartRef.current
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed)
      const finalStatus = saveResult.status === 'success' ? 'success' : 'error'
      const timer = setTimeout(() => setStatus(finalStatus), remaining)
      return () => clearTimeout(timer)
    }
  }, [isSubmitting, saveResult, status])

  // Stages the check-draw / pop / text sequence once status is "success".
  useEffect(() => {
    if (status !== 'success') return

    if (reducedMotion) {
      setCheckStep(3)
      return
    }

    setCheckStep(0)
    const t1 = setTimeout(() => setCheckStep(1), RING_CLOSE_MS)
    const t2 = setTimeout(() => setCheckStep(2), RING_CLOSE_MS + CHECK_DRAW_MS)
    const t3 = setTimeout(() => setCheckStep(3), RING_CLOSE_MS + CHECK_DRAW_MS + POP_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [status, reducedMotion])

  const handleLaunch = (e) => {
    e.preventDefault()
    if (status !== 'idle' || !canSubmit) return

    const height = formRef.current?.getBoundingClientRect().height
    if (height) setFrozenHeight(height)

    setStatus('loading')
    loadingStartRef.current = Date.now()
    setFormPhase('exiting')

    // Existing launch logic, unchanged -- it awaits every request it makes
    // (Promise.allSettled) plus the save, and signals completion via the
    // isSubmitting prop, which the effect above watches.
    onSubmit({ drugName: drugName.trim(), applicationId: applicationId.trim() })

    setTimeout(() => setFormPhase('gone'), FORM_EXIT_MS)
  }

  const handleReset = () => {
    setStatus('idle')
    setFormPhase('visible')
    setFrozenHeight(null)
    setCheckStep(0)
  }

  const errorReason = status === 'error' ? saveResult.message : ''
  const announce = status === 'success' && checkStep >= 3 ? 'Drug sent' : status === 'error' ? 'Launch failed' : ''

  return (
    <div className={styles.stage} style={{ minHeight: frozenHeight ? `${frozenHeight}px` : undefined }}>
      {formPhase !== 'gone' && (
        <form
          ref={formRef}
          className={`${styles.panel} ${formPhase === 'exiting' ? styles.panelExiting : ''}`}
          onSubmit={handleLaunch}
        >
          <h1 className={styles.title}>Drug maker</h1>

          <label className={styles.field}>
            <span className={styles.label}>Drug name</span>
            <input
              type="text"
              className={styles.input}
              value={drugName}
              onChange={(e) => setDrugName(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Application ID</span>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. BLA125706"
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
            />
          </label>

          <Button type="submit" className={styles.launchButton} disabled={!canSubmit}>
            Launch drug
          </Button>
        </form>
      )}

      {status === 'loading' && (
        <div className={styles.resultStage}>
          <div className={styles.iconStage}>
            <Ring mode="spinning" reduced={reducedMotion} />
          </div>
        </div>
      )}

      {status === 'success' && (
        <div className={styles.resultStage}>
          <div className={`${styles.iconStage} ${checkStep >= 2 && !reducedMotion ? styles.pop : ''}`}>
            <Ring mode="done" reduced={reducedMotion} />
            <CheckMark visible={checkStep >= 1} reduced={reducedMotion} />
          </div>

          {checkStep >= 3 && (
            <>
              <p className={styles.successText}>Drug sent</p>
              <Button className={styles.launchAnotherButton} onClick={handleReset}>
                Launch another drug
              </Button>
            </>
          )}
        </div>
      )}

      {status === 'error' && (
        <div className={styles.resultStage}>
          <div className={styles.iconStage}>
            <Ring mode="error" reduced={reducedMotion} />
            <XMark reduced={reducedMotion} />
          </div>

          <p className={styles.errorText}>Launch failed</p>
          {errorReason && <p className={styles.errorReason}>{errorReason}</p>}

          <Button className={styles.tryAgainButton} onClick={handleReset}>
            Try again
          </Button>
        </div>
      )}

      <div aria-live="polite" className={styles.srOnly}>
        {announce}
      </div>

      <DebugLog results={results} saveResult={saveResult} />
    </div>
  )
}

export default DrugMaker
