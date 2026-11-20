import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadMeeting } from '../api/meetingService';
import { listTeamsMeetings } from '../api/liveService';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Button, ErrorMessage, FileDropzone, Input, Select, TextArea } from '../components/common';
import { hasErrors, isBlank } from '../utils/validators';
import { AUDIO_EXTENSIONS, TRANSCRIPT_EXTENSIONS, validateFile } from '../utils/fileHelpers';
import { todayISO } from '../utils/formatDate';
import config from '../config';
import styles from './pages.module.css';

const SOURCES = [
  { value: 'audio', label: '🎙️ Audio recording' },
  { value: 'transcript', label: '📄 Transcript file' },
  { value: 'paste', label: '✍️ Paste transcript' },
];

const initialForm = {
  title: '',
  date: todayISO(),
  source: 'audio',
  file: null,
  transcriptText: '',
  teamsMeetingId: '',
};

function validate(form) {
  const errors = {};
  if (isBlank(form.title)) errors.title = 'Meeting title is required';
  else if (form.title.trim().length < 3) errors.title = 'Title must be at least 3 characters';
  if (isBlank(form.date)) errors.date = 'Date is required';

  if (form.source === 'paste') {
    if (form.transcriptText.trim().length < 50) errors.file = 'Paste at least 50 characters of transcript';
  } else {
    const fileError = validateFile(form.file, form.source, config.MAX_UPLOAD_MB);
    if (fileError) errors.file = fileError;
  }
  return errors;
}

export default function UploadPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: teamsMeetings } = useApi(listTeamsMeetings, []);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [progress, setProgress] = useState(null);
  const [serverError, setServerError] = useState(null);

  // Update one field; re-validate live after the first submit attempt.
  const setField = (field, value) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (submitted) setErrors(validate(next));
  };

  const changeSource = (source) => {
    const next = { ...form, source, file: null };
    setForm(next);
    if (submitted) setErrors(validate(next));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    const validation = validate(form);
    setErrors(validation);
    if (hasErrors(validation)) {
      toast.error('Please fix the highlighted fields.');
      return;
    }

    setServerError(null);
    setProgress(0);
    try {
      const { id } = await uploadMeeting(
        {
          title: form.title.trim(),
          date: form.date,
          sourceType: form.source === 'audio' ? 'audio' : 'transcript',
          teamsMeetingId: form.teamsMeetingId || undefined,
          file: form.source === 'paste' ? null : form.file,
          transcriptText: form.source === 'paste' ? form.transcriptText : undefined,
        },
        setProgress,
      );
      toast.success('Upload complete. Generating your MOM…');
      navigate(`/meetings/${id}/processing`);
    } catch (err) {
      setServerError(err);
      setProgress(null);
    }
  };

  const uploading = progress !== null;
  const accept = (form.source === 'audio' ? AUDIO_EXTENSIONS : TRANSCRIPT_EXTENSIONS).map((x) => `.${x}`).join(',');

  return (
    <form className="page" onSubmit={handleSubmit} noValidate>
      <div className="page-header">
        <div>
          <h1>Upload a recording</h1>
          <p>For meetings that weren't captured live. Upload the audio or transcript and we'll draft the minutes.</p>
        </div>
        <Button variant="secondary" to="/live/new">
          ● Capture a live meeting instead
        </Button>
      </div>

      <ErrorMessage error={serverError} />

      <div className="card">
        <div className="card-title">
          <h2>Meeting details</h2>
        </div>
        <div className={styles.formGrid}>
          <Input
            label="Meeting title"
            required
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="e.g. Sprint 15 Planning"
            error={errors.title}
          />
          <Input
            label="Meeting date"
            type="date"
            required
            value={form.date}
            max={todayISO()}
            onChange={(e) => setField('date', e.target.value)}
            error={errors.date}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Recording or transcript</h2>
        </div>
        <div className={styles.segmented} role="tablist">
          {SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="tab"
              aria-selected={form.source === s.value}
              className={form.source === s.value ? styles.segActive : ''}
              onClick={() => changeSource(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {form.source === 'paste' ? (
          <TextArea
            rows={10}
            value={form.transcriptText}
            onChange={(e) => setField('transcriptText', e.target.value)}
            placeholder="Paste the meeting transcript here…"
            error={errors.file}
            hint={`${form.transcriptText.length} characters`}
            aria-label="Transcript text"
          />
        ) : (
          <FileDropzone
            file={form.file}
            onChange={(f) => setField('file', f)}
            accept={accept}
            error={errors.file}
            hint={
              form.source === 'audio'
                ? `MP3, WAV, M4A, MP4, WEBM or OGG · up to ${config.MAX_UPLOAD_MB} MB`
                : 'TXT, VTT, SRT or DOCX'
            }
          />
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <div>
            <h2>Participants</h2>
            <p className="muted small">
              Detected automatically. Link the Teams meeting to use its attendee list (with emails). Otherwise speakers
              are identified from the audio and you can name them during review.
            </p>
          </div>
        </div>
        <Select
          label="Teams meeting (optional)"
          value={form.teamsMeetingId}
          onChange={(e) => setField('teamsMeetingId', e.target.value)}
          placeholder="Not linked: detect speakers from the audio"
          options={(teamsMeetings || []).map((m) => ({ value: m.id, label: `${m.title} · ${m.attendees.length} attendees` }))}
        />
      </div>

      {uploading && (
        <div className="card">
          <p className="small" style={{ marginBottom: 8 }}>
            Uploading… {progress}%
          </p>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className={styles.formActions}>
        <Button variant="secondary" onClick={() => navigate(-1)} disabled={uploading}>
          Cancel
        </Button>
        <Button type="submit" loading={uploading}>
          Upload & generate MOM
        </Button>
      </div>
    </form>
  );
}
