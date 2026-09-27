import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import BackButton from '../components/BackButton/BackButton.jsx'
import Button from '../components/Button/Button.jsx'
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

// One CMS-1500-style field. `generated` highlights it as something the app
// computed (vs. entered directly) and puts the source in a native tooltip --
// "why this value" on hover, per ProductSpec2 §7 Step 11.
function Field({ label, value, generated, why, id }) {
  return (
    <div id={id} className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span
        className={generated ? `${styles.fieldValue} ${styles.generated}` : styles.fieldValue}
        title={generated && why ? why : undefined}
      >
        {value ?? '—'}
      </span>
    </div>
  )
}

function CheckRow({ check, onFix }) {
  const label = CHECK_LABELS[check.id] ?? check.label ?? check.id
  return (
    <li className={styles.checkRow}>
      <span className={check.passed ? styles.checkDot : `${styles.checkDot} ${styles.checkDotFail}`}>
        {check.passed ? '✓' : '✗'}
      </span>
      <span className={styles.checkLabel}>{label}</span>
      {!check.passed && check.fix_field && (
        <button type="button" className={styles.fixLink} onClick={() => onFix(check.fix_field)}>
          Fix
        </button>
      )}
    </li>
  )
}

// Biller's claim page (ProductSpec2 Steps 11-12): a CMS-1500 look-alike over
// one treatment row, with generated fields highlighted, the 8 checks, and
// Export. No login -- same as the rest of /staff/*.
function ClaimPage() {
  const { treatmentId } = useParams()

  const [claim, setClaim] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
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

  const scrollToField = (fieldId) => {
    document.getElementById(fieldId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
      <div className={styles.page}>
        <div className={styles.topContainer}>
          <BackButton to="/staff/biller" inline />
        </div>
        <div className={styles.form}>
          <p className={styles.status}>Loading claim…</p>
        </div>
      </div>
    )
  }

  if (error || !claim) {
    return (
      <div className={styles.page}>
        <div className={styles.topContainer}>
          <BackButton to="/staff/biller" inline />
        </div>
        <div className={styles.form}>
          <p className={styles.status}>Could not load claim: {error ?? 'not found'}</p>
        </div>
      </div>
    )
  }

  const { patient, drug, item19, admin_codes: adminCodes, diagnosis_code: diagnosisCode,
    provider_npi: providerNpi, date_of_service: dateOfService, checks = [], status,
    code_note: codeNote, resubmission } = claim

  const allPassed = checks.length > 0 && checks.every((c) => c.passed)
  const exported = status === 'exported'
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
    <div className={styles.page}>
      <div className={`${styles.topContainer} ${styles.printHide}`}>
        <BackButton to="/staff/biller" inline />
      </div>

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
            {exported ? 'Exported — print again' : exporting ? 'Exporting…' : 'Export for clearinghouse'}
          </Button>
        </div>
        {!allPassed && !exported && (
          <p className={styles.hint}>All 8 checks must be green before this claim can be exported.</p>
        )}
      </div>
    </div>
  )
}

export default ClaimPage
