import { Link } from 'react-router-dom';
import { listMeetings } from '../api/meetingService';
import useApi from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Button, EmptyState, ErrorMessage, Spinner, StatusBadge } from '../components/common';
import { formatDate } from '../utils/formatDate';
import { meetingLink } from './meetingLinks';
import styles from './pages.module.css';

function StatCard({ value, label }) {
  return (
    <div className={`card ${styles.stat}`}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: meetings, loading, error, refetch } = useApi(listMeetings, []);

  const count = (status) => (meetings || []).filter((m) => m.status === status).length;
  const pending = (meetings || []).filter((m) => m.status === 'draft');
  const inProgress = (meetings || []).filter((m) => ['recording', 'finalizing', 'failed'].includes(m.status));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>
          <p>Here's where your meeting minutes stand.</p>
        </div>
        <Button to="/meetings/new">● Record a meeting</Button>
      </div>

      <ErrorMessage error={error} onRetry={refetch} />

      {loading && !meetings ? (
        <Spinner />
      ) : (
        meetings && (
          <>
            <div className={styles.stats}>
              <StatCard value={meetings.length} label="Total meetings" />
              <StatCard value={pending.length} label="Awaiting approval" />
              <StatCard value={count('distributed')} label="Minutes distributed" />
              <StatCard value={count('failed')} label="Processing failed" />
            </div>

            {inProgress.length > 0 && (
              <div className="card">
                <div className="card-title">
                  <h2>In progress</h2>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {inProgress.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <strong>{m.title}</strong>
                            <div className="muted small">{formatDate(m.date)}</div>
                          </td>
                          <td>
                            <StatusBadge status={m.status} />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <Button size="sm" variant="secondary" to={meetingLink(m)}>
                              {m.status === 'recording' ? 'Continue recording' : m.status === 'failed' ? 'See error' : 'View progress'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {pending.length > 0 && (
              <div className="card">
                <div className="card-title">
                  <h2>Needs review</h2>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {pending.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <strong>{m.title}</strong>
                            <div className="muted small">
                              {formatDate(m.date)} · {m.organizerName}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <Button size="sm" to={`/meetings/${m.id}/review`}>
                              Review draft
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-title">
                <h2>Recent meetings</h2>
                <Link to="/history" className="small">
                  View all →
                </Link>
              </div>
              {meetings.length === 0 ? (
                <EmptyState
                  icon="🎙️"
                  title="No meetings yet"
                  message="Record your next meeting and the AI will write the transcript and draft the minutes."
                  action={<Button to="/meetings/new">Record a meeting</Button>}
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Meeting</th>
                        <th>Date</th>
                        <th>Organiser</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meetings.slice(0, 5).map((m) => (
                        <tr key={m.id}>
                          <td>
                            <Link to={meetingLink(m)}>{m.title}</Link>
                          </td>
                          <td>{formatDate(m.date)}</td>
                          <td>{m.organizerName}</td>
                          <td>
                            <StatusBadge status={m.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}
