"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { createAdminSessionPayload, fetchCurrentUser, type AdminLoginResponse, type AdminUser } from "@/lib/admin-api"

type StoredAdminSession = {
  accessToken: string
  user: AdminUser
}

type AdminSessionContextValue = {
  status: "loading" | "authenticated" | "unauthenticated"
  accessToken: string | null
  user: AdminUser | null
  setSession: (payload: AdminLoginResponse) => void
  clearSession: () => void
  refreshSession: () => Promise<void>
}

const STORAGE_KEY = "fwwb_admin_web_session"

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null)

function readStoredSession(): StoredAdminSession | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAdminSession
    if (!parsed?.accessToken || !parsed?.user) return null
    return parsed
  } catch {
    return null
  }
}

function writeStoredSession(session: StoredAdminSession | null) {
  if (typeof window === "undefined") return
  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading")
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [user, setUser] = useState<AdminUser | null>(null)

  const clearSession = useCallback(() => {
    writeStoredSession(null)
    setAccessToken(null)
    setUser(null)
    setStatus("unauthenticated")
  }, [])

  const refreshSession = useCallback(async () => {
    const stored = readStoredSession()
    if (!stored?.accessToken) {
      clearSession()
      return
    }

    setStatus("loading")
    try {
      const currentUser = await fetchCurrentUser(stored.accessToken)
      const nextSession = {
        accessToken: stored.accessToken,
        user: currentUser,
      }
      writeStoredSession(nextSession)
      setAccessToken(nextSession.accessToken)
      setUser(nextSession.user)
      setStatus("authenticated")
    } catch {
      clearSession()
    }
  }, [clearSession])

  const setSession = useCallback((payload: AdminLoginResponse) => {
    const nextSession = createAdminSessionPayload(payload)
    writeStoredSession(nextSession)
    setAccessToken(nextSession.accessToken)
    setUser(nextSession.user)
    setStatus("authenticated")
  }, [])

  useEffect(() => {
    const stored = readStoredSession()
    if (!stored?.accessToken) {
      setStatus("unauthenticated")
      return
    }

    setAccessToken(stored.accessToken)
    setUser(stored.user)
    void refreshSession()
  }, [refreshSession])

  const value = useMemo<AdminSessionContextValue>(
    () => ({
      status,
      accessToken,
      user,
      setSession,
      clearSession,
      refreshSession,
    }),
    [accessToken, clearSession, refreshSession, setSession, status, user],
  )

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>
}

export function useAdminSession() {
  const context = useContext(AdminSessionContext)
  if (!context) {
    throw new Error("useAdminSession must be used within AdminSessionProvider")
  }
  return context
}
