import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startMeeting, startMeetingFromIcs } from '../api/meetingService';
import { getMicrosoftConnectUrl, listEvents } from '../api/calendarService';
import useApi from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, ErrorMessage, FileDropzone, Input, Spinner } from '../components/common';
import ParticipantList from '../components/mom/ParticipantList';
import Avatar from '../components/live/Avatar';
import { hasErrors, validateNewMeeting } from '../utils/validators';
import { validateIcsFile } from '../utils/fileHelpers';
import liveStyles from '../components/live/live.module.css';
import styles from './pages.module.css';

const SOURCES = [
  { value: 'calendar', label: '📅 Outlook calendar' },
  { value: 'ics', label: '📎 Invite file' },
  { value: 'manual', label: '✍️ Enter details' },
];

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

function CalendarPicker({ selected, onSelect }) {
  const toast = useToast();
  const { data: events, loading, error, refetch } = useApi(listEvents, []);
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setConnecting(true);
    try {
      window.open(await getMicrosoftConnectUrl(), '_blank', 'noopener');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConnecting(false);
    }
  };

  if (loading && !events) return <Spinner label="Loading your Outlook meetings…" />;
  if (error?.status === 503) {
    return (
      <p className="muted">
        Outlook isn't set up on this server (the backend has no <code>MS_CLIENT_ID</code>). Use an invite file or enter the
        details instead.
      </p>
    );
  }
  if (error?.status === 409) {
    return (
      <div className={styles.calendarConnect}>
        <p style={{ margin: 0 }}>
          Connect your Outlook calendar once. Microsoft asks you to allow read-only access to your calendar, and the
          attendees of the meeting you pick become the participants.
        </p>
        <div className="row">
          <Button onClick={connect} loading={connecting}>
            Connect Outlook
          </Button>
          <Button variant="secondary" onClick={refetch}>
            I've connected, refresh
          </Button>
        </div>
      </div>
    );
  }
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!events.length) {
    return (
      <p className="muted">
        No meetings in your calendar between 2 hours ago and 12 hours from now.{' '}
        <button type="button" className="link-button" onClick={refetch}>
          Refresh
        </button>
      </p>
    );
  }
  return (
    <ul className={liveStyles.meetingList}>
      {events.map((ev) => (
        <li key={ev.id}>
          <button
            type="button"
            className={`${liveStyles.meetingOption} ${selected === ev.id ? liveStyles.meetingSelected : ''}`}
            onClick={() => onSelect(ev.id)}
            aria-pressed={selected === ev.id}
          >
            <span className={liveStyles.timeBox}>
              {timeOf(ev.start)}
              <div className="muted small">{timeOf(ev.end)}</div>
            </span>
            <span className={liveStyles.meetingInfo}>
              <strong>{ev.title}</strong>
              <div className="muted small">
                {ev.organizerName || ev.organizerEmail} · {ev.attendees.length} attendees
              </div>
            </span>
            <span className={liveStyles.stack}>
              {ev.attendees.slice(0, 4).map((a) => (
                <Avatar key={a.email || a.name} name={a.name} />
              ))}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function NewMeetingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [source, setSource] = useState('manual');
  const [eventId, setEventId] = useState(null);
  const [icsFile, setIcsFile] = useState(null);
  const [form, setForm] = useState({ title: '', participants: [] });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [serverError, setServerError] = useState(null);

  const validate = (f = form, file = icsFile, ev = eventId, c = consent) => {
    const e = source === 'manual' ? validateNewMeeting(f) : {};
    if (source === 'ics') {
      const err = validateIcsFile(file);
      if (err) e.ics = err;
    }
    if (source === 'calendar' && !ev) e.event = 'Pick the meeting you are about to record';
    if (!c) e.consent = 'Confirm that everyone has been told the meeting is recorded';
    return e;
  };

  const update = (field, value) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (submitted) setErrors(validate(next));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    const validation = validate();
    setErrors(validation);
    if (hasErrors(validation)) return;

    setStarting(true);
    setServerError(null);
    try {
      const meeting =
        source === 'ics'
          ? await startMeetingFromIcs(icsFile)
          : source === 'calendar'
            ? await startMeeting({ calendarEventId: eventId })
            : await startMeeting({ title: form.title, participants: form.participants });
      toast.success('Meeting created. Start capturing audio when the call begins.');
      navigate(`/meetings/${meeting.id}/record`);
    } catch (err) {
      setServerError(err);
      setStarting(false);
    }
  };

  return (
    <form className="page" onSubmit={handleSubmit} noValidate>
      <div className="page-header">
        <div>
          <h1>Record a meeting</h1>
          <p>Tell us which meeting it is, so the minutes can name the people in it.</p>
        </div>
      </div>

      <ErrorMessage error={serverError} />

      <div className="card">
        <div className="card-title">
          <h2>Which meeting?</h2>
        </div>
        <div className={styles.segmented} role="tablist">
          {SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="tab"
              aria-selected={source === s.value}
              className={source === s.value ? styles.segActive : ''}
              onClick={() => {
                setSource(s.value);
                setErrors({});
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {source === 'calendar' && (
          <>
            <CalendarPicker selected={eventId} onSelect={setEventId} />
            {errors.event && <p className={styles.fieldError}>{errors.event}</p>}
          </>
        )}

        {source === 'ics' && (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              In Outlook or Teams, open the meeting and save or forward it as a calendar file (.ics). The title, time and
              attendees are read from it.
            </p>
            <FileDropzone file={icsFile} onChange={setIcsFile} accept=".ics,text/calendar" error={errors.ics} hint=".ics invite, up to 1 MB" />
          </>
        )}

        {source === 'manual' && (
          <>
            <Input
              label="Meeting title"
              required
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="e.g. Sprint 15 Planning"
              error={errors.title}
            />
            <div style={{ marginTop: 16 }}>
              <h3 className={styles.subheading}>Who's attending?</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Optional, but it helps the AI put names to voices. Add emails for anyone who should receive the minutes.
                You ({user?.name}) are added automatically.
              </p>
              <ParticipantList
                participants={form.participants}
                onChange={(v) => update('participants', v)}
                errors={errors.participants || []}
              />
            </div>
          </>
        )}
      </div>

      <div className="card">
        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (submitted) setErrors(validate(form, icsFile, eventId, e.target.checked));
            }}
          />
          <span>
            <strong>Everyone in this meeting has been told it will be recorded and has agreed.</strong>
            <span className="muted small" style={{ display: 'block' }}>
              Audio is used to write the transcript and minutes, and is deleted once it has been transcribed.
            </span>
          </span>
        </label>
        {errors.consent && <p className={styles.fieldError}>{errors.consent}</p>}
      </div>

      <div className={styles.formActions}>
        <Button variant="secondary" onClick={() => navigate(-1)} disabled={starting}>
          Cancel
        </Button>
        <Button type="submit" loading={starting}>
          Continue to recording
        </Button>
      </div>
    </form>
  );
}
