import { useState } from 'react';
import { changePassword, rotateToken } from '../api/userService';
import {
  disconnectCalendar,
  getConnectUrl,
  listConnections,
  listProviders,
  PROVIDER_LABELS,
} from '../api/calendarService';
import useApi from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, ConfirmDialog, ErrorMessage, Input, Spinner, TokenReveal } from '../components/common';
import { hasErrors, validateNewPassword } from '../utils/validators';
import { formatDateTime } from '../utils/formatDate';

export default function SettingsPage() {
  const { user, replaceToken, updateUser } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch } = useApi(async () => {
    const [providers, connections] = await Promise.all([listProviders(), listConnections()]);
    return { providers, connections };
  }, []);
  const connections = data?.connections;
  // Google always listed (it's the recommended calendar); Outlook only when the server has it set up.
  const shownProviders = (data?.providers || []).filter(
    (p) => p.configured || p.provider === 'google' || connections?.some((c) => c.provider === p.provider),
  );
  const [confirm, setConfirm] = useState(null); // 'rotate' | { disconnect: provider }
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState(null);

  const [pw, setPw] = useState({ current: '', password: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState({});
  const [pwBusy, setPwBusy] = useState(false);
  const hasPassword = user?.hasPassword !== false;

  const savePassword = async (e) => {
    e.preventDefault();
    const errs = validateNewPassword(pw.password, pw.confirm);
    if (hasPassword && !pw.current) errs.current = 'Enter your current password';
    setPwErrors(errs);
    if (hasErrors(errs)) return;
    setPwBusy(true);
    try {
      updateUser(await changePassword(pw.current, pw.password));
      setPw({ current: '', password: '', confirm: '' });
      toast.success(hasPassword ? 'Password changed. Other browsers were signed out.' : 'Password set.');
    } catch (err) {
      if (err.status === 400) setPwErrors({ current: err.message });
      else toast.error(err.message);
    } finally {
      setPwBusy(false);
    }
  };
  const setPwField = (e) => setPw({ ...pw, [e.target.name]: e.target.value });

  const rotate = async () => {
    setBusy(true);
    try {
      const token = await rotateToken();
      replaceToken(token);
      setNewToken(token);
      toast.success('New token issued. The old one no longer works.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const connect = async (provider) => {
    try {
      window.open(await getConnectUrl(provider), '_blank', 'noopener');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const disconnect = async () => {
    const provider = confirm?.disconnect;
    setBusy(true);
    try {
      await disconnectCalendar(provider);
      toast.success(`${PROVIDER_LABELS[provider]} disconnected and its access tokens deleted`);
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
        <p className="muted small">Meetings you record are visible only to this account.</p>
      </div>

      <form className="card" onSubmit={savePassword} noValidate>
        <div className="card-title">
          <div>
            <h2>{hasPassword ? 'Change password' : 'Set a password'}</h2>
            <p className="muted small">
              {hasPassword
                ? 'Other browsers where you are signed in will be signed out. This one stays signed in.'
                : 'Your account was created before passwords existed. Set one to sign in on other browsers.'}
            </p>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12, maxWidth: 360 }}>
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
              {hasPassword ? 'Change password' : 'Set password'}
            </Button>
          </div>
        </div>
      </form>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>API token (optional)</h2>
            <p className="muted small">
              Only for scripts and integrations. You don't need it to sign in. Getting a new one signs out every
              browser.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setConfirm('rotate')}>
            Get a new token
          </Button>
        </div>
        {newToken && (
          <>
            <p className="small" style={{ color: 'var(--warning)' }}>
              Copy it now. It won't be shown again. This browser has already switched to it.
            </p>
            <TokenReveal token={newToken} />
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Calendars</h2>
            <p className="muted small">
              Connect a calendar to pick a meeting on New meeting: its title, time and attendees fill in automatically.
              Access is read-only.
            </p>
          </div>
        </div>
        {loading && !connections ? (
          <Spinner size="sm" />
        ) : error ? (
          <ErrorMessage error={error} onRetry={refetch} />
        ) : !shownProviders.length ? (
          <p className="muted small">
            No calendar is set up on this server yet. The admin adds Google Calendar with <code>GOOGLE_CLIENT_ID</code>{' '}
            (see deploy/vm/README.md). Until then, use .ics invites or enter participants manually.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {shownProviders.map(({ provider, configured }) => {
              const conn = connections.find((c) => c.provider === provider);
              return (
                <div key={provider} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <strong>{PROVIDER_LABELS[provider]}</strong>
                    {' · '}
                    {!configured ? (
                      <span className="muted">not set up on this server</span>
                    ) : conn ? (
                      <>
                        ✅ Connected as <strong>{conn.accountEmail || 'your account'}</strong> since{' '}
                        {formatDateTime(conn.connectedAt)}
                      </>
                    ) : (
                      <span className="muted">not connected</span>
                    )}
                  </span>
                  {configured &&
                    (conn ? (
                      <Button variant="secondary" onClick={() => setConfirm({ disconnect: provider })}>
                        Disconnect
                      </Button>
                    ) : (
                      <span className="row">
                        <Button onClick={() => connect(provider)}>Connect {PROVIDER_LABELS[provider]}</Button>
                        <Button variant="secondary" onClick={refetch}>
                          Refresh
                        </Button>
                      </span>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'rotate'}
        title="Get a new API token?"
        message="All your current sessions end immediately, including other browsers. This browser switches to the new token."
        confirmLabel="Get new token"
        loading={busy}
        onConfirm={rotate}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={!!confirm?.disconnect}
        title={`Disconnect ${PROVIDER_LABELS[confirm?.disconnect] || 'calendar'}?`}
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
