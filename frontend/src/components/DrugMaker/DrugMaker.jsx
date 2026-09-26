import { useState } from 'react'
import styles from './DrugMaker.module.css'

const STATUS_TEXT = {
  idle: 'Waiting',
  loading: 'Loading…',
  success: 'Done',
  error: 'Failed',
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

function DrugMaker({ onSubmit, isSubmitting, results, saveResult }) {
  const [drugName, setDrugName] = useState('')
  const [applicationId, setApplicationId] = useState('')

  const canSubmit = drugName.trim() && applicationId.trim() && !isSubmitting
  const hasRun = results.some((r) => r.status !== 'idle')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ drugName: drugName.trim(), applicationId: applicationId.trim() })
  }

  return (
    <form className={styles.panel} onSubmit={handleSubmit}>
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

      <button type="submit" className={styles.button} disabled={!canSubmit}>
        {isSubmitting ? 'Launching…' : 'Launch drug'}
      </button>

      {hasRun && (
        <ul className={styles.statusList}>
          {results.map((r) => (
            <StatusRow key={r.key} label={r.label} status={r.status} message={r.message} />
          ))}
          <StatusRow
            label="Save to database"
            status={saveResult.status}
            message={saveResult.message}
          />
        </ul>
      )}
    </form>
  )
}

export default DrugMaker
