import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listMeetings } from '../api/meetingService';
import useApi from '../hooks/useApi';
import { Button, EmptyState, ErrorMessage, Input, Select, Spinner, StatusBadge } from '../components/common';
import { STATUS_OPTIONS } from '../utils/status';
import { formatDate } from '../utils/formatDate';
import { meetingLink } from './meetingLinks';
import styles from './pages.module.css';

const SORTS = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'title-asc', label: 'Title A–Z' },
];

export default function HistoryPage() {
  const { data: meetings, loading, error, refetch } = useApi(listMeetings, []);

  // Filters live in the URL so they survive refresh and can be shared.
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const status = params.get('status') || '';
  const sort = params.get('sort') || 'date-desc';

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const visible = useMemo(() => {
    if (!meetings) return [];
    const q = query.trim().toLowerCase();
    const list = meetings.filter(
      (m) => (!status || m.status === status) && (!q || m.title.toLowerCase().includes(q)),
    );
    const [field, dir] = sort.split('-');
    list.sort((a, b) => {
      const cmp = field === 'title' ? a.title.localeCompare(b.title) : String(a.date).localeCompare(String(b.date));
      return dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [meetings, query, status, sort]);

  const toggleDateSort = () => setParam('sort', sort === 'date-desc' ? 'date-asc' : 'date-desc');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Meeting history</h1>
          <p>Every meeting you have uploaded, with where it is in the workflow.</p>
        </div>
        <Button variant="secondary" to="/search">
          🔎 Semantic search
        </Button>
      </div>

      <div className="card">
        <div className={styles.filters}>
          <Input
            placeholder="Filter by title…"
            value={query}
            onChange={(e) => setParam('q', e.target.value)}
            aria-label="Filter by title"
          />
          <Select
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
            options={STATUS_OPTIONS}
            placeholder="All statuses"
            aria-label="Filter by status"
          />
          <Select value={sort} onChange={(e) => setParam('sort', e.target.value)} options={SORTS} aria-label="Sort" />
        </div>

        <ErrorMessage error={error} onRetry={refetch} />

        {loading && !meetings ? (
          <Spinner />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title={meetings?.length ? 'No meetings match your filters' : 'No meetings yet'}
            message={meetings?.length ? 'Try clearing the filters.' : 'Uploaded meetings will appear here.'}
            action={
              meetings?.length ? (
                <Button variant="secondary" onClick={() => setParams({}, { replace: true })}>
                  Clear filters
                </Button>
              ) : (
                <Button to="/meetings/new">Upload a meeting</Button>
              )
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Meeting</th>
                  <th>
                    <button className={styles.sortBtn} onClick={toggleDateSort}>
                      Date {sort === 'date-asc' ? '▲' : sort === 'date-desc' ? '▼' : ''}
                    </button>
                  </th>
                  <th>Source</th>
                  <th>Participants</th>
                  <th>Action items</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link to={meetingLink(m)}>{m.title}</Link>
                      <div className="muted small">{m.fileName}</div>
                    </td>
                    <td>{formatDate(m.date)}</td>
                    <td>{{ live: '🟣 Teams live', audio: '🎙️ Audio' }[m.sourceType] || '📄 Transcript'}</td>
                    <td>{m.participantCount}</td>
                    <td>{m.actionItemCount}</td>
                    <td>
                      <StatusBadge status={m.status} />
                      {m.failedDeliveries > 0 && (
                        <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>
                          {m.failedDeliveries} failed
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
