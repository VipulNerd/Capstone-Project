import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { deleteMeeting, getMeeting } from '../api/meetingService';
import { exportMom } from '../api/momService';
import { getDeliveries } from '../api/emailService';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Button, ConfirmDialog, ErrorMessage, Spinner, StatusBadge } from '../components/common';
import MomView from '../components/mom/MomView';
import DeliveryTable from '../components/mom/DeliveryTable';
import TranscriptView from '../components/mom/TranscriptView';
import { formatDate, formatDateTime } from '../utils/formatDate';
import { redirectFor } from './meetingLinks';

export default function MeetingDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApi(async () => {
    const [meeting, deliveries] = await Promise.all([getMeeting(id), getDeliveries(id)]);
    return { meeting, deliveries };
  }, [id]);
  const [downloading, setDownloading] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!data) return null;

  const { meeting, deliveries } = data;
  const redirect = redirectFor(meeting, ['approved', 'distributed']);
  if (redirect) return <Navigate to={redirect} replace />;

  const download = async (format) => {
    setDownloading(format);
    try {
      await exportMom(id, format, `MOM - ${meeting.title}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(null);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteMeeting(id);
      toast.success('Meeting deleted');
      navigate('/history', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="row">
            <h1>{meeting.title}</h1>
            <StatusBadge status={meeting.status} />
          </div>
          <p>
            Minutes of meeting · {formatDate(meeting.date)} · Organised by {meeting.organizerName} · Approved by{' '}
            {meeting.approvedBy} on {formatDateTime(meeting.approvedAt)}
          </p>
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
        <MomView mom={meeting} />
      </div>

      <TranscriptView meeting={meeting} />

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

      <div>
        <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
          🗑 Delete meeting
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this meeting?"
        message="The MOM, transcript, uploaded file and delivery log are permanently removed."
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
