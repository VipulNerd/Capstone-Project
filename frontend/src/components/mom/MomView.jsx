import { formatDate } from '../../utils/formatDate';
import styles from './mom.module.css';

/** Read-only rendering of an approved MOM. */
export default function MomView({ mom }) {
  return (
    <div className={styles.view}>
      <section>
        <h3>Participants</h3>
        <div className={styles.chips}>
          {mom.participants.map((p) => (
            <span key={p.email} className={styles.chip} title={p.email}>
              {p.name}
            </span>
          ))}
        </div>
      </section>
      <section>
        <h3>Summary</h3>
        <p>{mom.summary}</p>
      </section>
      <section>
        <h3>Key discussion points</h3>
        <ul>
          {mom.discussionPoints.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Decisions</h3>
        <ul>
          {mom.decisions.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Action items</h3>
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
                  <td>{a.owner}</td>
                  <td>{formatDate(a.deadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
