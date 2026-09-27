import { Link } from 'react-router-dom'
import Icon from '../components/Icon/Icon.jsx'
import Brand from '../components/Brand/Brand.jsx'
import { ROLES } from '../lib/roles.js'
import styles from './Home.module.css'

const GROUPS = [
  {
    title: 'Practice',
    roles: [
      { role: 'doctor', path: '/doctor', desc: 'Evaluate new drugs, order and sign treatments. Requires sign-in.' },
      { role: 'front_desk', path: '/staff/front_desk', desc: 'Purchasing, receiving and stock.' },
      { role: 'nurse', path: '/staff/nurse', desc: 'Preparation and infusion records.' },
      { role: 'biller', path: '/staff/biller', desc: 'Claims, billing codes and payer rules.' },
    ],
  },
  {
    title: 'Manufacturer',
    roles: [{ role: 'drug_maker', path: '/drug-maker', desc: 'Add a newly approved drug from FDA and CMS data.' }],
  },
]

function Home() {
  return (
    <div className={styles.page}>
      <div className={styles.column}>
        <Brand link={false} />

        <div className={styles.intro}>
          <h1 className={styles.title}>Choose your workspace</h1>
          <p className={styles.subtitle}>
            Adopt a newly approved drug, from the first question to the first paid claim.
          </p>
        </div>

        {GROUPS.map((group) => (
          <section key={group.title} className={styles.group}>
            <h2 className={styles.groupTitle}>{group.title}</h2>
            <ul className={styles.list}>
              {group.roles.map(({ role, path, desc }) => (
                <li key={role}>
                  <Link to={path} className={styles.row}>
                    <span className={styles.dot} style={{ background: ROLES[role].color }} aria-hidden="true" />
                    <span className={styles.rowText}>
                      <span className={styles.rowLabel}>{ROLES[role].label}</span>
                      <span className={styles.rowDesc}>{desc}</span>
                    </span>
                    <Icon name="arrowRight" className={styles.arrow} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

export default Home
