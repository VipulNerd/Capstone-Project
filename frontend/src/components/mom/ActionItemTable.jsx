import { Button, Input, Select } from '../common';
import styles from './mom.module.css';

const newItem = () => ({ id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, task: '', owner: '', ownerEmail: '', deadline: '' });

function ActionItemRow({ item, index, participants, errors = {}, onChange, onRemove, disabled }) {
  const ownerOptions = participants
    .filter((p) => p.name?.trim())
    .map((p) => ({ value: p.email || p.name, label: p.name }));

  // Owner is stored by name + email; the select uses email (or name) as its value.
  const ownerValue = item.ownerEmail || (participants.find((p) => p.name === item.owner)?.email ?? '');

  const handleOwner = (value) => {
    const p = participants.find((x) => (x.email || x.name) === value);
    onChange({ ...item, owner: p?.name || '', ownerEmail: p?.email || '' });
  };

  return (
    <tr>
      <td>
        <Input
          value={item.task}
          onChange={(e) => onChange({ ...item, task: e.target.value })}
          placeholder="What needs to be done"
          error={errors.task}
          disabled={disabled}
          aria-label={`Task ${index + 1}`}
        />
      </td>
      <td>
        <Select
          value={ownerValue}
          onChange={(e) => handleOwner(e.target.value)}
          options={ownerOptions}
          placeholder="Select owner"
          error={errors.owner}
          disabled={disabled}
          aria-label={`Owner ${index + 1}`}
        />
      </td>
      <td>
        <Input
          type="date"
          value={item.deadline}
          onChange={(e) => onChange({ ...item, deadline: e.target.value })}
          error={errors.deadline}
          disabled={disabled}
          aria-label={`Deadline ${index + 1}`}
        />
      </td>
      {!disabled && (
        <td>
          <Button variant="ghost" size="sm" className={styles.removeBtn} onClick={onRemove} aria-label="Remove action item">
            ✕
          </Button>
        </td>
      )}
    </tr>
  );
}

export default function ActionItemTable({ items, participants, errors = [], onChange, disabled }) {
  const updateRow = (index, updated) => onChange(items.map((it, i) => (i === index ? updated : it)));
  const removeRow = (index) => onChange(items.filter((_, i) => i !== index));

  return (
    <div>
      <div className="table-wrap">
        <table className={`table ${styles.actionTable}`}>
          <thead>
            <tr>
              <th>Task</th>
              <th>Owner</th>
              <th>Deadline</th>
              {!disabled && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <ActionItemRow
                key={item.id}
                item={item}
                index={i}
                participants={participants}
                errors={errors[i]}
                onChange={(updated) => updateRow(i, updated)}
                onRemove={() => removeRow(i)}
                disabled={disabled}
              />
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && <p className="muted small" style={{ padding: '12px 0' }}>No action items.</p>}
      {!disabled && (
        <Button variant="secondary" size="sm" onClick={() => onChange([...items, newItem()])} style={{ marginTop: 10 }}>
          + Add action item
        </Button>
      )}
    </div>
  );
}
