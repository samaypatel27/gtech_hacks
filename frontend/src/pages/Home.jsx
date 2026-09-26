import { useNavigate } from 'react-router-dom'
import styles from './Home.module.css'

function Home() {
  const navigate = useNavigate()

  return (
    <div>
      <h1>Home</h1>
      <button
        type="button"
        className={styles.button}
        onClick={() => navigate('/drug-maker')}
      >
        Drug maker
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => navigate('/doctor')}
      >
        Doctor
      </button>
    </div>
  )
}

export default Home
