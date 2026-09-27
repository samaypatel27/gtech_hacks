import { useNavigate } from 'react-router-dom'
import Button from '../components/Button/Button.jsx'
import styles from './Home.module.css'

const ROLES = [
  { path: '/doctor', label: 'Doctor', desc: 'Physician portal & therapy adoption' },
  { path: '/staff/nurse', label: 'Nurse', desc: 'Infusion & administration tasks' },
  { path: '/staff/biller', label: 'Biller', desc: 'Claims, billing codes & payer rules' },
  { path: '/staff/front_desk', label: 'Front Desk', desc: 'Purchasing & inventory receiving' },
  { path: '/drug-maker', label: 'Drug Maker', desc: 'Therapy pipeline & NDC indexing' },
]

function Home() {
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>Clinical Operations Platform</span>
        <h1 className={styles.title}>Impricus Portal</h1>
        <p className={styles.subtitle}>
          Select your practice role to access therapy workflows and team workspaces.
        </p>
      </div>

      <div className={styles.grid}>
        {ROLES.map((r) => (
          <div key={r.path} className={styles.roleCard} onClick={() => navigate(r.path)}>
            <div className={styles.roleInfo}>
              <span className={styles.roleLabel}>{r.label}</span>
              <span className={styles.roleDesc}>{r.desc}</span>
            </div>
            <Button
              className={styles.roleButton}
              onClick={(e) => {
                e.stopPropagation()
                navigate(r.path)
              }}
            >
              Enter &rarr;
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Home
