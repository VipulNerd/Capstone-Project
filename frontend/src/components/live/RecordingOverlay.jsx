import { Button } from '../common';
import RecTimer from './RecTimer';
import styles from './live.module.css';

const TRACK_LABEL = { on: '● capturing', off: 'off', starting: 'starting…', ended: 'stopped', error: 'error' };

/** Compact panel for the floating always-on-top window shown over the meeting app. */
export default function RecordingOverlay({ meeting, recorder, onEnd, busy }) {
  const { tracks, paused, capturing, uploads, pendingUploads, failedUploads } = recorder;
  const done = uploads.filter((u) => u.state === 'done').length;
  return (
    <div className={styles.overlay}>
      <div className={styles.overlayHead}>
        <span className={styles.overlayTitle}>📝 {meeting.title}</span>
        <RecTimer startedAt={meeting.recordingStartedAt} paused={paused} active={capturing} />
      </div>

      <div className={styles.nowSpeaking} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <span>🎙️ Your mic: {TRACK_LABEL[tracks.mic]}</span>
        <span>🔊 Meeting audio: {TRACK_LABEL[tracks.meeting]}</span>
      </div>

      <p className="small muted" style={{ margin: 0 }}>
        {done} chunk(s) saved{pendingUploads ? ` · ${pendingUploads} uploading` : ''}
        {failedUploads ? ` · ${failedUploads} failed` : ''}
      </p>

      <div style={{ flex: 1 }} />

      <div className={styles.overlayFoot}>
        <Button variant="secondary" size="sm" onClick={paused ? recorder.resume : recorder.pause} disabled={busy || !capturing}>
          {paused ? '▶ Resume' : '❚❚ Pause'}
        </Button>
        <Button variant="danger" size="sm" onClick={onEnd} disabled={busy}>
          ■ End
        </Button>
      </div>
    </div>
  );
}
