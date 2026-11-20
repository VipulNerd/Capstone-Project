import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { semanticSearch } from '../api/searchService';
import { Button, EmptyState, ErrorMessage, Input, Spinner } from '../components/common';
import { formatDate } from '../utils/formatDate';
import styles from './pages.module.css';

const SUGGESTIONS = ['What did we decide about the budget?', 'audio chunking', 'Acme migration timeline', 'cloud costs'];

/** Wraps words from the query in <mark> so matches stand out. */
function Highlight({ text, query }) {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!words.length) return text;
  const re = new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const activeQuery = params.get('q') || '';
  const [input, setInput] = useState(activeQuery);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Run the search whenever the ?q= parameter changes.
  useEffect(() => {
    if (!activeQuery) return undefined;
    let ignore = false; // avoids race conditions between overlapping requests
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await semanticSearch(activeQuery);
        if (!ignore) setResults(data);
      } catch (err) {
        if (!ignore) setError(err);
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    run();
    return () => {
      ignore = true;
    };
  }, [activeQuery]);

  const submit = (q) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setInput(trimmed);
    setParams({ q: trimmed });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Search past minutes</h1>
          <p>Ask in plain language. Results are ranked by meaning, not just matching keywords.</p>
        </div>
      </div>

      <div className="card">
        <form
          className={styles.searchForm}
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Who is handling the data migration?"
            aria-label="Search query"
            autoFocus
          />
          <Button type="submit" disabled={!input.trim()} loading={loading}>
            Search
          </Button>
        </form>
        {!activeQuery && (
          <div className={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className={styles.suggestion} onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <ErrorMessage error={error} onRetry={() => setParams({ q: activeQuery })} />

      {loading && !results && <Spinner label="Searching…" />}

      {activeQuery && results && !error && (
        <div>
          <p className="muted small" style={{ marginBottom: 10 }}>
            {results.length} result{results.length === 1 ? '' : 's'} for “{activeQuery}”
          </p>
          {results.length === 0 ? (
            <div className="card">
              <EmptyState icon="🔍" title="No matching minutes" message="Try different wording. Only approved MOMs are searchable." />
            </div>
          ) : (
            <ul className={styles.results}>
              {results.map((r) => (
                <li key={r.meetingId} className={`card ${styles.result}`}>
                  <div className={styles.resultHead}>
                    <Link to={`/meetings/${r.meetingId}`}>
                      <strong>{r.title}</strong>
                    </Link>
                    <span className={styles.score} title="Similarity score">
                      {Math.round(r.score * 100)}% match
                    </span>
                  </div>
                  <span className="muted small">{formatDate(r.date)}</span>
                  <p className={styles.snippet}>
                    <Highlight text={r.snippet} query={activeQuery} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
