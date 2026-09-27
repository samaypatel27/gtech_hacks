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

// Insurer coverage choices → the covered / prior_auth pair stored on the
// drug's payer_policies (null = the insurer hasn't decided yet).
const COVERAGE = {
  covered: { label: 'Covered', covered: true, prior_auth: false },
  prior_auth: { label: 'Covered with prior auth', covered: true, prior_auth: true },
  review: { label: 'Under review', covered: null, prior_auth: null },
  not_covered: { label: 'Not covered', covered: false, prior_auth: false },
}

const emptyCoverageRow = () => ({ payer: '', status: 'covered', notes: '', documentation: '' })

const EMPTY_LAUNCH = {
  approvalDate: '',
  listPrice: '',
  distributors: '',
  code: '',
  codeType: 'permanent',
  codeUnit: '',
  codeFrom: '',
  coverage: [emptyCoverageRow()],
}

// The demo drug's launch details, so the demo doesn't need live typing.
const EXAMPLE = {
  drugName: 'Pasatru',
  applicationId: 'BLA761508',
  launch: {
    approvalDate: '2026-02-01',
    listPrice: '1850',
    distributors: 'ASD Healthcare, McKesson Specialty Health',
    code: 'J0289',
    codeType: 'permanent',
    codeUnit: '1 MG',
    codeFrom: '2026-10-01',
    coverage: [
      { payer: 'Medicare', status: 'covered', notes: 'Covered for approved uses per LCD. No prior authorization required.', documentation: '' },
      {
        payer: 'BCBS',
        status: 'prior_auth',
        notes: 'Prior authorization required before first dose. Requires documented FOP diagnosis with genetic confirmation of an ACVR1 mutation.',
        documentation: 'Genetic confirmation of an ACVR1 mutation (e.g. R206H)',
      },
      { payer: 'Aetna', status: 'review', notes: 'Policy under review. Verify coverage before treatment.', documentation: '' },
    ],
  },
}

// The launch details in the shape POST /api/drugs expects, or null when
// nothing was filled in (the save then only refreshes the FDA/CMS data).
function toLaunchPayload(f) {
  const launch = {}
  if (f.approvalDate) launch.approval_date = f.approvalDate
  if (f.listPrice) launch.list_price_per_vial = Number(f.listPrice)
  const distributors = f.distributors.split(',').map((d) => d.trim()).filter(Boolean)
  if (distributors.length) launch.distributors = distributors
  if (f.code.trim() && f.codeUnit.trim() && f.codeFrom) {
    launch.expected_code = {
      code: f.code.trim(),
      type: f.codeType,
      unit: f.codeUnit.trim(),
      effective_from: f.codeFrom,
    }
  }
  const coverage = f.coverage
    .filter((row) => row.payer.trim())
    .map((row) => {
      const { covered, prior_auth } = COVERAGE[row.status]
      const documentation = row.documentation.split(';').map((d) => d.trim()).filter(Boolean)
      return {
        payer: row.payer.trim(),
        covered,
        prior_auth,
        notes: row.notes.trim() || null,
        documentation_requirements: documentation.length ? documentation : null,
      }
    })
  if (coverage.length) launch.coverage = coverage
  return Object.keys(launch).length ? launch : null
}

// What's missing for the launch details to be usable, or '' when they are.
function launchProblem(f) {
  const codeParts = [f.code.trim(), f.codeUnit.trim(), f.codeFrom].filter(Boolean).length
  if (codeParts > 0 && codeParts < 3) return 'Fill in the expected code, its billing unit and the date it takes effect (or leave all three empty).'
  if (f.approvalDate && f.codeFrom && f.codeFrom <= f.approvalDate) return 'The expected code must take effect after the approval date.'
  if (f.listPrice && !(Number(f.listPrice) > 0)) return 'The list price must be a positive number.'
  return ''
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
// the database write through `saveResult`. The launch details are what only
// the drug maker knows: price, distributors, the expected billing code and
// each insurer's coverage.
function DrugMaker({ onSubmit, isSubmitting, results, saveResult }) {
  const [drugName, setDrugName] = useState('')
  const [applicationId, setApplicationId] = useState('')
  const [launch, setLaunch] = useState(EMPTY_LAUNCH)

  const problem = launchProblem(launch)
  const canSubmit = drugName.trim() && applicationId.trim() && !problem && !isSubmitting

  const setField = (field) => (e) => setLaunch((prev) => ({ ...prev, [field]: e.target.value }))
  const setCoverage = (index, field) => (e) =>
    setLaunch((prev) => ({
      ...prev,
      coverage: prev.coverage.map((row, i) => (i === index ? { ...row, [field]: e.target.value } : row)),
    }))

  const fillExample = () => {
    setDrugName(EXAMPLE.drugName)
    setApplicationId(EXAMPLE.applicationId)
    setLaunch(EXAMPLE.launch)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ drugName: drugName.trim(), applicationId: applicationId.trim(), launch: toLaunchPayload(launch) })
  }

  return (
    <div className={styles.layout}>
      <Panel
        title="Drug"
        description="The brand name as CMS lists it, and the FDA application number."
        actions={
          <Button variant="ghost" size="sm" onClick={fillExample} disabled={isSubmitting}>
            Fill example
          </Button>
        }
      >
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

          <fieldset className={styles.section} disabled={isSubmitting}>
            <legend className={styles.sectionTitle}>Launch details</legend>
            <p className={styles.sectionHint}>
              What only you know at launch. Practices see it in their “Can my practice use this?” check. Leave it empty
              to only refresh the FDA and CMS data.
            </p>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>FDA approval date</span>
                <input type="date" value={launch.approvalDate} onChange={setField('approvalDate')} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>List price per vial ($)</span>
                <input type="number" min="0" step="0.01" placeholder="e.g. 1850" value={launch.listPrice} onChange={setField('listPrice')} />
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>Specialty distributors (comma-separated)</span>
              <input type="text" placeholder="e.g. ASD Healthcare, McKesson Specialty Health" value={launch.distributors} onChange={setField('distributors')} />
            </label>
          </fieldset>

          <fieldset className={styles.section} disabled={isSubmitting}>
            <legend className={styles.sectionTitle}>Expected billing code</legend>
            <p className={styles.sectionHint}>
              The product-specific code CMS is expected to assign. Until it takes effect, the drug bills under a generic
              code from the approval date.
            </p>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>Code</span>
                <input type="text" className="mono" placeholder="e.g. J0289" value={launch.code} onChange={setField('code')} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Kind</span>
                <select value={launch.codeType} onChange={setField('codeType')}>
                  <option value="permanent">Permanent (J-code)</option>
                  <option value="temporary">Temporary (e.g. Q-code)</option>
                </select>
              </label>
            </div>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>Billing unit</span>
                <input type="text" placeholder="e.g. 1 MG" value={launch.codeUnit} onChange={setField('codeUnit')} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Takes effect</span>
                <input type="date" value={launch.codeFrom} onChange={setField('codeFrom')} />
              </label>
            </div>
          </fieldset>

          <fieldset className={styles.section} disabled={isSubmitting}>
            <legend className={styles.sectionTitle}>Insurer coverage</legend>
            <p className={styles.sectionHint}>One row per insurer policy you know of. Practices with other insurers are told to verify coverage.</p>
            {launch.coverage.map((row, i) => (
              <div key={i} className={styles.coverageRow}>
                <div className={styles.row}>
                  <label className={styles.field}>
                    <span className={styles.label}>Insurer</span>
                    <input type="text" placeholder="e.g. Medicare" value={row.payer} onChange={setCoverage(i, 'payer')} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Coverage</span>
                    <select value={row.status} onChange={setCoverage(i, 'status')}>
                      {Object.entries(COVERAGE).map(([value, { label }]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className={styles.field}>
                  <span className={styles.label}>Policy notes</span>
                  <input type="text" value={row.notes} onChange={setCoverage(i, 'notes')} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Documentation required (separate with ;)</span>
                  <input
                    type="text"
                    placeholder="e.g. Genetic confirmation of an ACVR1 mutation"
                    value={row.documentation}
                    onChange={setCoverage(i, 'documentation')}
                  />
                </label>
                {launch.coverage.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.removeRow}
                    onClick={() => setLaunch((prev) => ({ ...prev, coverage: prev.coverage.filter((_, j) => j !== i) }))}
                  >
                    Remove insurer
                  </Button>
                )}
              </div>
            ))}
            <div>
              <Button
                size="sm"
                onClick={() => setLaunch((prev) => ({ ...prev, coverage: [...prev.coverage, emptyCoverageRow()] }))}
              >
                Add insurer
              </Button>
            </div>
          </fieldset>

          {problem && <p className={styles.problem}>{problem}</p>}
          <div>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {isSubmitting ? 'Fetching and saving…' : 'Fetch and save'}
            </Button>
          </div>
        </form>

        {!isSubmitting && saveResult.status === 'success' && (
          <Alert tone="success" title="Drug saved" className={styles.result}>
            {saveResult.message}. It now appears in every practice's drug list
            {saveResult.launched ? ', and every practice got a launch message.' : '.'}
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
