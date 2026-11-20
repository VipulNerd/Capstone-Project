import { Button, StatusBadge } from '../common';
import { formatDateTime } from '../../utils/formatDate';

/** Per-recipient email delivery status. Pass onRetry to show retry buttons for failed rows. */
export default function DeliveryTable({ deliveries, onRetry, retrying }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Formats</th>
            <th>Status</th>
            <th>Updated</th>
            {onRetry && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => (
            <tr key={d.email}>
              <td>
                {d.name}
                <div className="muted small">{d.email}</div>
              </td>
              <td>{d.formats?.map((f) => f.toUpperCase()).join(', ')}</td>
              <td>
                <StatusBadge status={d.status} />
                {d.error && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>{d.error}</div>}
              </td>
              <td className="small muted">{formatDateTime(d.updatedAt)}</td>
              {onRetry && (
                <td>
                  {d.status === 'failed' && (
                    <Button size="sm" variant="secondary" onClick={() => onRetry(d.email)} loading={retrying === d.email}>
                      Retry
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
