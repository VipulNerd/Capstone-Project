import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { exportMom, getMom } from '../api/momService';
import { getDeliveries, retryDelivery, sendMom } from '../api/emailService';
import useApi from '../hooks/useApi';
import usePolling from '../hooks/usePolling';
import { useToast } from '../context/ToastContext';
import { Button, ConfirmDialog, ErrorMessage, Spinner } from '../components/common';
import DeliveryTable from '../components/mom/DeliveryTable';
import WorkflowStepper from '../components/mom/WorkflowStepper';
import { formatDate } from '../utils/formatDate';
import config from '../config';
import styles from './pages.module.css';

export default function DistributionPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data: mom, loading, error, refetch } = useApi(() => getMom(id), [id]);

  const [formats, setFormats] = useState({ pdf: true, docx: false });
  const [deliveries, setDeliveries] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [deliveriesLoaded, setDeliveriesLoaded] = useState(false);

  const pendingCount = deliveries.filter((d) => d.status === 'queued').length;

  // Load existing delivery records, then keep polling while any are still queued.
  usePolling(
    async () => {
      const list = await getDeliveries(id);
      setDeliveries(list);
      setDeliveriesLoaded(true);
    },
    config.POLL_INTERVAL_MS,
    !!mom && (!deliveriesLoaded || pendingCount > 0) && !sending,
  );

  if (loading && !mom) return <Spinner label="Loading…" />;
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!mom) return null;
  if (mom.status === 'draft_ready') return <Navigate to={`/meetings/${id}/review`} replace />;

  const selectedFormats = Object.keys(formats).filter((f) => formats[f]);
  const recipients = mom.participants.filter((p) => p.email);
  const noEmail = mom.participants.filter((p) => !p.email);
  const sentCount = deliveries.filter((d) => d.status === 'sent').length;
  const failedCount = deliveries.filter((d) => d.status === 'failed').length;
  const alreadySent = deliveries.length > 0;

  const send = async () => {
    setSending(true);
    try {
      await sendMom(id, selectedFormats);
      setDeliveries(await getDeliveries(id));
      toast.success(`MOM queued for ${recipients.length} recipients`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  };

  const retry = async (email) => {
    setRetrying(email);
    try {
      await retryDelivery(id, email);
      setDeliveries(await getDeliveries(id));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetrying(null);
    }
  };

  const download = async (format) => {
    setDownloading(format);
    try {
      await exportMom(id, format, `MOM - ${mom.title}`);
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
          <h1>Distribute: {mom.title}</h1>
          <p>{formatDate(mom.date)} · Approved. Choose the formats and send the minutes to every participant.</p>
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
        <WorkflowStepper status={sentCount && sentCount === deliveries.length ? 'sent' : 'approved'} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <h2>Attachment format</h2>
          </div>
          <div className={styles.checkboxRow}>
            {['pdf', 'docx'].map((f) => (
              <label key={f} className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={formats[f]}
                  onChange={(e) => setFormats((prev) => ({ ...prev, [f]: e.target.checked }))}
                />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
          {!selectedFormats.length && (
            <p className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>
              Select at least one format.
            </p>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h2>Recipients ({recipients.length})</h2>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
            {recipients.map((p) => (
              <li key={p.email}>
                {p.name} <span className="muted">&lt;{p.email}&gt;</span>
              </li>
            ))}
          </ul>
          {noEmail.length > 0 && (
            <p className="small" style={{ color: 'var(--warning)', marginTop: 10 }}>
              Not sent to {noEmail.map((p) => p.name).join(', ')} (no email address).
            </p>
          )}
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => setConfirmOpen(true)} disabled={!selectedFormats.length || pendingCount > 0 || !recipients.length}>
          {alreadySent ? 'Resend to all' : 'Send MOM to all participants'}
        </Button>
      </div>

      {alreadySent && (
        <div className="card">
          <div className="card-title">
            <h2>Delivery status</h2>
            <div className={styles.deliverySummary}>
              <span>✅ {sentCount} sent</span>
              <span>⏳ {pendingCount} queued</span>
              <span>⚠️ {failedCount} failed</span>
            </div>
          </div>
          <DeliveryTable deliveries={deliveries} onRetry={retry} retrying={retrying} />
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={alreadySent ? 'Resend the MOM?' : 'Send the MOM?'}
        message={
          <>
            The minutes will be emailed as <strong>{selectedFormats.map((f) => f.toUpperCase()).join(' + ')}</strong> to{' '}
            <strong>{recipients.length} participants</strong>.
          </>
        }
        confirmLabel="Send now"
        loading={sending}
        onConfirm={send}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
