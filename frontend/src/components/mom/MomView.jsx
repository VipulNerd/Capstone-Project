import { formatDate } from '../../utils/formatDate';
import styles from './mom.module.css';

const None = () => <p className="muted small">None recorded.</p>;

/** Read-only rendering of a MOM. */
export default function MomView({ mom }) {
  return (
    <div className={styles.view}>
      <section>
        <h3>Participants</h3>
        {mom.participants.length ? (
          <div className={styles.chips}>
            {mom.participants.map((p, i) => (
              <span key={i} className={styles.chip} title={p.email || 'No email'}>
                {p.name}
              </span>
            ))}
          </div>
        ) : (
          <None />
        )}
      </section>
      <section>
        <h3>Summary</h3>
        <p>{mom.summary || '—'}</p>
      </section>
      <section>
        <h3>Key discussion points</h3>
        {mom.discussionPoints.length ? (
          <ul>
            {mom.discussionPoints.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : (
          <None />
        )}
      </section>
      <section>
        <h3>Decisions</h3>
        {mom.decisions.length ? (
          <ul>
            {mom.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : (
          <None />
        )}
      </section>
      <section>
        <h3>Action items</h3>
        {mom.actionItems.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Owner</th>
                  <th>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {mom.actionItems.map((a) => (
                  <tr key={a.id}>
                    <td>{a.task}</td>
                    <td>{a.owner || 'Unassigned'}</td>
                    <td>{a.deadline ? formatDate(a.deadline) : 'TBD'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <None />
        )}
      </section>
    </div>
  );
}
