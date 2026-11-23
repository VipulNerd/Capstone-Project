import { useEffect, useMemo, useState } from 'react';
import { Navigate, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { getMeeting } from '../api/meetingService';
import { approveMom, updateMom } from '../api/momService';
import useApi from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, ConfirmDialog, ErrorMessage, Input, Spinner, TextArea } from '../components/common';
import EditableList from '../components/mom/EditableList';
import ActionItemTable from '../components/mom/ActionItemTable';
import ParticipantList from '../components/mom/ParticipantList';
import TranscriptView from '../components/mom/TranscriptView';
import WorkflowStepper from '../components/mom/WorkflowStepper';
import { hasErrors, isBlank, isEmail, isUnnamedSpeaker, validateMom } from '../utils/validators';
import { recipientEmails } from '../utils/recipients';
import { redirectFor } from './meetingLinks';
import styles from './pages.module.css';

// The editable part of a meeting (everything PUT /meetings/{id}/mom accepts).
const pickDraft = ({ title, date, summary, discussionPoints, decisions, actionItems, participants }) => ({
  title,
  date,
  summary,
  discussionPoints,
  decisions,
  actionItems,
  participants,
});

export default function MomReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, refetch } = useApi(() => getMeeting(id), [id]);

  const [draft, setDraft] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [errors, setErrors] = useState({});
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  // When a (new) meeting arrives from the API, copy it into editable local state.
  const [loadedFrom, setLoadedFrom] = useState(null);
  if (data && data !== loadedFrom) {
    setLoadedFrom(data);
    const d = pickDraft(data);
    setDraft(d);
    setSavedSnapshot(JSON.stringify(d));
  }

  const dirty = draft && JSON.stringify(draft) !== savedSnapshot;

  // Warn before leaving the page with unsaved edits.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !approving && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const update = (field, value) => {
    const next = { ...draft, [field]: value };
    // A participant renamed in place keeps their action items.
    if (field === 'participants' && value.length === draft.participants.length) {
      const renamed = new Map(draft.participants.map((p, i) => [p.name, value[i].name]));
      next.actionItems = draft.actionItems.map((a) =>
        renamed.has(a.owner) && renamed.get(a.owner) !== a.owner ? { ...a, owner: renamed.get(a.owner) } : a,
      );
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
        label: 'Every participant is named (no “Speaker 3A”)',
      },
      {
        ok: draft.participants.every((p) => isBlank(p.email) || isEmail(p.email)),
        label: 'Participant emails are valid',
      },
      { ok: draft.actionItems.every((a) => !isBlank(a.owner)), label: 'Every action item has an owner' },
      { ok: draft.actionItems.every((a) => !isBlank(a.deadline)), label: 'Every action item has a deadline' },
    ];
  }, [draft]);

  if (loading && !draft) return <Spinner label="Loading draft…" />;
  if (error && !draft) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!draft) return null;

  const redirect = !approving && redirectFor(data, ['draft']);
  if (redirect) return <Navigate to={redirect} replace />;

  const save = async ({ silent = false } = {}) => {
    setSaving(true);
    try {
      const saved = pickDraft(await updateMom(id, draft));
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

  const recipients = recipientEmails(draft.participants, data.organizerEmail);
  const withoutEmail = draft.participants.filter((p) => !isEmail(p.email || ''));

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
      // Always save first so the approved MOM is exactly what's on screen.
      if (dirty && !(await save({ silent: true }))) {
        setApproving(false);
        return;
      }
      await approveMom(id, user.name);
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
          <p>The AI drafted this. Check it carefully and approve it before it is sent.</p>
        </div>
      </div>

      <div className="card">
        <WorkflowStepper status="draft" />
      </div>

      <div className={styles.reviewLayout}>
        <div className={styles.reviewMain}>
          <div className="card">
            <div className="card-title">
              <h2>Meeting details</h2>
            </div>
            <div className={styles.formGrid}>
              <Input
                label="Title"
                value={draft.title}
                onChange={(e) => update('title', e.target.value)}
                error={showErrors && errors.title}
              />
              <Input
                label="Meeting date"
                type="date"
                value={draft.date}
                onChange={(e) => update('date', e.target.value)}
              />
            </div>
          </div>

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
                  From the invite, plus anyone the AI heard in the meeting. Correct names if needed, and add an email
                  for anyone who should receive the MOM.
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

          <TranscriptView meeting={data} title="Transcript: check who said what" />
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
            {withoutEmail.length > 0 && (
              <p className="small" style={{ color: 'var(--warning)', marginTop: 12 }}>
                ⚠ {withoutEmail.length} participant(s) have no email and won't receive the MOM.
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
            Once approved, the MOM is locked for editing and can be emailed to{' '}
            <strong>{recipients.length} recipient(s)</strong> (participants with an email, plus you as organiser). You can
            withdraw approval until it has been sent.
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
