import { useState } from 'react'
import styles from './DrugMaker.module.css'

function DrugMaker() {
  const [drugName, setDrugName] = useState('')
  const [applicationId, setApplicationId] = useState('')

  return (
    <div className={styles.panel}>
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
          value={applicationId}
          onChange={(e) => setApplicationId(e.target.value)}
        />
      </label>
    </div>
  )
}

export default DrugMaker
