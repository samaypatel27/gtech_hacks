import { useNavigate } from 'react-router-dom'
import Button from '../components/Button/Button.jsx'

function Home() {
  const navigate = useNavigate()

  return (
    <div>
      <h1>Home</h1>
      <Button onClick={() => navigate('/drug-maker')}>Drug maker</Button>
      <Button onClick={() => navigate('/doctor')}>Doctor</Button>
    </div>
  )
}

export default Home
