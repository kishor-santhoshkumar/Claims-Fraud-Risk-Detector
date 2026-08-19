import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import AppShell from './layout/AppShell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Queue from './pages/Queue'
import Analytics from './pages/Analytics'
import Simulation from './pages/Simulation'
import Settings from './pages/Settings'
import CaseFile from './pages/CaseFile'
import Clearance from './pages/Clearance'
import ClaimsDetail from './pages/ClaimsDetail'
import './App.css'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/simulation" element={<Simulation />} />
          <Route path="/settings" element={<Settings />} />

          {/* Detail routes: reached via in-app navigation, not sidebar links */}
          <Route path="/case/:providerId" element={<CaseFile />} />
          <Route path="/clearance/:providerId" element={<Clearance />} />
          <Route path="/claims/:providerId" element={<ClaimsDetail />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
