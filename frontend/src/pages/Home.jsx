import { useNavigate } from 'react-router-dom'
import Button from '../components/Button/Button.jsx'
import styles from './Home.module.css'

function Home() {
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <h1>Home</h1>
      <div className={styles.roles}>
        <Button onClick={() => navigate('/drug-maker')}>Drug maker</Button>
        <Button onClick={() => navigate('/doctor')}>Doctor</Button>
      </div>
    </div>
  )
}

export default Home
