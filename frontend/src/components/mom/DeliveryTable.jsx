import { StatusBadge } from '../common';
import { formatDateTime } from '../../utils/formatDate';

/** Per-recipient email delivery attempts, newest first. */
export default function DeliveryTable({ deliveries }) {
  const rows = [...deliveries].sort((a, b) => b.id - a.id);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Status</th>
            <th>Attempted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>{d.email}</td>
              <td>
                <StatusBadge status={d.status} kind="delivery" />
                {d.error && (
                  <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>
                    {d.error}
                  </div>
                )}
              </td>
              <td className="small muted">{formatDateTime(d.attemptedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
