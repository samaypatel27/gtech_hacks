import { useState } from 'react'
import Button from '../Button/Button.jsx'
import Panel from '../Panel/Panel.jsx'
import Badge from '../Badge/Badge.jsx'
import Alert from '../Alert/Alert.jsx'
import Spinner from '../Spinner/Spinner.jsx'
import styles from './DrugMaker.module.css'

const STATUS = {
  idle: { tone: 'neutral', label: 'Waiting' },
  loading: { tone: 'brand', label: 'Loading' },
  success: { tone: 'success', label: 'Done' },
  error: { tone: 'danger', label: 'Failed' },
}

function SourceRow({ label, status, message }) {
  const meta = STATUS[status] ?? STATUS.idle
  return (
    <li className={styles.sourceRow}>
      <div className={styles.sourceText}>
        <span className={styles.sourceLabel}>{label}</span>
        {message && <span className={styles.sourceMessage}>{message}</span>}
      </div>
      {status === 'loading' ? <Spinner /> : <Badge tone={meta.tone}>{meta.label}</Badge>}
    </li>
  )
}

// Form + per-source progress for adding a drug. The page owns the fetching
// (onSubmit) and reports each source's progress back through `results` and
// the database write through `saveResult`.
function DrugMaker({ onSubmit, isSubmitting, results, saveResult }) {
  const [drugName, setDrugName] = useState('')
  const [applicationId, setApplicationId] = useState('')

  const canSubmit = drugName.trim() && applicationId.trim() && !isSubmitting

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ drugName: drugName.trim(), applicationId: applicationId.trim() })
  }

  return (
    <div className={styles.layout}>
      <Panel title="Drug" description="The brand name as CMS lists it, and the FDA application number.">
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span className={styles.label}>Brand name</span>
            <input
              type="text"
              placeholder="e.g. Pasatru"
              value={drugName}
              onChange={(e) => setDrugName(e.target.value)}
              disabled={isSubmitting}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Application ID</span>
            <input
              type="text"
              className="mono"
              placeholder="e.g. BLA761508"
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
              disabled={isSubmitting}
            />
          </label>
          <div>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {isSubmitting ? 'Fetching and saving…' : 'Fetch and save'}
            </Button>
          </div>
        </form>

        {!isSubmitting && saveResult.status === 'success' && (
          <Alert tone="success" title="Drug saved" className={styles.result}>
            {saveResult.message}. It now appears in every practice's drug list.
          </Alert>
        )}
        {!isSubmitting && saveResult.status === 'error' && (
          <Alert tone="danger" title="Not saved" className={styles.result}>
            {saveResult.message}
          </Alert>
        )}
      </Panel>

      <Panel title="Sources" description="Each source is fetched live; a failed source leaves existing values untouched.">
        <ul className={styles.sources} aria-live="polite">
          {results.map((r) => (
            <SourceRow key={r.key} label={r.label} status={r.status} message={r.message} />
          ))}
          <SourceRow label="Save to database" status={saveResult.status} message={saveResult.message} />
        </ul>
      </Panel>
    </div>
  )
}

export default DrugMaker
