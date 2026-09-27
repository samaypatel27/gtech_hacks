import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import Button from '../components/Button/Button.jsx'
import { fetchTreatment, savePreparation, saveAdministration } from '../api/treatments.js'
import styles from './TreatmentRecordPage.module.css'

const todayIso = () => new Date().toISOString().slice(0, 10)

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

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <BackButton to="/staff/nurse" inline />
          <p className={styles.status}>Loading treatment…</p>
        </div>
      </div>
    )
  }

  if (loadError || !treatment) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <BackButton to="/staff/nurse" inline />
          <p className={styles.status}>Could not load treatment: {loadError ?? 'not found'}</p>
        </div>
      </div>
    )
  }

  const { patient, drug, dose, vial_mix: vialMix, preparation, administration } = treatment

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <BackButton to="/staff/nurse" inline />

        <div className={styles.panel}>
          <h1 className={styles.title}>{drug?.brand_name ?? 'Treatment record'}</h1>
        <p className={styles.meta}>
          {patient?.name}
          {dose?.amount != null ? ` · ${dose.amount} ${dose.unit ?? 'mg'} ordered` : null}
          {vialMix?.vials != null ? ` · ${vialMix.vials} × ${vialMix.vial_size_mg} mg planned` : null}
        </p>

        <section className={styles.section}>
          <span className={styles.label}>Preparation</span>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Vials used</span>
              <input
                type="number"
                min="0"
                className={styles.input}
                value={vialsUsed}
                onChange={(e) => setVialsUsed(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Lot number</span>
              <input
                type="text"
                className={styles.input}
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Waste (mg)</span>
              <input
                type="number"
                min="0"
                className={styles.input}
                value={wasteMg}
                onChange={(e) => setWasteMg(e.target.value)}
              />
            </label>
          </div>
          <Button className={styles.saveButton} onClick={handleSavePrep} disabled={savingPrep}>
            {savingPrep ? 'Saving…' : 'Save preparation'}
          </Button>
          {prepError && <p className={styles.error}>{prepError}</p>}
          {preparation?.jw_jz && (
            <p className={styles.resultLine}>
              Modifier: <strong>{preparation.jw_jz}</strong>
              {preparation.waste_mg != null ? ` (${preparation.waste_mg} mg discarded)` : ''}
            </p>
          )}
        </section>

        <section className={styles.section}>
          <span className={styles.label}>Administration</span>
          <p className={styles.dosCallout}>
            The date of service decides which billing code applies once the permanent code
            arrives — set it to the day the drug is actually given.
          </p>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Date of service</span>
              <input
                type="date"
                className={styles.input}
                value={dateOfService}
                onChange={(e) => setDateOfService(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Start time</span>
              <input
                type="time"
                className={styles.input}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Stop time</span>
              <input
                type="time"
                className={styles.input}
                value={stopTime}
                onChange={(e) => setStopTime(e.target.value)}
              />
            </label>
          </div>
          <Button
            className={styles.saveButton}
            onClick={handleSaveAdmin}
            disabled={savingAdmin || !startTime || !stopTime}
          >
            {savingAdmin ? 'Saving…' : 'Save administration'}
          </Button>
          {adminError && <p className={styles.error}>{adminError}</p>}
          {administration?.admin_codes && (
            <p className={styles.resultLine}>
              Administration code: <strong>{administration.admin_codes.join(' + ')}</strong>
            </p>
          )}
        </section>
      </div>
    </div>
  </div>
)
}

export default TreatmentRecordPage
