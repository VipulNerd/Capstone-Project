import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { getMeeting } from '../api/meetingService';
import { exportMom, reopenMom } from '../api/momService';
import { distributeMom, getDeliveries } from '../api/emailService';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Button, ConfirmDialog, ErrorMessage, Spinner } from '../components/common';
import DeliveryTable from '../components/mom/DeliveryTable';
import WorkflowStepper from '../components/mom/WorkflowStepper';
import { formatDate, formatDateTime } from '../utils/formatDate';
import { recipientEmails } from '../utils/recipients';
import { redirectFor } from './meetingLinks';
import styles from './pages.module.css';

const FORMATS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word (DOCX)' },
];

export default function DistributionPage() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, setData, loading, error, refetch } = useApi(async () => {
    const [meeting, deliveries] = await Promise.all([getMeeting(id), getDeliveries(id)]);
    return { meeting, deliveries };
  }, [id]);

  const [format, setFormat] = useState('pdf');
  const [confirm, setConfirm] = useState(null); // 'send' | 'reopen'
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [downloading, setDownloading] = useState(null);

  if (loading && !data) return <Spinner label="Loading…" />;
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!data) return null;

  const { meeting, deliveries } = data;
  const redirect = redirectFor(meeting, ['approved', 'distributed']);
  if (redirect) return <Navigate to={redirect} replace />;

  const recipients = recipientEmails(meeting.participants, meeting.organizerEmail);
  const noEmail = meeting.participants.filter((p) => !p.email);
  const alreadySent = meeting.status === 'distributed';

  const send = async () => {
    setBusy(true);
    try {
      const result = await distributeMom(id, format);
      setLastResult(result);
      const [m, list] = await Promise.all([getMeeting(id), getDeliveries(id)]);
      setData({ meeting: m, deliveries: list });
      if (result.emailMode === 'console')
        toast.error("Not emailed: email sending isn't set up on this server. Ask the admin to configure SMTP.");
      else if (result.failed) toast.error(`Sent to ${result.sent}, failed for ${result.failed}. See the delivery log.`);
      else toast.success(`MOM emailed to ${result.sent} recipient(s)`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const reopen = async () => {
    setBusy(true);
    try {
      await reopenMom(id);
      toast.success('Approval withdrawn. You can edit the draft again.');
      navigate(`/meetings/${id}/review`);
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
      setConfirm(null);
    }
  };

  const download = async (fmt) => {
    setDownloading(fmt);
    try {
      await exportMom(id, fmt, `MOM - ${meeting.title}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Distribute: {meeting.title}</h1>
          <p>
            {formatDate(meeting.date)} · Approved by {meeting.approvedBy} on {formatDateTime(meeting.approvedAt)}
          </p>
        </div>
        <div className="row">
          <Button variant="secondary" onClick={() => download('pdf')} loading={downloading === 'pdf'}>
            ⬇ PDF
          </Button>
          <Button variant="secondary" onClick={() => download('docx')} loading={downloading === 'docx'}>
            ⬇ DOCX
          </Button>
          <Button variant="ghost" to={`/meetings/${id}`}>
            View MOM
          </Button>
        </div>
      </div>

      <div className="card">
        <WorkflowStepper status={meeting.status} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <h2>Attachment format</h2>
          </div>
          <div className={styles.checkboxRow} role="radiogroup" aria-label="Attachment format">
            {FORMATS.map((f) => (
              <label key={f.value} className={styles.checkbox}>
                <input
                  type="radio"
                  name="format"
                  value={f.value}
                  checked={format === f.value}
                  onChange={() => setFormat(f.value)}
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <h2>Recipients ({recipients.length})</h2>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
            {recipients.map((email) => {
              const p = meeting.participants.find((x) => x.email.toLowerCase() === email);
              return (
                <li key={email}>
                  {p?.name || meeting.organizerName} <span className="muted">&lt;{email}&gt;</span>
                  {email === meeting.organizerEmail.toLowerCase() && <span className="muted"> · organiser</span>}
                </li>
              );
            })}
          </ul>
          {noEmail.length > 0 && (
            <p className="small" style={{ color: 'var(--warning)', marginTop: 10 }}>
              Not sent to {noEmail.map((p) => p.name).join(', ')} (no email address).
            </p>
          )}
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {!alreadySent && (
          <Button variant="secondary" onClick={() => setConfirm('reopen')}>
            Withdraw approval & edit
          </Button>
        )}
        <Button onClick={() => setConfirm('send')}>{alreadySent ? 'Resend to everyone' : 'Send MOM'}</Button>
      </div>

      {lastResult?.emailMode === 'console' && (
        <div className={`card ${styles.deliverySummary}`} role="alert">
          <span>⚠️ Nothing was emailed. This server has no email account configured, so the MOM was only saved on the server.</span>
          <span className="muted">The admin sets EMAIL_BACKEND=smtp and SMTP details (see deploy/vm/README.md), then you can resend.</span>
        </div>
      )}

      {lastResult && lastResult.emailMode !== 'console' && (
        <div className={`card ${styles.deliverySummary}`}>
          <span>✅ {lastResult.sent} sent</span>
          <span>⚠️ {lastResult.failed} failed</span>
          {lastResult.failed > 0 && <span className="muted">Fix the address or mail settings, then resend.</span>}
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <h2>Delivery log</h2>
        </div>
        {deliveries.length ? (
          <DeliveryTable deliveries={deliveries} />
        ) : (
          <p className="muted small">Nothing has been sent yet.</p>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'send'}
        title={alreadySent ? 'Resend the MOM?' : 'Send the MOM?'}
        message={
          <>
            The minutes will be emailed as <strong>{format.toUpperCase()}</strong> to{' '}
            <strong>{recipients.length} recipient(s)</strong>
            {alreadySent && ', including everyone who already received it'}.
          </>
        }
        confirmLabel="Send now"
        loading={busy}
        onConfirm={send}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirm === 'reopen'}
        title="Withdraw approval?"
        message="The MOM goes back to draft so you can edit it. You'll need to approve it again before sending."
        confirmLabel="Withdraw approval"
        variant="danger"
        loading={busy}
        onConfirm={reopen}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
