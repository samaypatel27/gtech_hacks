import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell/AppShell.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import Panel from '../components/Panel/Panel.jsx'
import Button from '../components/Button/Button.jsx'
import Badge from '../components/Badge/Badge.jsx'
import Alert from '../components/Alert/Alert.jsx'
import Spinner from '../components/Spinner/Spinner.jsx'
import DetailList from '../components/DetailList/DetailList.jsx'
import Icon from '../components/Icon/Icon.jsx'
import { useAuthSession } from '../lib/useAuthSession.js'
import { formatDate, formatDateTime } from '../lib/format.js'
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
  const refreshChecks = useCallback(async (treatmentId) => {
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
  }, [])

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

  const breadcrumbs = [
    practiceDrugId
      ? { label: 'Workspace', to: `/doctor/workspace/${practiceDrugId}` }
      : { label: 'Workspaces', to: '/doctor/drugs?view=workspaces' },
    { label: patient?.name ?? 'Patient' },
  ]

  if (loading) {
    return (
      <AppShell role="doctor" breadcrumbs={breadcrumbs}>
        <Spinner label="Loading patient…" />
      </AppShell>
    )
  }

  if (loadError || !patient) {
    return (
      <AppShell role="doctor" breadcrumbs={breadcrumbs}>
        <Alert tone="danger" title="Could not load patient">
          {loadError ?? 'Not found'}
        </Alert>
      </AppShell>
    )
  }

  const allChecksPassed = checks && checks.length > 0 && checks.every((c) => c.passed)
  const passedCount = checks ? checks.filter((c) => c.passed).length : 0
  const dose = treatment?.dose
  const vialMix = treatment?.vial_mix
  const isSigned = signed || treatment?.status === 'signed'

  return (
    <AppShell role="doctor" breadcrumbs={breadcrumbs}>
      <PageHeader
        title={patient.name}
        badges={isSigned ? <Badge tone="success">Order signed</Badge> : treatment ? <Badge tone="brand">Order in progress</Badge> : null}
        meta={
          <>
            {patient.dob && <span>DOB {formatDate(patient.dob)}</span>}
            {patient.weight_kg && <span className="mono">{patient.weight_kg} kg</span>}
            {patient.insurance && <span>{patient.insurance}</span>}
          </>
        }
      />

      <div className={styles.layout}>
        <div className={styles.main}>
          <Panel title="Patient">
            <DetailList
              items={[
                { label: 'Diagnosis', value: patient.diagnosis },
                { label: 'Insurer', value: patient.insurance ?? 'No insurer on file' },
                { label: 'Member ID', value: patient.member_id, mono: true },
                { label: 'Weight', value: patient.weight_kg ? `${patient.weight_kg} kg` : null },
              ]}
            />
          </Panel>

          <Panel title="Visit note" description="Saves automatically as you type.">
            <textarea
              className={styles.noteArea}
              value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
              placeholder="Paste or type the visit note…"
              rows={14}
              aria-label="Visit note"
            />
          </Panel>

          <Panel title="Order">
            {!treatment ? (
              <div className={styles.stack}>
                <p className={styles.muted}>
                  Calculates the dose from the patient's weight and the least-waste vial combination.
                </p>
                <div>
                  <Button variant="primary" onClick={handleNewOrder} disabled={ordering}>
                    {ordering ? 'Calculating dose…' : 'New order'}
                  </Button>
                </div>
                {orderError && <Alert tone="danger">{orderError}</Alert>}
              </div>
            ) : (
              <div className={styles.stack}>
                <DetailList
                  items={[
                    { label: 'Dose', value: dose?.amount != null ? `${dose.amount} ${dose.unit ?? 'mg'}` : null, mono: true },
                    {
                      label: 'Vials',
                      value: vialMix?.vials != null ? `${vialMix.vials} × ${vialMix.vial_size_mg} mg` : null,
                      mono: true,
                    },
                    { label: 'Waste', value: vialMix?.waste_mg != null ? `${vialMix.waste_mg} mg` : null, mono: true },
                  ]}
                />

                {isSigned ? (
                  <Alert tone="success" title="Order signed">
                    {treatment.signed_at ? `Signed ${formatDateTime(treatment.signed_at)}. ` : ''}
                    Your team's tasks for this patient are now on the board.
                  </Alert>
                ) : (
                  <div className={styles.signRow}>
                    <Button variant="primary" onClick={handleSign} disabled={signing || !allChecksPassed}>
                      {signing ? 'Signing…' : 'Sign order'}
                    </Button>
                    {!allChecksPassed && checks && (
                      <p className={styles.muted}>Available once every documentation item is met.</p>
                    )}
                  </div>
                )}
                {signError && <Alert tone="danger">{signError}</Alert>}
              </div>
            )}
          </Panel>
        </div>

        <aside className={styles.sidebar}>
          <Panel
            title="Documentation for payers"
            description={checks ? `${passedCount} of ${checks.length} met` : 'Runs once an order exists.'}
            actions={checking ? <Spinner /> : null}
          >
            {!treatment && <p className={styles.muted}>Create an order to check the note against payer requirements.</p>}
            {checkError && <Alert tone="danger">{checkError}</Alert>}
            {checks && (
              <ul className={styles.checkList}>
                {checks.map((check) => (
                  <li key={check.id} className={styles.checkItem}>
                    <span className={`${styles.checkIcon} ${check.passed ? styles.pass : styles.fail}`}>
                      <Icon name={check.passed ? 'check' : 'close'} size={12} />
                      <span className="sr-only">{check.passed ? 'Met' : 'Missing'}</span>
                    </span>
                    <div className={styles.checkBody}>
                      <p>{check.label}</p>
                      {check.quote && <blockquote className={styles.quote}>{check.quote}</blockquote>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {draftText && (
              <div className={styles.draft}>
                <p className={styles.draftLabel}>Suggested addition</p>
                <p className={styles.draftText}>{draftText}</p>
                <Button
                  size="sm"
                  onClick={() => {
                    handleNoteChange(`${note}\n\n${draftText}`)
                    setDraftText('')
                  }}
                >
                  Approve and add to note
                </Button>
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </AppShell>
  )
}

export default PatientChartPage
