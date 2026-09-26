import { Routes, Route } from 'react-router-dom'
import ShaderBackground from './components/ShaderBackground.jsx'
import Home from './pages/Home.jsx'
import DrugSearchPage from './pages/DrugSearchPage.jsx'
import DrugMakerPage from './pages/DrugMakerPage.jsx'
import DoctorChoicePage from './pages/DoctorChoicePage.jsx'
import DoctorPage from './pages/DoctorPage.jsx'
import SignUpPage from './pages/SignUpPage.jsx'
import AuthCallbackPage from './pages/AuthCallbackPage.jsx'
import DrugDetailPage from './pages/DrugDetailPage.jsx'

function App() {
  return (
    <>
      <ShaderBackground />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/temp/drug-search" element={<DrugSearchPage />} />
        <Route path="/drug-maker" element={<DrugMakerPage />} />
        <Route path="/doctor" element={<DoctorChoicePage />} />
        <Route path="/doctor/drugs" element={<DoctorPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/drugs/:applicationId" element={<DrugDetailPage />} />
      </Routes>
    </>
  )
}

export default App
