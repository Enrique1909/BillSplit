import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";

/**
 * Direct Google Sign-In (Google Identity Services) — no third-party auth vendor,
 * $0, no user cap. The GIS script issues a Google ID token (JWT) on sign-in; we
 * keep it client-side for display + send it as a Bearer token to the backend,
 * which verifies it with Google's free library. Token lifetime is ~1h; GIS
 * auto-select silently re-issues for returning users.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const STORAGE_KEY = "billsplit-google-credential";

export interface GoogleUser {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  exp: number; // seconds since epoch
}

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

interface AuthContextValue {
  ready: boolean; // GIS loaded / restore attempted
  configured: boolean; // VITE_GOOGLE_CLIENT_ID present
  user: GoogleUser | null;
  getToken: () => string | null; // valid (non-expired) token or null
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  ready: false,
  configured: false,
  user: null,
  getToken: () => null,
  signOut: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GoogleUser | null>(null);

  const apply = useCallback((credential: string | null) => {
    if (!credential) {
      setToken(null);
      setUser(null);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    const p = decodeJwt(credential);
    if (!p?.sub || (p.exp && p.exp * 1000 <= Date.now())) {
      // malformed or already expired
      setToken(null);
      setUser(null);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    setToken(credential);
    setUser({ sub: p.sub, email: p.email, name: p.name, picture: p.picture, exp: p.exp });
    try {
      localStorage.setItem(STORAGE_KEY, credential);
    } catch {
      /* ignore */
    }
  }, []);

  // Restore a saved token, then load + initialise GIS.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) apply(saved);
    } catch {
      /* ignore */
    }

    if (!CLIENT_ID) {
      setReady(true);
      return;
    }

    const onLoaded = () => {
      window.google?.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (resp) => apply(resp.credential),
        auto_select: true,
        cancel_on_tap_outside: false,
      });
      setReady(true);
    };

    if (window.google?.accounts?.id) {
      onLoaded();
    } else {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = onLoaded;
      s.onerror = () => setReady(true); // don't hang if GIS fails to load
      document.head.appendChild(s);
    }
  }, [apply]);

  // Drop the session the moment the token expires (so the gate re-appears).
  useEffect(() => {
    if (!user) return;
    const ms = user.exp * 1000 - Date.now();
    if (ms <= 0) {
      apply(null);
      return;
    }
    const id = setTimeout(() => apply(null), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [user, apply]);

  const getToken = useCallback(() => {
    if (!token) return null;
    const p = decodeJwt(token);
    if (!p || (p.exp && p.exp * 1000 <= Date.now())) {
      apply(null);
      return null;
    }
    return token;
  }, [token, apply]);

  const signOut = useCallback(() => {
    try {
      window.google?.accounts.id.disableAutoSelect();
    } catch {
      /* ignore */
    }
    apply(null);
  }, [apply]);

  return (
    <AuthContext.Provider value={{ ready, configured: !!CLIENT_ID, user, getToken, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Renders the official Google button into a div via GIS.
 * `theme` follows the app theme so the button reads on either background.
 *
 * Note: we deliberately do NOT call `google.accounts.id.prompt()` (One Tap)
 * here. This button already lives inside our own sign-in modal, so One Tap
 * would stack a *second* Google prompt on top of it — a confusing double
 * pop-up, plus its iframe leaves a white strip on mobile. Returning users are
 * still restored silently via `auto_select` + the saved token.
 */
export function GoogleSignInButton({ dark }: { dark?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { ready } = useAuth();
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.google?.accounts?.id) return; // GIS not loaded yet
    el.innerHTML = "";
    window.google.accounts.id.renderButton(el, {
      type: "standard",
      theme: dark ? "filled_black" : "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      logo_alignment: "left",
      width: 280,
    });
    // `ready` flips true once GIS is initialised, re-running this to draw the button.
  }, [dark, ready]);
  return <div ref={ref} className="flex justify-center min-h-[44px]" />;
}
