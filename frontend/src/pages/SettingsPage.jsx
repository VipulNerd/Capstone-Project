import { useState } from 'react';
import { rotateToken } from '../api/userService';
import { disconnectCalendar, getMicrosoftConnectUrl, isMicrosoftConfigured, listConnections } from '../api/calendarService';
import useApi from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, ConfirmDialog, ErrorMessage, Spinner, TokenReveal } from '../components/common';
import { formatDateTime } from '../utils/formatDate';

export default function SettingsPage() {
  const { user, replaceToken } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch } = useApi(async () => {
    const [configured, connections] = await Promise.all([isMicrosoftConfigured(), listConnections()]);
    return { configured, connections };
  }, []);
  const connections = data?.connections;
  const [confirm, setConfirm] = useState(null); // 'rotate' | 'disconnect'
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState(null);

  const outlook = connections?.find((c) => c.provider === 'microsoft');
  const calendarAvailable = data?.configured !== false;

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

  const connect = async () => {
    try {
      window.open(await getMicrosoftConnectUrl(), '_blank', 'noopener');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectCalendar('microsoft');
      toast.success('Outlook disconnected and its access tokens deleted');
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
          <p>Your account, sign-in token and calendar connection.</p>
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

      <div className="card">
        <div className="card-title">
          <div>
            <h2>API token</h2>
            <p className="muted small">
              Your sign-in key. Use it to sign in on another browser. Get a new one if it may have been shared by mistake.
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
            <h2>Outlook calendar</h2>
            <p className="muted small">
              Lets you pick a meeting from your calendar so its attendees become the participants. Access is read-only.
            </p>
          </div>
        </div>
        {loading && !connections ? (
          <Spinner size="sm" />
        ) : !calendarAvailable ? (
          <p className="muted small">
            Not available: the backend has no Microsoft app configured (<code>MS_CLIENT_ID</code>). Use .ics invites or
            enter participants manually.
          </p>
        ) : error ? (
          <ErrorMessage error={error} onRetry={refetch} />
        ) : outlook ? (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              ✅ Connected as <strong>{outlook.accountEmail || 'your account'}</strong> since {formatDateTime(outlook.connectedAt)}
            </span>
            <Button variant="secondary" onClick={() => setConfirm('disconnect')}>
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
        open={confirm === 'rotate'}
        title="Get a new API token?"
        message="Your current token stops working immediately, including in any other browser where you're signed in."
        confirmLabel="Get new token"
        loading={busy}
        onConfirm={rotate}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'disconnect'}
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
