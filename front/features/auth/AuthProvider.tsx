import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { authApi } from "./api";
import {
  clearStoredSession,
  getStoredToken,
  getStoredUser,
  persistSession,
} from "./auth-storage";
import type { TokenResponse, UserPublic } from "./types";

type AuthStatus = "loading" | "guest" | "authenticated";

type AuthContextValue = {
  status: AuthStatus;
  token: string | null;
  user: UserPublic | null;
  signIn: (session: TokenResponse) => Promise<void>;
  signOut: () => Promise<void>;
  refreshCurrentUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserPublic | null>(null);

  const hydrate = useCallback(async () => {
    setStatus("loading");

    const [storedToken, storedUser] = await Promise.all([getStoredToken(), getStoredUser()]);

    if (!storedToken) {
      setToken(null);
      setUser(null);
      setStatus("guest");
      return;
    }

    setToken(storedToken);
    setUser(storedUser);

    try {
      const currentUser = await authApi.me(storedToken);
      await persistSession(storedToken, currentUser);
      setUser(currentUser);
      setStatus("authenticated");
    } catch {
      await clearStoredSession();
      setToken(null);
      setUser(null);
      setStatus("guest");
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const signIn = useCallback(async (session: TokenResponse) => {
    await persistSession(session.access_token, session.user);
    setToken(session.access_token);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    await clearStoredSession();
    setToken(null);
    setUser(null);
    setStatus("guest");
  }, []);

  const refreshCurrentUser = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const currentUser = await authApi.me(token);
      await persistSession(token, currentUser);
      setUser(currentUser);
      setStatus("authenticated");
    } catch {
      await clearStoredSession();
      setToken(null);
      setUser(null);
      setStatus("guest");
    }
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      token,
      user,
      signIn,
      signOut,
      refreshCurrentUser,
    }),
    [refreshCurrentUser, signIn, signOut, status, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
