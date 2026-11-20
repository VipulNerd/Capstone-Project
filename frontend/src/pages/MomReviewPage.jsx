import { useEffect, useMemo, useState } from 'react';
import { Navigate, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { approveMom, getMom, updateMom } from '../api/momService';
import { getTranscript } from '../api/liveService';
import TranscriptFeed from '../components/live/TranscriptFeed';
import useApi from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Button, ConfirmDialog, ErrorMessage, Spinner, TextArea } from '../components/common';
import EditableList from '../components/mom/EditableList';
import ActionItemTable from '../components/mom/ActionItemTable';
import ParticipantList from '../components/mom/ParticipantList';
import WorkflowStepper from '../components/mom/WorkflowStepper';
import { hasErrors, isBlank, isEmail, isUnnamedSpeaker, validateMom } from '../utils/validators';
import { formatDate } from '../utils/formatDate';
import styles from './pages.module.css';

const pickMom = ({ summary, discussionPoints, decisions, actionItems, participants }) => ({
  summary,
  discussionPoints,
  decisions,
  actionItems,
  participants,
});

// Removes empty list entries before saving.
const cleanMom = (mom) => ({
  ...mom,
  discussionPoints: mom.discussionPoints.filter((d) => d.trim()),
  decisions: mom.decisions.filter((d) => d.trim()),
});

export default function MomReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, refetch } = useApi(() => getMom(id), [id]);
  const { data: transcript } = useApi(() => getTranscript(id), [id]);

  const [draft, setDraft] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [errors, setErrors] = useState({});
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  // When a (new) MOM arrives from the API, copy it into editable local state.
  const [loadedFrom, setLoadedFrom] = useState(null);
  if (data && data !== loadedFrom) {
    setLoadedFrom(data);
    const mom = pickMom(data);
    setDraft(mom);
    setSavedSnapshot(JSON.stringify(mom));
  }

  const dirty = draft && JSON.stringify(draft) !== savedSnapshot;

  // Warn before leaving the page with unsaved edits.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !approving && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const update = (field, value) => {
    const next = { ...draft, [field]: value };
    // Keep action item owners in sync if a participant's name is edited or removed.
    if (field === 'participants') {
      next.actionItems = draft.actionItems.map((a) => {
        const p = value.find((x) => x.email && x.email === a.ownerEmail);
        return p ? { ...a, owner: p.name } : a.ownerEmail ? { ...a, owner: '', ownerEmail: '' } : a;
      });
    }
    setDraft(next);
    if (showErrors) setErrors(validateMom(next));
  };

  const checks = useMemo(() => {
    if (!draft) return [];
    return [
      { ok: !isBlank(draft.summary), label: 'Summary written' },
      {
        ok: draft.participants.length > 0 && draft.participants.every((p) => !isBlank(p.name) && !isUnnamedSpeaker(p.name)),
        label: 'Every speaker is identified by name',
      },
      {
        ok: draft.participants.every((p) => isBlank(p.email) || isEmail(p.email)),
        label: 'Participant emails are valid',
      },
      { ok: draft.actionItems.every((a) => !isBlank(a.owner)), label: 'Every action item has an owner' },
      { ok: draft.actionItems.every((a) => !isBlank(a.deadline)), label: 'Every action item has a deadline' },
    ];
  }, [draft]);

  if (error?.status === 409 && data === null) {
    // Draft not ready yet: send the user to the processing screen.
    return <Navigate to={`/meetings/${id}/processing`} replace />;
  }
  if (loading && !draft) return <Spinner label="Loading draft…" />;
  if (error && !draft) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!draft) return null;

  if (data.status === 'approved' || data.status === 'sent') {
    return <Navigate to={`/meetings/${id}`} replace />;
  }

  const save = async ({ silent = false } = {}) => {
    setSaving(true);
    try {
      const cleaned = cleanMom(draft);
      const saved = pickMom(await updateMom(id, cleaned));
      setDraft(saved);
      setSavedSnapshot(JSON.stringify(saved));
      if (!silent) toast.success('Draft saved');
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const recipients = draft.participants.filter((p) => isEmail(p.email || '')).length;

  const requestApproval = () => {
    const validation = validateMom(draft);
    setErrors(validation);
    setShowErrors(true);
    if (hasErrors(validation)) {
      toast.error('Fix the highlighted issues before approving.');
      return;
    }
    setConfirmOpen(true);
  };

  const approve = async () => {
    setApproving(true);
    try {
      if (dirty && !(await save({ silent: true }))) {
        setApproving(false);
        return;
      }
      await approveMom(id);
      toast.success('MOM approved');
      setSavedSnapshot(JSON.stringify(draft));
      navigate(`/meetings/${id}/distribute`);
    } catch (err) {
      toast.error(err.message);
      setApproving(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Review minutes: {data.title}</h1>
          <p>
            {formatDate(data.date)} · The AI drafted this. Check it carefully and approve it before it is sent.
          </p>
        </div>
      </div>

      <div className="card">
        <WorkflowStepper status="draft_ready" />
      </div>

      <div className={styles.reviewLayout}>
        <div className={styles.reviewMain}>
          <div className="card">
            <div className="card-title">
              <h2>Summary</h2>
            </div>
            <TextArea
              rows={5}
              value={draft.summary}
              onChange={(e) => update('summary', e.target.value)}
              error={showErrors && errors.summary}
              aria-label="Summary"
            />
          </div>

          <div className="card">
            <div className="card-title">
              <h2>Key discussion points</h2>
            </div>
            <EditableList
              items={draft.discussionPoints}
              onChange={(v) => update('discussionPoints', v)}
              placeholder="Discussion point"
              addLabel="Add point"
            />
          </div>

          <div className="card">
            <div className="card-title">
              <h2>Decisions</h2>
            </div>
            <EditableList
              items={draft.decisions}
              onChange={(v) => update('decisions', v)}
              placeholder="Decision"
              addLabel="Add decision"
            />
          </div>

          <div className="card">
            <div className="card-title">
              <div>
                <h2>Action items</h2>
                <p className="muted small">Owners are picked from the participant list.</p>
              </div>
            </div>
            <ActionItemTable
              items={draft.actionItems}
              participants={draft.participants}
              errors={showErrors ? errors.actionItems : []}
              onChange={(v) => update('actionItems', v)}
            />
          </div>

          <div className="card">
            <div className="card-title">
              <div>
                <h2>Participants ({draft.participants.length})</h2>
                <p className="muted small">
                  Detected automatically. Correct names if needed, and add an email for anyone who should receive the MOM.
                </p>
              </div>
            </div>
            {showErrors && errors.participantsGeneral && <ErrorMessage error={errors.participantsGeneral} />}
            <ParticipantList
              participants={draft.participants}
              onChange={(v) => update('participants', v)}
              errors={showErrors ? errors.participants : []}
            />
          </div>

          {transcript?.length > 0 && (
            <details className="card">
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Source transcript ({transcript.length} lines). Check who said what.
              </summary>
              <div style={{ marginTop: 14 }}>
                <TranscriptFeed lines={transcript} />
              </div>
            </details>
          )}
        </div>

        <aside className={styles.reviewSide}>
          <div className="card">
            <div className="card-title">
              <h2>Approval checklist</h2>
            </div>
            <ul className={styles.checklist}>
              {checks.map((c) => (
                <li key={c.label}>
                  <span className={c.ok ? styles.ok : styles.bad} aria-hidden="true">
                    {c.ok ? '✓' : '✕'}
                  </span>
                  <span>{c.label}</span>
                </li>
              ))}
            </ul>
            {draft.participants.length > recipients && (
              <p className="small" style={{ color: 'var(--warning)', marginTop: 12 }}>
                ⚠ {draft.participants.length - recipients} participant(s) have no email and won't receive the MOM.
              </p>
            )}
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dirty && <span className={styles.unsaved}>● Unsaved changes</span>}
            <Button variant="secondary" fullWidth onClick={() => save()} loading={saving} disabled={!dirty}>
              Save draft
            </Button>
            <Button fullWidth onClick={requestApproval} disabled={saving}>
              Approve MOM
            </Button>
            <p className="muted small">Nothing is emailed until you approve, and you choose when to send.</p>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Approve these minutes?"
        message={
          <>
            Once approved, the MOM is locked for editing and can be sent to{' '}
            <strong>{recipients} participants</strong> with an email address
            {draft.participants.length > recipients && ` (${draft.participants.length - recipients} without an email won't receive it)`}. Check the action items and owners first.
          </>
        }
        confirmLabel="Approve"
        loading={approving}
        onConfirm={approve}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Discard unsaved changes?"
        message="You have edits that haven't been saved. If you leave now, they will be lost."
        confirmLabel="Leave without saving"
        variant="danger"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
}
