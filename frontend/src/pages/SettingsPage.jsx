import { useState } from "react";
import { changePassword, rotateToken } from "../api/userService";
import {
  disconnectCalendar,
  getMicrosoftConnectUrl,
  isMicrosoftConfigured,
  listConnections,
} from "../api/calendarService";
import useApi from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  Button,
  ConfirmDialog,
  ErrorMessage,
  Input,
  Spinner,
  TokenReveal,
} from "../components/common";
import { hasErrors, validateNewPassword } from "../utils/validators";
import { formatDateTime } from "../utils/formatDate";

export default function SettingsPage() {
  const { user, replaceToken, updateUser } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch } = useApi(async () => {
    const [configured, connections] = await Promise.all([
      isMicrosoftConfigured(),
      listConnections(),
    ]);
    return { configured, connections };
  }, []);
  const connections = data?.connections;
  const [confirm, setConfirm] = useState(null); // 'rotate' | 'disconnect'
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState(null);

  const [pw, setPw] = useState({ current: "", password: "", confirm: "" });
  const [pwErrors, setPwErrors] = useState({});
  const [pwBusy, setPwBusy] = useState(false);
  const hasPassword = user?.hasPassword !== false;

  const savePassword = async (e) => {
    e.preventDefault();
    const errs = validateNewPassword(pw.password, pw.confirm);
    if (hasPassword && !pw.current)
      errs.current = "Enter your current password";
    setPwErrors(errs);
    if (hasErrors(errs)) return;
    setPwBusy(true);
    try {
      updateUser(await changePassword(pw.current, pw.password));
      setPw({ current: "", password: "", confirm: "" });
      toast.success(
        hasPassword
          ? "Password changed. Other browsers were signed out."
          : "Password set.",
      );
    } catch (err) {
      if (err.status === 400) setPwErrors({ current: err.message });
      else toast.error(err.message);
    } finally {
      setPwBusy(false);
    }
  };
  const setPwField = (e) => setPw({ ...pw, [e.target.name]: e.target.value });

  const outlook = connections?.find((c) => c.provider === "microsoft");
  const calendarAvailable = data?.configured !== false;

  const rotate = async () => {
    setBusy(true);
    try {
      const token = await rotateToken();
      replaceToken(token);
      setNewToken(token);
      toast.success("New token issued. The old one no longer works.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const connect = async () => {
    try {
      window.open(await getMicrosoftConnectUrl(), "_blank", "noopener");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectCalendar("microsoft");
      toast.success("Outlook disconnected and its access tokens deleted");
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Your account, password and calendar connection.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Account</h2>
        </div>
        <p style={{ margin: 0 }}>
          <strong>{user?.name}</strong> · {user?.email}
        </p>
        <p className="muted small">
          Meetings you record are visible only to this account.
        </p>
      </div>

      <form className="card" onSubmit={savePassword} noValidate>
        <div className="card-title">
          <div>
            <h2>{hasPassword ? "Change password" : "Set a password"}</h2>
            <p className="muted small">
              {hasPassword
                ? "Other browsers where you are signed in will be signed out. This one stays signed in."
                : "Your account was created before passwords existed. Set one to sign in on other browsers."}
            </p>
          </div>
        </div>
        <div style={{ display: "grid", gap: 12, maxWidth: 360 }}>
          {hasPassword && (
            <Input
              label="Current password"
              name="current"
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={setPwField}
              error={pwErrors.current}
            />
          )}
          <Input
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={pw.password}
            onChange={setPwField}
            error={pwErrors.password}
            hint="At least 8 characters."
          />
          <Input
            label="Confirm new password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            value={pw.confirm}
            onChange={setPwField}
            error={pwErrors.confirm}
          />
          <div>
            <Button type="submit" loading={pwBusy}>
              {hasPassword ? "Change password" : "Set password"}
            </Button>
          </div>
        </div>
      </form>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>API token (optional)</h2>
            <p className="muted small">
              Only for scripts and integrations. You don't need it to sign in.
              Getting a new one signs out every browser.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setConfirm("rotate")}>
            Get a new token
          </Button>
        </div>
        {newToken && (
          <>
            <p className="small" style={{ color: "var(--warning)" }}>
              Copy it now. It won't be shown again. This browser has already
              switched to it.
            </p>
            <TokenReveal token={newToken} />
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Outlook calendar</h2>
            <p className="muted small">
              Lets you pick a meeting from your calendar so its attendees become
              the participants. Access is read-only.
            </p>
          </div>
        </div>
        {loading && !connections ? (
          <Spinner size="sm" />
        ) : !calendarAvailable ? (
          <p className="muted small">
            Not available: the backend has no Microsoft app configured (
            <code>MS_CLIENT_ID</code>). Use .ics invites or enter participants
            manually.
          </p>
        ) : error ? (
          <ErrorMessage error={error} onRetry={refetch} />
        ) : outlook ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              ✅ Connected as{" "}
              <strong>{outlook.accountEmail || "your account"}</strong> since{" "}
              {formatDateTime(outlook.connectedAt)}
            </span>
            <Button
              variant="secondary"
              onClick={() => setConfirm("disconnect")}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="row">
            <Button onClick={connect}>Connect Outlook</Button>
            <Button variant="secondary" onClick={refetch}>
              Refresh
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm === "rotate"}
        title="Get a new API token?"
        message="All your current sessions end immediately, including other browsers. This browser switches to the new token."
        confirmLabel="Get new token"
        loading={busy}
        onConfirm={rotate}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "disconnect"}
        title="Disconnect Outlook?"
        message="The stored access tokens are deleted. You can reconnect at any time."
        confirmLabel="Disconnect"
        variant="danger"
        loading={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
