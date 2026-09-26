import BackButton from '../components/BackButton/BackButton.jsx'
import DrugSearchGrid from '../components/DoctorDashboard/DrugSearchGrid.jsx'
import styles from './DoctorPage.module.css'

function DoctorPage() {
  return (
    <div className={styles.page}>
      <BackButton />
      <DrugSearchGrid />
    </div>
  )
}

export default DoctorPage
