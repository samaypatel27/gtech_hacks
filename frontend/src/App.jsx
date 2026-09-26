import { Routes, Route } from 'react-router-dom'
import ShaderBackground from './components/ShaderBackground.jsx'
import Home from './pages/Home.jsx'
import DrugSearchPage from './pages/DrugSearchPage.jsx'

function App() {
  return (
    <>
      <ShaderBackground />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/temp/drug-search" element={<DrugSearchPage />} />
      </Routes>
    </>
  )
}

export default App
