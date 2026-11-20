import { Button } from '../common';
import Avatar from './Avatar';
import RecTimer from './RecTimer';
import TranscriptFeed from './TranscriptFeed';
import styles from './live.module.css';

/** Compact panel shown in the floating always-on-top window over Teams. */
export default function OverlayPanel({ session, onTogglePause, onStop, busy }) {
  const { title, paused, elapsed, receivedAt, transcript, participants, speaking } = session;
  return (
    <div className={styles.overlay}>
      <div className={styles.overlayHead}>
        <span className={styles.overlayTitle}>📝 {title}</span>
        <RecTimer elapsed={elapsed} receivedAt={receivedAt} paused={paused} />
      </div>

      <div className={styles.nowSpeaking}>
        {speaking ? (
          <>
            <Avatar name={speaking} speaking />
            <span>
              <strong>{speaking}</strong> is speaking
            </span>
          </>
        ) : (
          <span className="muted">{participants.length} in the call</span>
        )}
      </div>

      <TranscriptFeed lines={transcript} live paused={paused} compact limit={6} />

      <div className={styles.overlayFoot}>
        <Button variant="secondary" size="sm" onClick={onTogglePause} disabled={busy}>
          {paused ? '▶ Resume' : '❚❚ Pause'}
        </Button>
        <Button variant="danger" size="sm" onClick={onStop} disabled={busy}>
          ■ Stop
        </Button>
      </div>
    </div>
  );
}
