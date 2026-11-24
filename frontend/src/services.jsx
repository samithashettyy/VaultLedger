import {
  useCallback,
  useEffect,
  useRef,
  useState,
  createContext,
  useContext,
  useMemo
} from "react";

// Consolidated VaultLedger frontend. Sections retain their original responsibilities.

// ==================== api.js ====================
// Thin fetch wrapper around the VaultLedger Flask API.
// The session token lives in sessionStorage so several banks can be logged
// in at once in different browser tabs (handy for the multi-bank demo).

const KEY = 'vl_session';
const sessionStore = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY));
    } catch {
      return null;
    }
  },
  set(value) {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  },
  clear() {
    sessionStorage.removeItem(KEY);
  }
};
async function api(path, {
  method = 'GET',
  body
} = {}) {
  const session = sessionStore.get();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? {
        Authorization: `Bearer ${session.token}`
      } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && session?.token) {
      window.dispatchEvent(new Event('vl-unauthorized'));
    }
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ==================== hooks/usePolling.js ====================
function usePolling(fn, intervalMs = 0) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const result = await fn();
      if (alive.current) {
        setData(result);
        setError(null);
      }
      return result;
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [fn]);
  useEffect(() => {
    alive.current = true;
    refresh();
    let timer;
    if (intervalMs > 0) timer = setInterval(refresh, intervalMs);
    return () => {
      alive.current = false;
      if (timer) clearInterval(timer);
    };
  }, [refresh, intervalMs]);
  return {
    data,
    error,
    loading,
    refresh,
    setData
  };
}

// ==================== context/AuthContext.jsx ====================
const AuthContext = createContext(null);
function AuthProvider({
  children
}) {
  const [session, setSession] = useState(() => sessionStore.get());
  const login = useCallback(async (bank, username, password) => {
    const data = await api('/login', {
      method: 'POST',
      body: {
        bank,
        username,
        password
      }
    });
    sessionStore.set(data);
    setSession(data);
    return data;
  }, []);
  const logout = useCallback(async () => {
    try {
      await api('/logout', {
        method: 'POST'
      });
    } catch {
      /* session may already be gone */
    }
    sessionStore.clear();
    setSession(null);
  }, []);
  useEffect(() => {
    const onUnauthorized = () => {
      sessionStore.clear();
      setSession(null);
    };
    window.addEventListener('vl-unauthorized', onUnauthorized);
    return () => window.removeEventListener('vl-unauthorized', onUnauthorized);
  }, []);
  const value = useMemo(() => ({
    session,
    login,
    logout
  }), [session, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
const useAuth = () => useContext(AuthContext);

export { sessionStore, api, usePolling, AuthProvider, useAuth };
