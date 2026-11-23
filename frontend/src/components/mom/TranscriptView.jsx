import { useState } from 'react';
import { downloadTranscript, getTranscript } from '../../api/meetingService';
import { useToast } from '../../context/ToastContext';
import { Button, ErrorMessage, Spinner } from '../common';
import TranscriptFeed from '../live/TranscriptFeed';
import styles from './mom.module.css';

/**
 * Collapsible refined transcript (speaker names + timestamps), loaded on first open
 * from GET /meetings/{id}/transcript?format=json, with TXT/DOCX/PDF downloads.
 */
export default function TranscriptView({ meeting, title = 'Transcript' }) {
  const toast = useToast();
  const [lines, setLines] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(null);

  if (!meeting.hasTranscript) return null;

  const load = async (e) => {
    if (!e.currentTarget.open || lines || loading) return;
    setLoading(true);
    try {
      setLines((await getTranscript(meeting.id)).map((l, i) => ({ ...l, id: i })));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const download = async (format) => {
    setDownloading(format);
    try {
      await downloadTranscript(meeting.id, format, `Transcript - ${meeting.title}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <details className="card" onToggle={load}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        {title}
        {lines && ` (${lines.length} lines)`}
      </summary>
      <div className={styles.transcriptActions}>
        {['txt', 'docx', 'pdf'].map((f) => (
          <Button key={f} size="sm" variant="secondary" onClick={() => download(f)} loading={downloading === f}>
            ⬇ {f.toUpperCase()}
          </Button>
        ))}
      </div>
      {loading && <Spinner size="sm" label="Loading transcript…" />}
      <ErrorMessage error={error} />
      {lines && (
        <div className={styles.transcriptBox}>
          <TranscriptFeed lines={lines} />
        </div>
      )}
    </details>
  );
}
