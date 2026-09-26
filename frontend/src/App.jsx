import { Routes, Route } from 'react-router-dom'
import ShaderBackground from './components/ShaderBackground.jsx'
import Home from './pages/Home.jsx'
import DrugSearchPage from './pages/DrugSearchPage.jsx'
import DrugMakerPage from './pages/DrugMakerPage.jsx'
import DoctorPage from './pages/DoctorPage.jsx'

function App() {
  return (
    <>
      <ShaderBackground />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/temp/drug-search" element={<DrugSearchPage />} />
        <Route path="/drug-maker" element={<DrugMakerPage />} />
        <Route path="/doctor" element={<DoctorPage />} />
      </Routes>
    </>
  )
}

export default App
