import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import Button from '../components/Button/Button.jsx'
import AuthStatus from '../components/AuthStatus/AuthStatus.jsx'
import { useAuthSession } from '../lib/useAuthSession.js'
import {
  fetchPatient,
  savePatientNote,
  createTreatment,
  runDocCheck,
  signTreatment,
} from '../api/patients.js'
import styles from './PatientChartPage.module.css'

const NOTE_SAVE_DEBOUNCE_MS = 600

// Doctor's patient chart (ProductSpec2 Steps 8-9): patient info, an editable
// visit note, New Order, the documentation-check sidebar, and Sign. Gated
// behind sign-in, same as the rest of /doctor/* (DoctorPage.jsx).
function PatientChartPage() {
  const { patientId } = useParams()
  const [searchParams] = useSearchParams()
  const practiceDrugId = searchParams.get('pd')
  const applicationId = searchParams.get('applicationId')
  const navigate = useNavigate()
  const { email, loading: authLoading } = useAuthSession()

  const [patient, setPatient] = useState(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [treatment, setTreatment] = useState(null) // the in-progress order, once created
  const [orderError, setOrderError] = useState(null)
  const [ordering, setOrdering] = useState(false)

  const [checks, setChecks] = useState(null) // documentation-check results
  const [draftText, setDraftText] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState(null)

  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState(null)
  const [signed, setSigned] = useState(false)

  const saveTimerRef = useRef(null)
  const lastSavedNoteRef = useRef('')

  useEffect(() => {
    if (!authLoading && !email) navigate('/doctor', { replace: true })
  }, [authLoading, email, navigate])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchPatient(patientId)
      .then((data) => {
        if (cancelled) return
        setPatient(data)
        setNote(data.visit_note ?? '')
        lastSavedNoteRef.current = data.visit_note ?? ''
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [patientId])

  // Re-runs the documentation check against whatever note is saved right now
  // -- this is the "editing the note live flips a check" demo moment
  // (ProductSpec2 Step 9's demo note).
  const refreshChecks = useCallback(
    async (treatmentId) => {
      if (!treatmentId) return
      setChecking(true)
      setCheckError(null)
      try {
        const result = await runDocCheck(treatmentId)
        setChecks(result.checks ?? [])
        setDraftText(result.draft_text ?? '')
      } catch (err) {
        setCheckError(err.message)
      } finally {
        setChecking(false)
      }
    },
    [],
  )

  const handleNoteChange = (value) => {
    setNote(value)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (value === lastSavedNoteRef.current) return
      try {
        await savePatientNote(patientId, value)
        lastSavedNoteRef.current = value
        // Once an order exists, every saved edit re-checks the note live.
        if (treatment?.id) refreshChecks(treatment.id)
      } catch {
        // Non-fatal: the note stays in the textarea and the next debounce
        // (or another edit) tries the save again.
      }
    }, NOTE_SAVE_DEBOUNCE_MS)
  }

  const handleNewOrder = async () => {
    setOrdering(true)
    setOrderError(null)
    try {
      const created = await createTreatment({ patientId, applicationId, practiceDrugId })
      setTreatment(created)
      await refreshChecks(created.id)
    } catch (err) {
      setOrderError(err.message)
    } finally {
      setOrdering(false)
    }
  }

  const handleSign = async () => {
    if (!treatment?.id) return
    setSigning(true)
    setSignError(null)
    try {
      const result = await signTreatment(treatment.id)
      setTreatment(result)
      setSigned(true)
    } catch (err) {
      setSignError(err.message)
    } finally {
      setSigning(false)
    }
  }

  if (authLoading || !email) return null

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <BackButton to="/doctor/drugs" inline />
        </div>
        <div className={styles.layout}>
          <p className={styles.status}>Loading patient…</p>
        </div>
      </div>
    )
  }

  if (loadError || !patient) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <BackButton to="/doctor/drugs" inline />
        </div>
        <div className={styles.layout}>
          <p className={styles.status}>Could not load patient: {loadError ?? 'not found'}</p>
        </div>
      </div>
    )
  }

  const allChecksPassed = checks && checks.length > 0 && checks.every((c) => c.passed)
  const dose = treatment?.dose
  const vialMix = treatment?.vial_mix

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <BackButton to="/doctor/drugs" inline />
        <AuthStatus inline />
      </div>

      <div className={styles.layout}>
        <div className={styles.main}>
          <h1 className={styles.title}>{patient.name}</h1>
          <p className={styles.meta}>
            {patient.dob ? `DOB ${patient.dob}` : null}
            {patient.weight_kg ? ` · ${patient.weight_kg} kg` : null}
            {patient.diagnosis ? ` · ${patient.diagnosis}` : null}
          </p>
          <p className={styles.meta}>
            {patient.insurance ? `${patient.insurance}` : 'No insurer on file'}
            {patient.member_id ? ` · Member ID ${patient.member_id}` : null}
          </p>

          <div className={styles.noteSection}>
            <span className={styles.label}>Visit note</span>
            <textarea
              className={styles.noteArea}
              value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
              placeholder="Paste or type the visit note…"
              rows={14}
            />
          </div>

          {!treatment ? (
            <>
              <Button className={styles.primaryButton} onClick={handleNewOrder} disabled={ordering}>
                {ordering ? 'Calculating dose…' : 'New Order'}
              </Button>
              {orderError && <p className={styles.error}>{orderError}</p>}
            </>
          ) : (
            <div className={styles.orderSummary}>
              <span className={styles.label}>Order</span>
              <p className={styles.doseLine}>
                {dose?.amount != null ? `${dose.amount} ${dose.unit ?? 'mg'}` : '—'}
                {vialMix?.vials != null &&
                  ` · ${vialMix.vials} × ${vialMix.vial_size_mg} mg`}
                {vialMix?.waste_mg != null && ` · ${vialMix.waste_mg} mg waste`}
              </p>

              {signed || treatment.status === 'signed' ? (
                <p className={styles.signedNote}>Signed{treatment.signed_at ? ` at ${treatment.signed_at}` : ''}.</p>
              ) : (
                <>
                  <Button
                    className={styles.primaryButton}
                    onClick={handleSign}
                    disabled={signing || !allChecksPassed}
                  >
                    {signing ? 'Signing…' : 'Sign order'}
                  </Button>
                  {!allChecksPassed && checks && (
                    <p className={styles.hint}>
                      Ready for typical payer requirements once every item below is checked.
                    </p>
                  )}
                  {signError && <p className={styles.error}>{signError}</p>}
                </>
              )}
            </div>
          )}
        </div>

        {treatment && (
          <aside className={styles.sidebar}>
            <span className={styles.label}>Documentation for payers</span>
            {checking && <p className={styles.status}>Checking…</p>}
            {checkError && <p className={styles.error}>{checkError}</p>}
            {checks && (
              <ul className={styles.checkList}>
                {checks.map((check) => (
                  <li key={check.id} className={styles.checkItem}>
                    <span className={check.passed ? styles.checkDot : `${styles.checkDot} ${styles.checkDotFail}`}>
                      {check.passed ? '✓' : '✗'}
                    </span>
                    <div className={styles.checkBody}>
                      <p className={styles.checkLabel}>{check.label}</p>
                      {check.quote && <p className={styles.checkQuote}>&ldquo;{check.quote}&rdquo;</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {draftText && (
              <div className={styles.draftBox}>
                <span className={styles.label}>Draft addition</span>
                <p className={styles.draftText}>{draftText}</p>
                <Button
                  className={styles.secondaryButton}
                  onClick={() => {
                    handleNoteChange(`${note}\n\n${draftText}`)
                    setDraftText('')
                  }}
                >
                  Approve &amp; add to note
                </Button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

export default PatientChartPage
