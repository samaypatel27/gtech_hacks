import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import AppShell from '../components/AppShell/AppShell.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import Panel from '../components/Panel/Panel.jsx'
import Button from '../components/Button/Button.jsx'
import Badge from '../components/Badge/Badge.jsx'
import Alert from '../components/Alert/Alert.jsx'
import Spinner from '../components/Spinner/Spinner.jsx'
import Icon from '../components/Icon/Icon.jsx'
import { fetchClaim, exportClaim } from '../api/claims.js'
import { formatDate } from '../lib/format.js'
import { fetchClaim, exportClaim, recodeClaim } from '../api/claims.js'
import styles from './ClaimPage.module.css'

// The 8 pre-submission checks, in the order ProductSpec2 §7 Step 11 lists
// them. The backend returns `checks` in this same order with pass/fail and
// an optional fix hint; this is only the fallback label if a check id it
// sends back is one we don't recognize.
const CHECK_LABELS = {
  item19: 'Drug details complete in Item 19',
  ndc: 'NDC in 11-digit format and matches the invoice',
  units: 'Units correct for the code type and payer',
  waste_modifier: 'JW/JZ applied correctly',
  diagnosis: 'Diagnosis matches an approved use',
  documentation: 'Documentation complete',
  admin_code: 'Administration code matches the infusion times',
  attachments: 'Attachments ready (prior auth on file if required)',
}

const HIGHLIGHT_MS = 2000

// One CMS-1500 box. `generated` marks a value the app computed (vs. entered
// directly) and puts its source in a native tooltip -- "why this value" on
// hover, per ProductSpec2 §7 Step 11.
function Field({ id, box, label, value, generated, why, mono, highlighted, wide }) {
  return (
    <div
      id={id}
      className={`${styles.field} ${highlighted ? styles.highlighted : ''} ${wide ? styles.wide : ''}`}
    >
      <span className={styles.fieldLabel}>
        <span className={styles.box}>{box}</span>
        {label}
      </span>
      <span
        className={`${styles.fieldValue} ${generated ? styles.generated : ''} ${mono ? 'mono' : ''}`}
        title={generated && why ? why : undefined}
      >
        {value ?? <span className={styles.empty}>—</span>}
      </span>
    </div>
  )
}

function CheckRow({ check, onFix }) {
  const label = CHECK_LABELS[check.id] ?? check.label ?? check.id
  return (
    <li className={styles.checkRow}>
      <span className={`${styles.checkIcon} ${check.passed ? styles.pass : styles.fail}`}>
        <Icon name={check.passed ? 'check' : 'close'} size={12} />
        <span className="sr-only">{check.passed ? 'Passed' : 'Failed'}</span>
      </span>
      <div className={styles.checkBody}>
        <p>{label}</p>
        {!check.passed && check.message && <p className={styles.checkMessage}>{check.message}</p>}
      </div>
      {!check.passed && check.fix_field && (
        <Button variant="ghost" size="sm" onClick={() => onFix(check.fix_field)}>
          Fix
        </Button>
      )}
    </li>
  )
}

// Biller's claim page (ProductSpec2 Steps 11-12): the 8 checks beside a
// CMS-1500 look-alike over one treatment row, with generated fields marked,
// and Export. No login -- same as the rest of /staff/*.
function ClaimPage() {
  const { treatmentId } = useParams()

  const [claim, setClaim] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [highlightId, setHighlightId] = useState(null)
  const highlightTimer = useRef(null)
  const [recoding, setRecoding] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchClaim(treatmentId)
      .then((data) => {
        if (!cancelled) setClaim(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [treatmentId])

  useEffect(() => () => clearTimeout(highlightTimer.current), [])

  const scrollToField = (fieldId) => {
    document.getElementById(fieldId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(fieldId)
    clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
  }

  const handleExport = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const updated = await exportClaim(treatmentId)
      setClaim(updated)
      // "Export" hands the biller a CMS-1500 PDF plus the packet -- the
      // browser's own print-to-PDF is the export mechanism (ProductSpec2
      // Step 12: "nothing is auto-submitted").
      window.print()
    } catch (err) {
      setExportError(err.message)
    } finally {
      setExporting(false)
    }
  }

  const breadcrumbs = [
    { label: 'Workspaces', to: '/staff/biller' },
    { label: claim?.patient?.name ? `Claim · ${claim.patient.name}` : `Claim ${treatmentId}` },
  ]
  // Switch flagged this claim: it went out with a code that turned out to be
  // outdated for its date of service. Rebuild it as a corrected claim (Box 22,
  // resubmission code 7); it then goes through the checks and Export again.
  const handleRecode = async () => {
    setRecoding(true)
    setExportError(null)
    try {
      setClaim(await recodeClaim(treatmentId))
    } catch (err) {
      setExportError(err.message)
    } finally {
      setRecoding(false)
    }
  }

  if (loading) {
    return (
      <AppShell role="biller" breadcrumbs={breadcrumbs}>
        <Spinner label="Loading claim…" />
      </AppShell>
    )
  }

  if (error || !claim) {
    return (
      <AppShell role="biller" breadcrumbs={breadcrumbs}>
        <Alert tone="danger" title="Could not load claim">
          {error ?? 'Not found'}
        </Alert>
      </AppShell>
    )
  }

  const {
    patient,
    drug,
    item19,
    admin_codes: adminCodes,
    diagnosis_code: diagnosisCode,
    provider_npi: providerNpi,
    date_of_service: dateOfService,
    checks = [],
    status,
  } = claim
  const { patient, drug, item19, admin_codes: adminCodes, diagnosis_code: diagnosisCode,
    provider_npi: providerNpi, date_of_service: dateOfService, checks = [], status,
    code_note: codeNote, resubmission } = claim

  const allPassed = checks.length > 0 && checks.every((c) => c.passed)
  const passedCount = checks.filter((c) => c.passed).length
  const exported = status === 'exported'
  const f = (id) => ({ id, highlighted: highlightId === id })
  const needsRecoding = status === 'needs_recoding'
  const statusLabel = exported
    ? 'Exported'
    : needsRecoding
      ? 'Needs corrected claim'
      : resubmission
        ? 'Corrected claim — ready for review'
        : 'Ready for review'
  const codeKind = drug?.code_kind ?? (drug?.code_type === 'generic' ? 'generic' : 'permanent')

  return (
    <AppShell role="biller" breadcrumbs={breadcrumbs}>
      <PageHeader
        title={`Claim for ${patient?.name ?? `treatment ${treatmentId}`}`}
        badges={
          exported ? (
            <Badge tone="success">Exported</Badge>
          ) : allPassed ? (
            <Badge tone="brand">Ready to export</Badge>
          ) : (
            <Badge tone="warning">Needs review</Badge>
          )
        }
        meta={
          <>
            <span>CMS-1500</span>
            {drug?.code && <span className="mono">{drug.code}</span>}
            {dateOfService && <span>Date of service {formatDate(dateOfService)}</span>}
          </>
        }
      />

      <div className={styles.layout}>
        <aside className={styles.checks}>
          <Panel title="Pre-submission checks" description={`${passedCount} of ${checks.length} passed`}>
            <ul className={styles.checkList}>
              {checks.map((check) => (
                <CheckRow key={check.id} check={check} onFix={scrollToField} />
              ))}
            </ul>
            <div className={styles.exportArea}>
              {exportError && <Alert tone="danger">{exportError}</Alert>}
              <Button variant="primary" className={styles.full} onClick={handleExport} disabled={!allPassed || exporting}>
                {exported ? 'Print again' : exporting ? 'Exporting…' : 'Export for clearinghouse'}
              </Button>
              {!allPassed && !exported && (
                <p className={styles.hint}>Every check must pass before this claim can be exported.</p>
              )}
            </div>
          </Panel>
        </aside>

        <div className={styles.form}>
          <div className={styles.formHeader}>
            <span className={styles.formTitle}>Health insurance claim form</span>
            <span className={styles.legend}>
              <span className={styles.legendSwatch} aria-hidden="true" /> Calculated. Hover for the source.
            </span>
          </div>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Patient and insured</h2>
            <div className={styles.grid}>
              <Field {...f('field-patient')} box="2" label="Patient name" value={patient?.name} />
              <Field {...f('field-member')} box="1a" label="Insured's ID" value={patient?.member_id} mono />
              <Field {...f('field-insurance')} box="11c" label="Insurance plan" value={patient?.insurance} />
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Diagnosis and item 19</h2>
            <div className={styles.grid}>
              <Field
                {...f('field-diagnosis')}
                box="21"
                label="Diagnosis (ICD-10)"
                value={diagnosisCode}
                mono
                wide
                generated
                why="Suggested from the visit note, confirmed by the doctor"
              />
              <Field
                {...f('field-item19')}
                box="19"
                label="Additional claim information"
                value={item19}
                mono
                wide
                generated
                why="Built from the drug name, strength, NDC and invoice price"
              />
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Service lines</h2>
            <div className={styles.grid}>
              <Field {...f('field-dos')} box="24A" label="Date of service" value={dateOfService ? formatDate(dateOfService) : null} />
              <Field
                {...f('field-code')}
                box="24D"
                label="HCPCS code"
                value={drug?.code}
                mono
                generated
                why={`${drug?.code_type === 'permanent' ? 'Permanent' : 'Generic'} code, from the drug's coding rules`}
              />
              <Field
                {...f('field-waste_modifier')}
                box="24D"
                label="Modifier"
                value={drug?.jw_jz ? `${drug.jw_jz} (${drug?.waste_mg ?? 0} mg discarded)` : 'JZ (no waste)'}
                mono
                generated
                why="waste_modifier (billing_rules.py), from the single-dose vial mix and the dose given"
              />
              <Field
                {...f('field-units')}
                box="24G"
                label="Units"
                value={drug?.units}
                mono
                generated
                why="units (billing_rules.py): 1 for a generic code, else dose ÷ billing unit"
              />
              <Field
                {...f('field-ndc')}
                box="24"
                label="NDC (N4 qualifier)"
                value={drug?.ndc_11}
                mono
                generated
                why="Converted to 11-digit 5-4-2 format (ndc_10_to_11)"
              />
              <Field
                {...f('field-admin_code')}
                box="24D"
                label="Administration"
                value={adminCodes?.join(' + ')}
                mono
                generated
                why="admin_codes (billing_rules.py), from the infusion start and stop times"
              />
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Provider</h2>
            <div className={styles.grid}>
              <Field
                {...f('field-npi')}
                box="24J / 33a"
                label="Rendering provider NPI"
                value={providerNpi}
                mono
                generated
                why="From your verified sign-up"
              />
            </div>
          </section>

          <section
            id="field-attachments"
            className={`${styles.section} ${highlightId === 'field-attachments' ? styles.highlighted : ''}`}
      <div className={styles.header}>
        <h1 className={styles.title}>Claim — {patient?.name ?? `Treatment #${treatmentId}`}</h1>
        <span className={exported ? `${styles.statusPill} ${styles.statusExported}` : styles.statusPill}>
          {statusLabel}
        </span>
      </div>

      {needsRecoding && (
        <div role="alert" className={`${styles.recodeBanner} ${styles.printHide}`}>
          <p className={styles.recodeText}>
            This claim was exported with {drug?.code}, but a new billing code was already in effect on the date
            of service. Build a corrected claim to replace it.
          </p>
          <Button className={styles.recodeButton} onClick={handleRecode} disabled={recoding}>
            {recoding ? 'Building…' : 'Build corrected claim'}
          </Button>
        </div>
      )}

      <div className={styles.form}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Patient &amp; provider</h2>
          <div className={styles.grid}>
            <Field id="field-patient" label="Patient" value={patient?.name} />
            <Field id="field-member" label="Member ID" value={patient?.member_id} />
            <Field id="field-insurance" label="Insurer" value={patient?.insurance} />
            <Field id="field-npi" label="Provider NPI (24J / 33)" value={providerNpi} generated why="From your verified sign-up" />
            <Field id="field-dos" label="Date of service" value={dateOfService} />
            <Field
              id="field-diagnosis"
              label="Item 21 — Diagnosis"
              value={diagnosisCode}
              generated
              why="Suggested from the visit note, confirmed by the doctor"
            />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Drug line</h2>
          <div className={styles.grid}>
            <Field id="field-code" label="HCPCS code" value={drug?.code} generated why={`${codeKind[0].toUpperCase()}${codeKind.slice(1)} code in effect on the date of service, from the drug's dated code list`} />
            <Field id="field-units" label="Units" value={drug?.units} generated why="units (billing_rules.py) — 1 for a generic code, else dose ÷ billing unit" />
            <Field
              id="field-waste_modifier"
              label="JW / JZ"
              value={drug?.jw_jz ? `${drug.jw_jz} (${drug?.waste_mg ?? 0} mg discarded)` : 'JZ (no waste)'}
              generated
              why="waste_modifier (billing_rules.py), from the single-dose vial mix and the dose given"
            />
            <Field id="field-ndc" label="NDC (N4)" value={drug?.ndc_11} generated why="Converted to 11-digit 5-4-2 format (ndc_10_to_11)" />
            {resubmission && (
              <Field
                id="field-resubmission"
                label="Item 22 — Resubmission"
                value={`7 (replaces the ${resubmission.original_code} claim)`}
                generated
                why={`Corrected claim: replaces the version exported ${resubmission.original_exported_at?.slice(0, 10) ?? ''}`}
              />
            )}
          </div>
          {codeNote && <p className={styles.codeNote}>{codeNote}</p>}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Item 19 &amp; administration</h2>
          <div className={styles.grid}>
            <Field id="field-item19" label="Item 19" value={item19} generated why="Built from the drug name, strength, NDC and invoice price" />
            <Field
              id="field-admin_code"
              label="Administration"
              value={adminCodes?.join(' + ')}
              generated
              why="admin_codes (billing_rules.py) — from the infusion start/stop times"
            />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Attachments</h2>
          <p className={styles.attachmentsNote}>
            Invoice, FDA label and the signed note are bundled into one packet automatically.
          </p>
          <div id="field-attachments" />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Pre-submission checks</h2>
          <ul className={styles.checkList}>
            {checks.map((check) => (
              <CheckRow key={check.id} check={check} onFix={scrollToField} />
            ))}
          </ul>
        </section>

        {exportError && <p className={styles.error}>{exportError}</p>}

        <div className={styles.actions}>
          <Link to="/staff/biller" className={styles.secondaryLink}>
            Back to workspaces
          </Link>
          <Button
            className={styles.exportButton}
            onClick={handleExport}
            disabled={!allPassed || exporting || needsRecoding}
          >
            <h2 className={styles.sectionTitle}>Attachments</h2>
            <p className={styles.attachments}>
              Invoice, FDA label and the signed note are bundled into one packet automatically.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  )
}

export default ClaimPage
