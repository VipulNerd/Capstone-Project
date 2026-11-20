import Avatar from './Avatar';
import styles from './live.module.css';

/** Participants detected automatically from the Teams roster. */
export default function LiveParticipants({ participants, speaking, invited }) {
  return (
    <div>
      <p className="muted small" style={{ marginBottom: 12 }}>
        {participants.length}
        {invited ? ` of ${invited} invited` : ''} joined · detected from the Teams roster
      </p>
      <ul className={styles.people}>
        {participants.map((p) => {
          const isSpeaking = p.name === speaking;
          return (
            <li key={p.name} className={styles.person}>
              <Avatar name={p.name} speaking={isSpeaking} />
              <div className={styles.personInfo}>
                <div>{p.name}</div>
                <div className="muted small">{p.email || ''}</div>
              </div>
              {isSpeaking ? (
                <span className={styles.speakingTag}>Speaking</span>
              ) : (
                !p.email && <span className={styles.noEmail}>No email</span>
              )}
            </li>
          );
        })}
      </ul>
      {!participants.length && <p className="muted small">Waiting for people to join…</p>}
    </div>
  );
}
