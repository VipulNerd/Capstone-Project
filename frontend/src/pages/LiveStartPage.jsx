import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listTeamsMeetings, startLiveSession } from '../api/liveService';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Button, EmptyState, ErrorMessage, Input, Spinner } from '../components/common';
import Avatar from '../components/live/Avatar';
import liveStyles from '../components/live/live.module.css';
import styles from './pages.module.css';

const TEAMS_LINK_RE = /^https:\/\/teams\.(microsoft|live)\.com\/\S+$/i;

const timeOf = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default function LiveStartPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: meetings, loading, error, refetch } = useApi(listTeamsMeetings, []);

  const [mode, setMode] = useState('calendar'); // 'calendar' | 'link'
  const [selectedId, setSelectedId] = useState(null);
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [linkError, setLinkError] = useState(null);
  const [starting, setStarting] = useState(false);

  const selected = meetings?.find((m) => m.id === selectedId);

  const start = async () => {
    let payload;
    if (mode === 'calendar') {
      if (!selected) {
        toast.error('Pick the meeting you are about to join.');
        return;
      }
      payload = { teamsMeetingId: selected.id };
    } else {
      if (!TEAMS_LINK_RE.test(link.trim())) {
        setLinkError('Paste a valid Microsoft Teams meeting link');
        return;
      }
      payload = { joinUrl: link.trim(), title: title.trim() || undefined };
    }
    setStarting(true);
    try {
      const { id } = await startLiveSession(payload);
      navigate(`/live/${id}`);
    } catch (err) {
      toast.error(err.message);
      setStarting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Start live capture</h1>
          <p>MinutesAI listens to your Teams meeting, transcribes it live and identifies who said what.</p>
        </div>
      </div>

      <div className={liveStyles.liveLayout}>
        <div className="card">
          <div className={styles.segmented} role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'calendar'} className={mode === 'calendar' ? styles.segActive : ''} onClick={() => setMode('calendar')}>
              📅 Today's Teams meetings
            </button>
            <button type="button" role="tab" aria-selected={mode === 'link'} className={mode === 'link' ? styles.segActive : ''} onClick={() => setMode('link')}>
              🔗 Paste meeting link
            </button>
          </div>

          {mode === 'calendar' ? (
            <>
              <ErrorMessage error={error} onRetry={refetch} />
              {loading && !meetings && <Spinner label="Loading your Teams calendar…" />}
              {meetings?.length === 0 && (
                <EmptyState icon="📅" title="No Teams meetings today" message="Paste a meeting link instead." />
              )}
              {meetings?.length > 0 && (
                <ul className={liveStyles.meetingList}>
                  {meetings.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className={`${liveStyles.meetingOption} ${m.id === selectedId ? liveStyles.meetingSelected : ''}`}
                        onClick={() => setSelectedId(m.id)}
                        aria-pressed={m.id === selectedId}
                      >
                        <div className={liveStyles.timeBox}>
                          {timeOf(m.start)}
                          <div className="muted small" style={{ fontWeight: 400 }}>
                            {timeOf(m.end)}
                          </div>
                        </div>
                        <div className={liveStyles.meetingInfo}>
                          <strong>{m.title}</strong>
                          <div className="muted small">
                            Organiser: {m.organizer} · {m.attendees.length} invited
                          </div>
                        </div>
                        <div className={liveStyles.stack}>
                          {m.attendees.slice(0, 4).map((a) => (
                            <Avatar key={a.name} name={a.name} />
                          ))}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Input
                label="Teams meeting link"
                required
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setLinkError(null);
                }}
                placeholder="https://teams.microsoft.com/l/meetup-join/…"
                error={linkError}
              />
              <Input label="Meeting title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Taken from Teams if left blank" />
            </div>
          )}

          {selected && mode === 'calendar' && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 8 }}>Invited ({selected.attendees.length})</h3>
              <p className="muted small">
                Participants are picked up automatically from the Teams roster as they join. You don't need to add anyone.
              </p>
            </div>
          )}

          <div className={styles.formActions} style={{ marginTop: 20 }}>
            <Button onClick={start} loading={starting} disabled={mode === 'calendar' && !selected}>
              ● Start capture
            </Button>
          </div>
        </div>

        <aside className="card">
          <div className="card-title">
            <h2>How it works</h2>
          </div>
          <ol className={liveStyles.howTo}>
            <li>Join your meeting in Teams (desktop or web).</li>
            <li>
              Click <strong>Start capture</strong>, then share the Teams tab or window with <strong>audio</strong> turned on.
            </li>
            <li>
              Click <strong>Pop out overlay</strong>. A small floating panel stays on top of Teams with the live transcript.
            </li>
            <li>
              When the meeting ends, click <strong>Stop</strong>. The MOM draft is ready to review a few seconds later.
            </li>
          </ol>
          <p className="muted small" style={{ marginTop: 14 }}>
            No recording? You can still{' '}
<Link to="/meetings/new">upload a file</Link>
            .
          </p>
        </aside>
      </div>
    </div>
  );
}
