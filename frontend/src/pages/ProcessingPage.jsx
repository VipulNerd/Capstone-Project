import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { getMeeting, listChunks, retryMeeting } from '../api/meetingService';
import usePolling from '../hooks/usePolling';
import { useToast } from '../context/ToastContext';
import { Button, ErrorMessage, Spinner } from '../components/common';
import WorkflowStepper from '../components/mom/WorkflowStepper';
import TranscriptView from '../components/mom/TranscriptView';
import { redirectFor } from './meetingLinks';
import config from '../config';
import styles from './pages.module.css';

// The backend has one "finalizing" status; chunk statuses and has_transcript show how far it got.
function buildSteps(meeting, chunks) {
  const total = chunks.length;
  const transcribed = chunks.filter((c) => c.status === 'transcribed').length;
  const allTranscribed = total > 0 && transcribed === total;
  const running = meeting.status === 'finalizing';
  const state = (done, active) => (done ? 'done' : active && running ? 'active' : 'todo');
  return [
    { label: `Audio received (${total} chunk${total === 1 ? '' : 's'})`, state: 'done' },
    {
      label: `Transcribing and separating speakers (${transcribed}/${total})`,
      state: state(allTranscribed || meeting.hasTranscript, true),
    },
    {
      label: 'Matching voices to participants and cleaning up the transcript',
      state: state(meeting.hasTranscript, allTranscribed),
    },
    { label: 'Writing summary, decisions and action items', state: state(false, meeting.hasTranscript) },
  ];
}

export default function ProcessingPage() {
  const { id } = useParams();
  const toast = useToast();
  const [meeting, setMeeting] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(null);

  const active = (!meeting || meeting.status === 'finalizing') && error?.status !== 404;
  usePolling(
    async () => {
      try {
        const [m, c] = await Promise.all([getMeeting(id), listChunks(id)]);
        setMeeting(m);
        setChunks(c);
        setError(null);
      } catch (err) {
        setError(err);
      }
    },
    config.POLL_INTERVAL_MS,
    active,
  );

  const retry = async (skipFailed) => {
    setRetrying(skipFailed ? 'skip' : 'all');
    try {
      setMeeting(await retryMeeting(id, skipFailed));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetrying(null);
    }
  };

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
  if (!meeting) return error ? <ErrorMessage error={error} /> : <Spinner label="Checking progress…" />;

  const redirect = redirectFor(meeting, ['finalizing', 'failed']);
  if (redirect) return <Navigate to={redirect} replace />;

  const failedChunks = chunks.filter((c) => c.status === 'failed');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{meeting.title}</h1>
          <p>We're turning the recording into a transcript and minutes. This page updates automatically.</p>
        </div>
      </div>

      <div className="card">
        <WorkflowStepper status={meeting.status} />
      </div>

      <ErrorMessage error={error} />

      {meeting.status === 'failed' && (
        <div className="card">
          <ErrorMessage error={`Processing failed: ${meeting.errorMessage || 'unknown error'}`} />
          <p className="muted small">
            Retrying continues where it stopped. Audio that was already transcribed isn't sent again.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <Button onClick={() => retry(false)} loading={retrying === 'all'} disabled={!!retrying}>
              Retry
            </Button>
            {failedChunks.length > 0 && (
              <Button variant="secondary" onClick={() => retry(true)} loading={retrying === 'skip'} disabled={!!retrying}>
                Retry without the {failedChunks.length} unreadable chunk(s)
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <ol className={styles.processSteps}>
          {buildSteps(meeting, chunks).map((step, i) => (
            <li
              key={step.label}
              className={`${styles.processStep} ${step.state === 'done' ? styles.processDone : ''} ${
                step.state === 'active' ? styles.processActive : ''
              }`}
            >
              <span className={styles.processIcon}>
                {step.state === 'done' ? '✓' : step.state === 'active' ? <Spinner size="sm" inline /> : i + 1}
              </span>
              {step.label}
            </li>
          ))}
        </ol>
      </div>

      {/* The transcript is saved before the MOM is drafted, so it's available even if drafting fails. */}
      <TranscriptView meeting={meeting} title="Transcript (ready)" />
    </div>
  );
}
