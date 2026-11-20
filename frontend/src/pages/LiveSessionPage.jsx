import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { setPaused, stopLiveSession } from '../api/liveService';
import { startAudioCapture } from '../api/audioCapture';
import useLiveSession from '../hooks/useLiveSession';
import usePictureInPicture from '../hooks/usePictureInPicture';
import { useToast } from '../context/ToastContext';
import { Button, ConfirmDialog, ErrorMessage, Spinner } from '../components/common';
import TranscriptFeed from '../components/live/TranscriptFeed';
import LiveParticipants from '../components/live/LiveParticipants';
import OverlayPanel from '../components/live/OverlayPanel';
import RecTimer from '../components/live/RecTimer';
import liveStyles from '../components/live/live.module.css';
import { meetingLink } from './meetingLinks';
import config from '../config';

export default function LiveSessionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const session = useLiveSession(id);
  const pip = usePictureInPicture();

  const captureRef = useRef(null);
  const [capture, setCapture] = useState(config.USE_MOCK ? 'simulated' : 'off'); // off | starting | on | simulated
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  // Release the microphone and tab audio when leaving the page.
  useEffect(() => () => captureRef.current?.stop(), []);

  if (session.loading) return <Spinner label="Connecting to live session…" />;
  if (session.error && !session.status) return <ErrorMessage error={session.error} />;
  if (session.status && session.status !== 'live') {
    return <Navigate to={meetingLink({ id, status: session.status })} replace />;
  }

  const shareAudio = async () => {
    setCapture('starting');
    try {
      captureRef.current = await startAudioCapture((chunk) => session.sendAudio(chunk));
      setCapture('on');
    } catch (err) {
      setCapture('off');
      if (err?.name !== 'NotAllowedError') toast.error(err.message || 'Could not capture audio');
    }
  };

  const togglePause = async () => {
    const next = !session.paused;
    setBusy(true);
    try {
      await setPaused(id, next);
      session.dispatch({ type: 'local-paused', paused: next });
      if (next) captureRef.current?.pause();
      else captureRef.current?.resume();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await stopLiveSession(id);
      captureRef.current?.stop();
      session.disconnect();
      pip.close();
      toast.success('Capture stopped. Generating your MOM…');
      navigate(`/meetings/${id}/processing`, { replace: true });
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
      setConfirmStop(false);
    }
  };

  // Stop pressed inside the floating window: confirm there, since the main tab may be hidden.
  const stopFromOverlay = () => {
    if (pip.pipWindow?.confirm('Stop capturing and generate the minutes?')) stop();
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="row">
            <h1>{session.title}</h1>
            <RecTimer elapsed={session.elapsed} receivedAt={session.receivedAt} paused={session.paused} />
          </div>
          <p>
            Microsoft Teams ·{' '}
            {capture === 'simulated' && 'Demo mode: meeting audio is simulated'}
            {capture === 'on' && 'Capturing tab audio and microphone'}
            {capture === 'off' && 'Audio not shared yet'}
            {capture === 'starting' && 'Waiting for you to choose the Teams tab…'}
          </p>
        </div>
        <div className="row">
          {(capture === 'off' || capture === 'starting') && (
            <Button onClick={shareAudio} loading={capture === 'starting'}>
              🔊 Share Teams audio
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => (pip.pipWindow ? pip.close() : pip.open().catch(() => toast.error('Could not open the overlay window')))}
            disabled={!pip.supported}
            title={pip.supported ? 'Floating window that stays on top of Teams' : 'Needs Chrome or Edge 116+'}
          >
            {pip.pipWindow ? '⧉ Close overlay' : '⧉ Pop out overlay'}
          </Button>
          <Button variant="secondary" onClick={togglePause} disabled={busy}>
            {session.paused ? '▶ Resume' : '❚❚ Pause'}
          </Button>
          <Button variant="danger" onClick={() => setConfirmStop(true)} disabled={busy}>
            ■ Stop & generate MOM
          </Button>
        </div>
      </div>

      {session.error && <ErrorMessage error={`${session.error.message}. Reconnecting…`} />}
      {pip.pipWindow && (
        <p className="muted small">
          The overlay is open in a floating window. Switch to Teams and it stays on top.
        </p>
      )}

      <div className={liveStyles.liveLayout}>
        <div className="card">
          <div className="card-title">
            <h2>Live transcript</h2>
            <span className="muted small">{session.transcript.length} lines</span>
          </div>
          <TranscriptFeed lines={session.transcript} live paused={session.paused} />
        </div>
        <aside className="card">
          <div className="card-title">
            <h2>Participants</h2>
          </div>
          <LiveParticipants participants={session.participants} speaking={session.speaking} invited={session.invited} />
        </aside>
      </div>

      {pip.pipWindow &&
        createPortal(
          <OverlayPanel session={session} onTogglePause={togglePause} onStop={stopFromOverlay} busy={busy} />,
          pip.pipWindow.document.body,
        )}

      <ConfirmDialog
        open={confirmStop}
        title="Stop capturing?"
        message={`The transcript (${session.transcript.length} lines) and the ${session.participants.length} detected participants will be used to draft the minutes. You can review everything before anything is sent.`}
        confirmLabel="Stop & generate"
        variant="danger"
        loading={busy}
        onConfirm={stop}
        onCancel={() => setConfirmStop(false)}
      />
    </div>
  );
}
