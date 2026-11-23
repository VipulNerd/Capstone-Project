import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getMe, register as registerRequest } from '../api/userService';
import { setUnauthorizedHandler, TOKEN_KEY } from '../api/client';

// The backend issues a long-lived API token per user (POST /users). It is shown once,
// so the app stores it here and the user can copy it to sign in on another device.
const USER_KEY = 'mom_user';
const AuthContext = createContext(null);

function readStoredUser() {
  try {
    return localStorage.getItem(TOKEN_KEY) ? JSON.parse(localStorage.getItem(USER_KEY)) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);

  const saveSession = useCallback((token, u) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  /** Creates the account. Returns the token so the UI can show it once. */
  const register = useCallback(
    async (name, email) => {
      const { user: u, token } = await registerRequest(name.trim(), email.trim().toLowerCase());
      saveSession(token, u);
      return token;
    },
    [saveSession],
  );

  /** Signs in with an existing API token (validated with GET /users/me). */
  const loginWithToken = useCallback(
    async (token) => {
      const u = await getMe(token.trim());
      saveSession(token.trim(), u);
      return u;
    },
    [saveSession],
  );

  /** After POST /users/me/rotate-token the stored token must be replaced. */
  const replaceToken = useCallback((token) => localStorage.setItem(TOKEN_KEY, token), []);

  const getToken = useCallback(() => localStorage.getItem(TOKEN_KEY), []);

  // An invalid or rotated token ends the session.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const value = useMemo(
    () => ({ user, isAuthenticated: !!user, register, loginWithToken, logout, replaceToken, getToken }),
    [user, register, loginWithToken, logout, replaceToken, getToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
