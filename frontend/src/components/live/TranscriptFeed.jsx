import { useEffect, useRef } from 'react';
import Avatar from './Avatar';
import { formatDuration } from '../../utils/speakers';
import styles from './live.module.css';

/**
 * Speaker-labelled transcript. Keeps itself scrolled to the newest line
 * unless the user has scrolled up to read something.
 */
export default function TranscriptFeed({ lines, live = false, paused = false, compact = false, limit }) {
  const ref = useRef(null);
  const stickToBottom = useRef(true);
  const shown = limit ? lines.slice(-limit) : lines;

  useEffect(() => {
    const el = ref.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const onScroll = () => {
    const el = ref.current;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div ref={ref} className={`${styles.feed} ${compact ? styles.feedCompact : ''}`} onScroll={onScroll} aria-live="polite">
      {shown.map((l) => (
        <div key={l.id} className={styles.line}>
          <Avatar name={l.speaker} />
          <div className={styles.lineBody}>
            <div className={styles.lineHead}>
              <strong>{l.speaker}</strong>
              <span className={styles.time}>{formatDuration(l.t)}</span>
            </div>
            <p className={styles.text}>{l.text}</p>
          </div>
        </div>
      ))}
      {live && (
        <div className={styles.listening}>
          {paused ? (
            'Capture paused. Nothing is being recorded.'
          ) : (
            <>
              <span className={styles.dots} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              Listening…
            </>
          )}
        </div>
      )}
      {!live && !lines.length && <p className="muted small">No transcript available.</p>}
    </div>
  );
}
