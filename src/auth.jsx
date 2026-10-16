import React, { createContext, useContext, useEffect, useState } from "react";
import {
  Github,
  LogOut,
  ShieldCheck,
  KeyRound,
  AlertTriangle,
} from "lucide-react";
import { gateway, normalizeEndpoint } from "./api.js";
const Context = createContext(null);
export const useAuth = () => useContext(Context);
const makeNonce = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
export function AuthProvider({ children }) {
  const [endpoint, setEndpointState] = useState(() => {
    try {
      return (
        localStorage.getItem("rolecraft.gateway") ||
        import.meta.env.VITE_GATEWAY_URL ||
        ""
      );
    } catch {
      return import.meta.env.VITE_GATEWAY_URL || "";
    }
  });
  const [session, setSession] = useState(null),
    [apiKey, setApiKey] = useState(""),
    [keyMode, setKeyMode] = useState("personal"),
    [authError, setAuthError] = useState(""),
    [authBusy, setAuthBusy] = useState(false);
  useEffect(() => {
    // Remove the obsolete shared token from the previous version of Rolecraft.
    try {
      sessionStorage.removeItem("rolecraft.token");
    } catch {}
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (!fragment.has("session") && !fragment.has("auth_error")) return;
    const token = fragment.get("session"),
      state = fragment.get("state");
    history.replaceState(null, "", location.pathname + location.search);
    let expected;
    try {
      expected = sessionStorage.getItem("rolecraft.login-state");
      sessionStorage.removeItem("rolecraft.login-state");
    } catch {}
    if (!expected || expected !== state) {
      setAuthError(
        "Sign-in verification failed. Start sign-in from this browser tab.",
      );
      return;
    }
    if (fragment.has("auth_error")) {
      setAuthError(fragment.get("auth_error"));
      return;
    }
    setAuthBusy(true);
    let active = true;
    gateway({ endpoint, token }, "/session", {})
      .then((info) => {
        if (!active) return;
        setSession({ ...info, token });
        setKeyMode(info.owner && info.ownerKeyAvailable ? "owner" : "personal");
      })
      .catch((e) => {
        if (active) setAuthError(e.message);
      })
      .finally(() => {
        if (active) setAuthBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => {
        setSession(null);
        setApiKey("");
        setKeyMode("personal");
        setAuthError(
          "Your session expired. Sign in again to continue using AI.",
        );
      },
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session]);
  function setEndpoint(value) {
    const next = value
      ? normalizeEndpoint(value)
      : import.meta.env.VITE_GATEWAY_URL || "";
    if (value) localStorage.setItem("rolecraft.gateway", next);
    else localStorage.removeItem("rolecraft.gateway");
    if (next !== endpoint) {
      setSession(null);
      setApiKey("");
      setKeyMode("personal");
    }
    setEndpointState(next);
    setAuthError("");
  }
  function login() {
    if (!endpoint)
      throw new Error(
        "Add the deployed gateway URL first. GitHub login needs the backend.",
      );
    const nonce = makeNonce();
    sessionStorage.setItem("rolecraft.login-state", nonce);
    localStorage.setItem("rolecraft.gateway", normalizeEndpoint(endpoint));
    location.assign(
      normalizeEndpoint(endpoint) +
        "/auth/start?client_nonce=" +
        encodeURIComponent(nonce),
    );
  }
  function logout() {
    setSession(null);
    setApiKey("");
    setKeyMode("personal");
    setAuthError("");
  }
  const config = {
    endpoint,
    token: session?.token || "",
    apiKey: keyMode === "personal" ? apiKey : "",
    keyMode,
  };
  return (
    <Context.Provider
      value={{
        endpoint,
        setEndpoint,
        session,
        apiKey,
        setApiKey,
        keyMode,
        setKeyMode,
        authError,
        setAuthError,
        authBusy,
        login,
        logout,
        config,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function AccountStatus({ beforeLeave = async () => {}, onSettings }) {
  const a = useAuth();
  async function login() {
    try {
      if (!a.endpoint) {
        onSettings();
        return;
      }
      await beforeLeave();
      a.login();
    } catch (e) {
      a.setAuthError(e.message);
      onSettings();
    }
  }
  return (
    <div className="account-status">
      {a.session ? (
        <>
          <button className="account-badge" onClick={onSettings}>
            <Github size={15} />
            <span>{a.session.user.login}</span>
            {a.session.owner && <span className="owner-tag">Owner</span>}
          </button>
          <button
            className="icon-btn"
            title="Sign out"
            aria-label="Sign out"
            onClick={async () => {
              await beforeLeave();
              a.logout();
            }}
          >
            <LogOut size={15} />
          </button>
        </>
      ) : (
        <button
          className="btn github-login"
          onClick={login}
          disabled={a.authBusy}
        >
          <Github size={15} />
          {a.authBusy ? "Signing in…" : "Sign in with GitHub"}
        </button>
      )}
    </div>
  );
}
export function AuthPanel({ beforeLeave = async () => {} }) {
  const a = useAuth();
  const [url, setUrl] = useState(a.endpoint),
    [message, setMessage] = useState("");
  async function connect() {
    try {
      await beforeLeave();
      a.login();
    } catch (e) {
      a.setAuthError(e.message);
    }
  }
  return (
    <div className="auth-panel">
      <p>
        Sign in with GitHub to use AI. Only <strong>cam-petrie</strong> can use
        the gateway’s shared OpenAI key. Other accounts use their own key.
      </p>
      <label>
        Gateway URL
        <input
          placeholder="https://rolecraft-gateway.you.workers.dev"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="off"
        />
      </label>
      <button
        className="btn"
        onClick={async () => {
          try {
            await beforeLeave();
            a.setEndpoint(url.trim());
            setMessage("Gateway URL saved. Sign in to connect.");
          } catch (e) {
            a.setAuthError(e.message);
          }
        }}
      >
        Save gateway URL
      </button>
      {message && (
        <p className="small teal" role="status">
          {message}
        </p>
      )}
      {!a.endpoint && (
        <div className="notice info">
          <ShieldCheck size={17} />
          <span>
            The login backend has not been configured for this browser. The
            example and local editing still work. Finish the Cloudflare and
            GitHub OAuth setup in the project guide.
          </span>
        </div>
      )}
      {a.session ? (
        <div className="signed-in-card">
          <div className="row spread">
            <span>
              <Github size={16} /> Signed in as{" "}
              <strong>{a.session.user.login}</strong>
            </span>
            <button
              className="text-button"
              onClick={async () => {
                await beforeLeave();
                a.logout();
              }}
            >
              Sign out
            </button>
          </div>
          <small>
            Session expires{" "}
            {new Date(a.session.expiresAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            . Reloading requires signing in again.
          </small>
          {a.session.owner && (
            <label className="key-choice">
              OpenAI key
              <select
                value={a.keyMode}
                onChange={(e) => a.setKeyMode(e.target.value)}
              >
                <option value="owner" disabled={!a.session.ownerKeyAvailable}>
                  Owner’s backend key
                  {!a.session.ownerKeyAvailable ? " (not configured)" : ""}
                </option>
                <option value="personal">My own key for this session</option>
              </select>
            </label>
          )}
          {a.keyMode === "personal" && (
            <label>
              Your OpenAI API key
              <input
                type="password"
                autoComplete="off"
                maxLength={1003}
                spellCheck={false}
                value={a.apiKey}
                onChange={(e) => a.setApiKey(e.target.value.trim())}
                placeholder="sk-…"
              />
              <small>
                Held in memory only. Sent over HTTPS to this gateway for your AI
                requests, then used to call OpenAI. It is not saved in browser
                storage or on the server. Only use a gateway operator you trust.
              </small>
              <button
                className="text-button"
                type="button"
                onClick={() => a.setApiKey("")}
              >
                Clear key from memory
              </button>
            </label>
          )}
          {a.keyMode === "owner" && (
            <div className="notice info">
              <ShieldCheck size={16} />
              <span>
                Your verified GitHub ID authorizes the backend key. Its value is
                never sent to the browser or other users.
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="signin-callout">
          <button
            className="btn primary"
            disabled={!a.endpoint || a.authBusy}
            onClick={connect}
          >
            <Github size={16} /> Sign in with GitHub
          </button>
          <p className="small muted">
            GitHub supplies your public identity only. Rolecraft requests no
            repository access. Drafts saved while signed out remain in the
            separate local workspace; export a backup first if you want to
            import them after signing in.
          </p>
        </div>
      )}
      {a.authError && (
        <div className="notice error" role="alert">
          <AlertTriangle size={17} />
          <span>{a.authError}</span>
        </div>
      )}
      <div className="notice info">
        <KeyRound size={17} />
        <span>
          Account workspaces are separated in this browser. Files are not synced
          to GitHub. On a shared device, use separate browser profiles for
          privacy.
        </span>
      </div>
    </div>
  );
}
