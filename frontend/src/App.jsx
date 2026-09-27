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
import TeamWorkspacePage from './pages/TeamWorkspacePage.jsx'
import StaffWorkspacesPage from './pages/StaffWorkspacesPage.jsx'
import PatientChartPage from './pages/PatientChartPage.jsx'
import TreatmentRecordPage from './pages/TreatmentRecordPage.jsx'
import ClaimPage from './pages/ClaimPage.jsx'

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
        <Route path="/doctor/workspace/:practiceDrugId" element={<TeamWorkspacePage />} />
        <Route path="/staff/:role" element={<StaffWorkspacesPage />} />
        {/* Same page/data as the doctor's workspace route above -- the :role
            segment only records who opened it, so each role gets its own URL. */}
        <Route path="/staff/:role/workspace/:practiceDrugId" element={<TeamWorkspacePage />} />
        {/* Treat & Bill pages (Track B): the doctor's chart is gated behind
            sign-in like the rest of /doctor/*; the nurse and biller pages
            have no login of their own, like the rest of /staff/*. */}
        <Route path="/doctor/patients/:patientId" element={<PatientChartPage />} />
        <Route path="/staff/nurse/treatments/:treatmentId" element={<TreatmentRecordPage />} />
        <Route path="/staff/biller/claims/:treatmentId" element={<ClaimPage />} />
      </Routes>
    </>
  )
}

export default App

