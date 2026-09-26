import { Routes, Route } from 'react-router-dom'
import ShaderBackground from './components/ShaderBackground.jsx'
import Home from './pages/Home.jsx'

function App() {
  return (
    <>
      <ShaderBackground />
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </>
  )
}

export default App
