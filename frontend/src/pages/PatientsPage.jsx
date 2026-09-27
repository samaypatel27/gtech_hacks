import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell/AppShell.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import Panel from '../components/Panel/Panel.jsx'
import Table from '../components/Table/Table.jsx'
import Alert from '../components/Alert/Alert.jsx'
import Spinner from '../components/Spinner/Spinner.jsx'
import EmptyState from '../components/EmptyState/EmptyState.jsx'
import { useAuthSession } from '../lib/useAuthSession.js'
import { fetchPatients } from '../api/patients.js'

function ageFrom(dateOfBirth) {
  if (!dateOfBirth) return null
  const born = new Date(`${dateOfBirth}T00:00:00`)
  const today = new Date()
  let age = today.getFullYear() - born.getFullYear()
  const birthdayPassed =
    today.getMonth() > born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate())
  if (!birthdayPassed) age -= 1
  return age
}

// The doctor's patient list (/doctor/patients): every patient of the signed-in
// practice. A row opens the chart, where the doctor picks which drug to order.
// Patients come from the practice's records (seeded for the demo; an EHR in
// a real deployment), so there's no "add patient" here.
function PatientsPage() {
  const navigate = useNavigate()
  const { email, loading: authLoading } = useAuthSession()
  const [patients, setPatients] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!authLoading && !email) navigate('/doctor', { replace: true })
  }, [authLoading, email, navigate])

  useEffect(() => {
    if (!email) return
    let cancelled = false
    fetchPatients()
      .then((list) => !cancelled && setPatients(list))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [email])

  if (authLoading || !email) return null

  return (
    <AppShell role="doctor" breadcrumbs={[{ label: 'Patients' }]}>
      <PageHeader title="Patients" meta="Open a patient's chart to write the visit note and order a drug." />
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !patients ? (
        <Spinner label="Loading patients…" />
      ) : patients.length === 0 ? (
        <Panel>
          <EmptyState title="No patients yet" description="Your practice's patients show up here." />
        </Panel>
      ) : (
        <Panel flush>
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Age / sex</th>
                <th>Insurer</th>
                <th>Member ID</th>
                <th>Diagnosis</th>
                <th data-align="end">Weight</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => {
                const age = ageFrom(p.date_of_birth)
                const open = () => navigate(`/doctor/patients/${p.id}`)
                return (
                  <tr
                    key={p.id}
                    data-clickable
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') open()
                    }}
                  >
                    <td>{p.name}</td>
                    <td>{[age != null ? `${age}` : null, p.sex].filter(Boolean).join(' / ') || '—'}</td>
                    <td>{p.payer ?? '—'}</td>
                    <td data-mono>{p.member_id ?? '—'}</td>
                    <td>{p.diagnosis ?? '—'}</td>
                    <td data-align="end" data-mono>
                      {p.weight_kg != null ? `${p.weight_kg} kg` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </Panel>
      )}
    </AppShell>
  )
}

export default PatientsPage
