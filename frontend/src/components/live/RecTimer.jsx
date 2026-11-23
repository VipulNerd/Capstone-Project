import { useEffect, useState } from 'react';
import { formatDuration } from '../../utils/speakers';
import styles from './live.module.css';

/** "● REC 04:12", counted from when the recording session started (same clock as offset_ms). */
export default function RecTimer({ startedAt, paused, active = true }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const elapsed = Math.max(0, (now - Date.parse(startedAt)) / 1000);
  const label = !active ? 'READY' : paused ? 'PAUSED' : 'REC';

  return (
    <span className={`${styles.rec} ${paused || !active ? styles.recPaused : ''}`} role="timer">
      <span className={`${styles.recDot} ${paused || !active ? styles.pausedDot : ''}`} aria-hidden="true" />
      {label} {formatDuration(elapsed)}
    </span>
  );
}
