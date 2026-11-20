import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { exportMom, getMom } from '../api/momService';
import { getDeliveries } from '../api/emailService';
import { getTranscript } from '../api/liveService';
import TranscriptFeed from '../components/live/TranscriptFeed';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Button, ErrorMessage, Spinner, StatusBadge } from '../components/common';
import MomView from '../components/mom/MomView';
import DeliveryTable from '../components/mom/DeliveryTable';
import { formatDate } from '../utils/formatDate';

export default function MeetingDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data, loading, error, refetch } = useApi(
    async () => {
      const [mom, deliveries, transcript] = await Promise.all([getMom(id), getDeliveries(id), getTranscript(id)]);
      return { mom, deliveries, transcript };
    },
    [id],
  );
  const [downloading, setDownloading] = useState(null);

  if (error?.status === 409) return <Navigate to={`/meetings/${id}/processing`} replace />;
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!data) return null;

  const { mom, deliveries, transcript } = data;
  if (mom.status === 'draft_ready') return <Navigate to={`/meetings/${id}/review`} replace />;

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
          <div className="row">
            <h1>{mom.title}</h1>
            <StatusBadge status={mom.status} />
          </div>
          <p>Minutes of meeting · {formatDate(mom.date)}</p>
        </div>
        <div className="row">
          <Button variant="secondary" onClick={() => download('pdf')} loading={downloading === 'pdf'}>
            ⬇ PDF
          </Button>
          <Button variant="secondary" onClick={() => download('docx')} loading={downloading === 'docx'}>
            ⬇ DOCX
          </Button>
          <Button to={`/meetings/${id}/distribute`}>{deliveries.length ? 'Manage delivery' : 'Send MOM'}</Button>
        </div>
      </div>

      <div className="card">
        <MomView mom={mom} />
      </div>

      {transcript.length > 0 && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Transcript ({transcript.length} lines)</summary>
          <div style={{ marginTop: 14 }}>
            <TranscriptFeed lines={transcript} />
          </div>
        </details>
      )}

      <div className="card">
        <div className="card-title">
          <h2>Delivery log</h2>
        </div>
        {deliveries.length ? (
          <DeliveryTable deliveries={deliveries} />
        ) : (
          <p className="muted small">This MOM hasn't been emailed yet.</p>
        )}
      </div>
    </div>
  );
}
