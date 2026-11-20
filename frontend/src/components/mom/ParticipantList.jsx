import { Button, Input } from '../common';
import styles from './mom.module.css';

const SOURCE_LABEL = { teams: 'Teams roster', speaker: 'Detected voice', manual: 'Added by you' };

/** Editable list of { name, email } participants (used on upload and review). */
export default function ParticipantList({ participants, onChange, errors = [], disabled }) {
  const update = (index, field, value) =>
    onChange(participants.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  const remove = (index) => onChange(participants.filter((_, i) => i !== index));
  const add = () => onChange([...participants, { name: '', email: '', source: 'manual' }]);

  return (
    <div className={styles.list}>
      {participants.map((p, i) => (
        // Rows can be edited to any value (even duplicates) so index is the key.
        <div key={i} className={styles.participantRow}>
          <Input
            placeholder="Full name"
            value={p.name}
            hint={!errors[i]?.name && SOURCE_LABEL[p.source]}
            onChange={(e) => update(i, 'name', e.target.value)}
            error={errors[i]?.name}
            disabled={disabled}
            aria-label={`Participant ${i + 1} name`}
          />
          <Input
            type="email"
            placeholder={disabled ? '' : 'Add email to send the MOM'}
            value={p.email}
            hint={!p.email && !errors[i]?.email ? 'No email: won’t receive the MOM' : undefined}
            onChange={(e) => update(i, 'email', e.target.value)}
            error={errors[i]?.email}
            disabled={disabled}
            aria-label={`Participant ${i + 1} email`}
          />
          {!disabled && (
            <Button
              variant="ghost"
              size="sm"
              className={styles.removeBtn}
              onClick={() => remove(i)}
              aria-label={`Remove participant ${i + 1}`}
            >
              ✕
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <div>
          <Button variant="secondary" size="sm" onClick={add}>
            + Add participant
          </Button>
        </div>
      )}
    </div>
  );
}
