import { useState } from 'react'
import DrugSearchGrid from '../components/DoctorDashboard/DrugSearchGrid.jsx'
import ConsideringDashboard from '../components/DoctorDashboard/ConsideringDashboard.tsx'

function DoctorPage() {
  const [selectedDrug, setSelectedDrug] = useState(null)

  if (selectedDrug) {
    return <ConsideringDashboard />
  }

  return <DrugSearchGrid onSelectDrug={setSelectedDrug} />
}

export default DoctorPage
