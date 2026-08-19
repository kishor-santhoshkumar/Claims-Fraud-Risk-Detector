import { createContext, useContext, useEffect, useState } from 'react'
import { fetchCurrentUser, login as loginRequest } from './api'

const AuthContext = createContext(null)
const TOKEN_STORAGE_KEY = 'cfrd_token'

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY))
  const [user, setUser] = useState(null)
  // 'checking' while we validate a stored token on first load (page refresh),
  // so ProtectedRoute doesn't briefly redirect to /login before we know.
  const [status, setStatus] = useState(token ? 'checking' : 'signed-out')

  useEffect(() => {
    if (!token) {
      setStatus('signed-out')
      return
    }
    let cancelled = false
    fetchCurrentUser(token)
      .then((me) => {
        if (cancelled) return
        setUser(me)
        setStatus('signed-in')
      })
      .catch(() => {
        if (cancelled) return
        localStorage.removeItem(TOKEN_STORAGE_KEY)
        setToken(null)
        setUser(null)
        setStatus('signed-out')
      })
    return () => {
      cancelled = true
    }
    // Only re-validate when the token itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function login(username, password) {
    const data = await loginRequest(username, password)
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token)
    setToken(data.token)
    setUser(data.user)
    setStatus('signed-in')
  }

  function logout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken(null)
    setUser(null)
    setStatus('signed-out')
  }

  return (
    <AuthContext.Provider value={{ token, user, status, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
