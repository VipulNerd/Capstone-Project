import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getMeetingStatus } from '../api/meetingService';
import usePolling from '../hooks/usePolling';
import { Button, ErrorMessage, Spinner } from '../components/common';
import WorkflowStepper from '../components/mom/WorkflowStepper';
import config from '../config';
import styles from './pages.module.css';

const ORDER = ['uploaded', 'transcribing', 'extracting', 'draft_ready'];

function buildSteps(sourceType) {
  return [
    { key: 'uploaded', label: sourceType === 'live' ? 'Meeting captured' : 'File uploaded' },
    sourceType === 'audio'
      ? { key: 'transcribing', label: 'Transcribing audio and identifying speakers' }
      : sourceType === 'live'
        ? { key: 'transcribing', label: 'Live transcript and Teams participants captured' }
        : { key: 'transcribing', label: 'Transcript received (no transcription needed)' },
    { key: 'extracting', label: 'Extracting discussion points, decisions and action items' },
    { key: 'draft_ready', label: 'MOM draft ready for review' },
  ];
}

export default function ProcessingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState(null);

  const status = meeting?.status;
  const finished = status === 'draft_ready' || status === 'failed' || status === 'approved' || status === 'sent';

  usePolling(
    async () => {
      try {
        const m = await getMeetingStatus(id);
        setMeeting(m);
        setError(null);
        if (m.status === 'draft_ready') navigate(`/meetings/${id}/review`, { replace: true });
        else if (m.status === 'approved' || m.status === 'sent') navigate(`/meetings/${id}`, { replace: true });
        else if (m.status === 'live') navigate(`/live/${id}`, { replace: true });
      } catch (err) {
        setError(err);
      }
    },
    config.POLL_INTERVAL_MS,
    !finished && error?.status !== 404,
  );

  if (error?.status === 404) {
    return (
      <div className="page">
        <ErrorMessage error="Meeting not found." />
        <div>
          <Button to="/history" variant="secondary">
            Back to history
          </Button>
        </div>
      </div>
    );
  }

  if (!meeting) return <Spinner label="Checking progress…" />;

  const currentIndex = ORDER.indexOf(status);
  const steps = buildSteps(meeting.sourceType);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{meeting.title}</h1>
          <p>We're turning your meeting into structured minutes. This page updates automatically.</p>
        </div>
      </div>

      <div className="card">
        <WorkflowStepper status={status} />
      </div>

      <ErrorMessage error={error} />

      {status === 'failed' ? (
        <div className="card">
          <ErrorMessage error="Processing failed. Please try uploading the file again." />
          <div style={{ marginTop: 12 }}>
            <Button to="/meetings/new">Upload again</Button>
          </div>
        </div>
      ) : (
        <div className="card">
          <ol className={styles.processSteps}>
            {steps.map((step, i) => {
              const done = i < currentIndex || status === 'draft_ready';
              const active = i === currentIndex && !done;
              return (
                <li
                  key={step.key}
                  className={`${styles.processStep} ${done ? styles.processDone : ''} ${active ? styles.processActive : ''}`}
                >
                  <span className={styles.processIcon}>
                    {done ? '✓' : active ? <Spinner size="sm" inline /> : i + 1}
                  </span>
                  {step.label}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
