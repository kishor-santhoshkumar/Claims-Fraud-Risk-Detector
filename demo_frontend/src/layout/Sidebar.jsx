import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  Home,
  List,
  LogOut,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { useAuth } from '../AuthContext'
import { getInitials } from '../utils/format'
import './Sidebar.css'

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: Home },
  { label: 'Queue', path: '/queue', icon: List },
  { label: 'Analytics', path: '/analytics', icon: BarChart3 },
  { label: 'Simulation', path: '/simulation', icon: SlidersHorizontal },
  { label: 'Settings', path: '/settings', icon: Settings },
]

// Case file / clearance / claims-detail routes aren't in the nav, but
// "Queue" is their closest parent section, so it stays highlighted there.
function isDetailRoute(pathname) {
  return (
    pathname.startsWith('/case/') ||
    pathname.startsWith('/clearance/') ||
    pathname.startsWith('/claims/')
  )
}

export default function Sidebar() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const detailRouteActive = isDetailRoute(location.pathname)

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <ShieldCheck size={17} color="#f8fafc" strokeWidth={2} />
          </div>
          <span className="sidebar-brand-name">Claims Fraud Risk Detector</span>
        </div>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
      </div>

      <div className="sidebar-divider" />

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `sidebar-nav-item${
                isActive || (path === '/queue' && detailRouteActive) ? ' is-active' : ''
              }`
            }
          >
            <Icon size={18} className="sidebar-nav-icon" />
            <span className="sidebar-nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-user-card" title={collapsed ? `${user?.name} (${user?.username})` : undefined}>
          <div className="sidebar-avatar">{getInitials(user?.name)}</div>
          <div className="sidebar-user-text">
            <span className="sidebar-user-name">{user?.name}</span>
            <span className="sidebar-user-username">{user?.username}</span>
          </div>
        </div>
        <button
          type="button"
          className="sidebar-signout"
          onClick={logout}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut size={16} />
          <span className="sidebar-nav-label">Sign out</span>
        </button>
      </div>
    </aside>
  )
}
