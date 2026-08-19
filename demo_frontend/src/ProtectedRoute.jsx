import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import './App.css'

// Layout route: gates every nested route on auth status, then renders
// them via <Outlet/>. Wrap with <Route element={<ProtectedRoute />}>.
export default function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'checking') {
    return <div className="session-checking">Checking session…</div>
  }
  if (status !== 'signed-in') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Outlet />
}
