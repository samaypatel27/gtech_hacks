import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import AppShell from '../components/AppShell/AppShell.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import Panel from '../components/Panel/Panel.jsx'
import Button from '../components/Button/Button.jsx'
import Badge from '../components/Badge/Badge.jsx'
import Alert from '../components/Alert/Alert.jsx'
import Spinner from '../components/Spinner/Spinner.jsx'
import { fetchTreatment, savePreparation, saveAdministration } from '../api/treatments.js'
import styles from './TreatmentRecordPage.module.css'

const todayIso = () => new Date().toISOString().slice(0, 10)

function Field({ label, hint, children }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  )
}

// Nurse's treatment record (ProductSpec2 Step 10): prefilled from the order,
// two sections -- Preparation (vials, lot, waste -> JW/JZ) and Administration
// (times -> the admin code). No login -- same as the rest of /staff/*.
function TreatmentRecordPage() {
  const { treatmentId } = useParams()

  const [treatment, setTreatment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [vialsUsed, setVialsUsed] = useState('')
  const [lotNumber, setLotNumber] = useState('')
  const [wasteMg, setWasteMg] = useState('')
  const [savingPrep, setSavingPrep] = useState(false)
  const [prepError, setPrepError] = useState(null)

  const [dateOfService, setDateOfService] = useState(todayIso())
  const [startTime, setStartTime] = useState('')
  const [stopTime, setStopTime] = useState('')
  const [savingAdmin, setSavingAdmin] = useState(false)
  const [adminError, setAdminError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchTreatment(treatmentId)
      .then((data) => {
        if (cancelled) return
        setTreatment(data)
        const prep = data.preparation ?? {}
        setVialsUsed(prep.vials_used ?? data.vial_mix?.vials ?? '')
        setLotNumber(prep.lot_number ?? '')
        setWasteMg(prep.waste_mg ?? data.vial_mix?.waste_mg ?? '')
        const admin = data.administration ?? {}
        setDateOfService(admin.date_of_service ?? todayIso())
        setStartTime(admin.start_time ?? '')
        setStopTime(admin.stop_time ?? '')
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
  }, [treatmentId])

  const handleSavePrep = async () => {
    setSavingPrep(true)
    setPrepError(null)
    try {
      const updated = await savePreparation(treatmentId, {
        vials_used: vialsUsed === '' ? null : Number(vialsUsed),
        lot_number: lotNumber || null,
        waste_mg: wasteMg === '' ? null : Number(wasteMg),
      })
      setTreatment(updated)
    } catch (err) {
      setPrepError(err.message)
    } finally {
      setSavingPrep(false)
    }
  }

  const handleSaveAdmin = async () => {
    setSavingAdmin(true)
    setAdminError(null)
    try {
      const updated = await saveAdministration(treatmentId, {
        date_of_service: dateOfService,
        start_time: startTime,
        stop_time: stopTime,
      })
      setTreatment(updated)
    } catch (err) {
      setAdminError(err.message)
    } finally {
      setSavingAdmin(false)
    }
  }

  const breadcrumbs = [
    { label: 'Workspaces', to: '/staff/nurse' },
    { label: treatment?.patient?.name ?? `Treatment ${treatmentId}` },
  ]

  if (loading) {
    return (
      <AppShell role="nurse" breadcrumbs={breadcrumbs}>
        <Spinner label="Loading treatment…" />
      </AppShell>
    )
  }

  if (loadError || !treatment) {
    return (
      <AppShell role="nurse" breadcrumbs={breadcrumbs}>
        <Alert tone="danger" title="Could not load treatment">
          {loadError ?? 'Not found'}
        </Alert>
      </AppShell>
    )
  }

  const { patient, drug, dose, vial_mix: vialMix, preparation, administration } = treatment

  return (
    <AppShell role="nurse" breadcrumbs={breadcrumbs}>
      <PageHeader
        title="Treatment record"
        meta={
          <>
            <span>{patient?.name}</span>
            <span>{drug?.brand_name}</span>
            {dose?.amount != null && (
              <span className="mono">
                {dose.amount} {dose.unit ?? 'mg'} ordered
              </span>
            )}
            {vialMix?.vials != null && (
              <span className="mono">
                {vialMix.vials} × {vialMix.vial_size_mg} mg planned
              </span>
            )}
          </>
        }
      />

      <div className={styles.stack}>
        <Panel
          title="Preparation"
          description="Prefilled from the order. Change anything that differs from what you drew."
          actions={preparation ? <Badge tone="success">Saved</Badge> : null}
        >
          <div className={styles.fieldRow}>
            <Field label="Vials used">
              <input type="number" min="0" className="mono" value={vialsUsed} onChange={(e) => setVialsUsed(e.target.value)} />
            </Field>
            <Field label="Lot number">
              <input type="text" className="mono" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />
            </Field>
            <Field label="Waste (mg)" hint="Drawn but not given.">
              <input type="number" min="0" className="mono" value={wasteMg} onChange={(e) => setWasteMg(e.target.value)} />
            </Field>
          </div>
          <div className={styles.footer}>
            <Button variant="primary" onClick={handleSavePrep} disabled={savingPrep}>
              {savingPrep ? 'Saving…' : 'Save preparation'}
            </Button>
            {preparation?.jw_jz && (
              <p className={styles.result}>
                Waste modifier <Badge mono tone="brand">{preparation.jw_jz}</Badge>
                {preparation.waste_mg != null && <span className={styles.muted}>{preparation.waste_mg} mg discarded</span>}
              </p>
            )}
          </div>
          {prepError && <Alert tone="danger" className={styles.alert}>{prepError}</Alert>}
        </Panel>

        <Panel
          title="Administration"
          actions={administration ? <Badge tone="success">Saved</Badge> : null}
        >
          <Alert tone="info" className={styles.dosNote}>
            The date of service decides which billing code applies once the permanent code arrives. Use the day the drug
            is actually given.
          </Alert>
          <div className={styles.fieldRow}>
            <Field label="Date of service">
              <input type="date" value={dateOfService} onChange={(e) => setDateOfService(e.target.value)} />
            </Field>
            <Field label="Start time">
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="Stop time">
              <input type="time" value={stopTime} onChange={(e) => setStopTime(e.target.value)} />
            </Field>
          </div>
          <div className={styles.footer}>
            <Button variant="primary" onClick={handleSaveAdmin} disabled={savingAdmin || !startTime || !stopTime}>
              {savingAdmin ? 'Saving…' : 'Save administration'}
            </Button>
            {administration?.admin_codes && (
              <p className={styles.result}>
                Administration codes
                {administration.admin_codes.map((code) => (
                  <Badge key={code} mono tone="brand">
                    {code}
                  </Badge>
                ))}
              </p>
            )}
          </div>
          {adminError && <Alert tone="danger" className={styles.alert}>{adminError}</Alert>}
        </Panel>
      </div>
    </AppShell>
  )
}

export default TreatmentRecordPage
