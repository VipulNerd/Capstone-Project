import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { deleteMeeting, endMeeting, getMeeting } from '../api/meetingService';
import useApi from '../hooks/useApi';
import useMeetingRecorder from '../hooks/useMeetingRecorder';
import usePictureInPicture from '../hooks/usePictureInPicture';
import { useToast } from '../context/ToastContext';
import { Button, ConfirmDialog, ErrorMessage, Select, Spinner, StatusBadge } from '../components/common';
import WorkflowStepper from '../components/mom/WorkflowStepper';
import Avatar from '../components/live/Avatar';
import RecTimer from '../components/live/RecTimer';
import RecordingOverlay from '../components/live/RecordingOverlay';
import { AUDIO_EXTENSIONS, formatBytes, validateAudioFile } from '../utils/fileHelpers';
import { redirectFor } from './meetingLinks';
import config from '../config';
import liveStyles from '../components/live/live.module.css';
import styles from './pages.module.css';

const TRACKS = {
  mic: {
    title: '🎙️ Your microphone',
    help: 'Records your own voice. It is labelled with your name automatically.',
    start: 'Start microphone',
  },
  meeting: {
    title: '🔊 Meeting audio (everyone else)',
    help: 'In the share dialog pick the Teams / Meet / Zoom browser tab and tick “Share tab audio”. For a desktop app, share your entire screen and tick “Share system audio”.',
    start: 'Share meeting audio',
  },
};

const STATE_TEXT = { off: 'Not started', starting: 'Waiting for permission…', on: '● Capturing', ended: 'Stopped', error: 'Could not start' };

function Recorder({ meeting, onEnded }) {
  const toast = useToast();
  const navigate = useNavigate();
  const recorder = useMeetingRecorder(meeting);
  const pip = usePictureInPicture({ width: 340, height: 260 });
  const [confirm, setConfirm] = useState(null); // 'end' | 'discard'
  const [ending, setEnding] = useState(false);
  const [fileTrack, setFileTrack] = useState('meeting');
  const fileInput = useRef(null);

  const unsaved = recorder.capturing || recorder.pendingUploads > 0;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => unsaved && !ending && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!unsaved) return undefined;
    const handler = (e) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [unsaved]);

  const end = async () => {
    setEnding(true);
    try {
      const count = await recorder.finish();
      if (!count) {
        toast.error('No audio has been recorded yet. Capture some audio or upload a recording first.');
        setEnding(false);
        setConfirm(null);
        return;
      }
      await endMeeting(meeting.id);
      pip.close();
      toast.success('Meeting ended. Writing the transcript and minutes…');
      onEnded();
    } catch (err) {
      toast.error(err.message);
      setEnding(false);
      setConfirm(null);
    }
  };

  const discard = async () => {
    setEnding(true);
    try {
      await recorder.finish().catch(() => {});
      await deleteMeeting(meeting.id);
      pip.close();
      toast.success('Meeting discarded');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setEnding(false);
      setConfirm(null);
    }
  };

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = validateAudioFile(file, config.MAX_CHUNK_MB);
    if (problem) return toast.error(problem);
    recorder.uploadFile(file, fileTrack);
    toast.success(`Uploading ${file.name}`);
  };

  // Stop from the floating window: ask there, since this tab is probably hidden behind the meeting.
  const endFromOverlay = () => {
    if (pip.pipWindow?.confirm('End the meeting and generate the minutes?')) end();
  };

  const done = recorder.uploads.filter((u) => u.state === 'done').length;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="row">
            <h1>{meeting.title}</h1>
            <RecTimer startedAt={meeting.recordingStartedAt} paused={recorder.paused} active={recorder.capturing} />
          </div>
          <p>Keep this tab open during the meeting. Audio is saved every {Math.round(config.CHUNK_SECONDS / 60)} minutes.</p>
        </div>
        <div className="row">
          {pip.supported && (
            <Button
              variant="secondary"
              onClick={() => (pip.pipWindow ? pip.close() : pip.open().catch(() => toast.error('Could not open the overlay window')))}
            >
              {pip.pipWindow ? 'Close overlay' : '⧉ Pop out overlay'}
            </Button>
          )}
          <Button variant="secondary" onClick={recorder.paused ? recorder.resume : recorder.pause} disabled={!recorder.capturing || ending}>
            {recorder.paused ? '▶ Resume' : '❚❚ Pause'}
          </Button>
          <Button variant="danger" onClick={() => setConfirm('end')} loading={ending && confirm === 'end'}>
            ■ End & generate MOM
          </Button>
        </div>
      </div>

      <div className="card">
        <WorkflowStepper status="recording" />
      </div>

      <ErrorMessage error={recorder.error} />

      <div className={liveStyles.liveLayout}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div className="card">
            <div className="card-title">
              <h2>Audio sources</h2>
            </div>
            <div className={styles.trackGrid}>
              {Object.entries(TRACKS).map(([track, t]) => {
                const state = recorder.tracks[track];
                return (
                  <div key={track} className={`${styles.trackCard} ${state === 'on' ? styles.trackOn : ''}`}>
                    <h3>{t.title}</h3>
                    <p className="muted small" style={{ margin: 0 }}>
                      {t.help}
                    </p>
                    <span className={styles.trackState} style={{ color: state === 'on' ? 'var(--success)' : undefined }}>
                      {STATE_TEXT[state]}
                    </span>
                    {state !== 'on' && (
                      <Button size="sm" onClick={() => recorder.startTrack(track)} loading={state === 'starting'} disabled={ending}>
                        {state === 'ended' || state === 'error' ? 'Start again' : t.start}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Use both for an online meeting. For an in-room meeting, the microphone alone is enough.
            </p>
          </div>

          <div className="card">
            <div className="card-title">
              <div>
                <h2>Saved audio ({done})</h2>
                <p className="muted small">Each chunk is uploaded as soon as it is cut. Failed uploads are retried automatically.</p>
              </div>
              {recorder.failedUploads > 0 && (
                <Button size="sm" variant="secondary" onClick={recorder.retryFailed}>
                  Retry failed uploads
                </Button>
              )}
            </div>
            {recorder.uploads.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Track</th>
                      <th>Chunk</th>
                      <th>Size</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recorder.uploads.map((u) => (
                      <tr key={`${u.track}-${u.seq}`}>
                        <td>{u.track === 'mic' ? 'Microphone' : 'Meeting audio'}</td>
                        <td>#{u.seq + 1}</td>
                        <td>{formatBytes(u.size)}</td>
                        <td>
                          <StatusBadge status={u.state} kind="chunk" />
                          {u.state === 'uploading' && u.progress ? <span className="small muted"> {u.progress}%</span> : null}
                          {u.error && (
                            <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>
                              {u.error}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">Nothing yet. The first chunk is saved when you pause, end, or after {config.CHUNK_SECONDS} seconds.</p>
            )}
          </div>

          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Upload a recording instead</summary>
            <p className="muted small">
              Already have a recording of this meeting? Upload it ({AUDIO_EXTENSIONS.join(', ')}, up to {config.MAX_CHUNK_MB}{' '}
              MB) and then end the meeting.
            </p>
            <div className="row">
              <Select
                aria-label="Whose audio is in the file"
                value={fileTrack}
                onChange={(e) => setFileTrack(e.target.value)}
                options={[
                  { value: 'meeting', label: 'Whole meeting (everyone)' },
                  { value: 'mic', label: 'Only my voice' },
                ]}
              />
              <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={ending}>
                Choose audio file
              </Button>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept={AUDIO_EXTENSIONS.map((x) => `.${x}`).join(',')}
                onChange={pickFile}
                data-testid="recording-file"
              />
            </div>
          </details>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <div className="card-title">
              <h2>Participants ({meeting.participants.length})</h2>
            </div>
            <ul className={liveStyles.people}>
              {meeting.participants.map((p, i) => (
                <li key={i} className={liveStyles.person}>
                  <Avatar name={p.name} />
                  <div className={liveStyles.personInfo}>
                    <div>{p.name}</div>
                    <div className="muted small">{p.email || 'No email'}</div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="muted small" style={{ marginBottom: 0 }}>
              The AI uses these names to work out who is speaking. You can edit them when you review the minutes.
            </p>
          </div>
          <Button variant="ghost" onClick={() => setConfirm('discard')} disabled={ending}>
            🗑 Discard meeting
          </Button>
        </aside>
      </div>

      {pip.pipWindow &&
        createPortal(<RecordingOverlay meeting={meeting} recorder={recorder} onEnd={endFromOverlay} busy={ending} />, pip.pipWindow.document.body)}

      <ConfirmDialog
        open={confirm === 'end'}
        title="End the meeting?"
        message="Recording stops, the remaining audio is uploaded, and the AI writes the transcript and minutes. This can take a few minutes."
        confirmLabel="End & generate MOM"
        loading={ending}
        onConfirm={end}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        title="Discard this meeting?"
        message="The meeting and all audio recorded so far are deleted. This can't be undone."
        confirmLabel="Discard"
        variant="danger"
        loading={ending}
        onConfirm={discard}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave while recording?"
        message="Recording stops if you leave this page, and audio that hasn't been uploaded yet is lost. You can come back later and continue recording."
        confirmLabel="Leave anyway"
        variant="danger"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </>
  );
}

export default function RecordPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: meeting, loading, error, refetch } = useApi(() => getMeeting(id), [id]);

  if (loading && !meeting) return <Spinner />;
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!meeting) return null;
  const redirect = redirectFor(meeting, ['recording']);
  if (redirect) return <Navigate to={redirect} replace />;

  return (
    <div className="page">
      <Recorder meeting={meeting} onEnded={() => navigate(`/meetings/${id}/processing`, { replace: true })} />
    </div>
  );
}
