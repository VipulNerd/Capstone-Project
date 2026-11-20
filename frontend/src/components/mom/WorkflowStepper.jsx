import styles from './mom.module.css';

const STEPS = ['Capture', 'Transcribe', 'Generate MOM', 'Review & approve', 'Distribute'];

// Maps a meeting status to the index of the current workflow step.
const STATUS_STEP = {
  live: 1,
  uploaded: 1,
  transcribing: 1,
  extracting: 2,
  draft_ready: 3,
  approved: 4,
  sent: 5,
  failed: 4,
};

export default function WorkflowStepper({ status }) {
  const current = STATUS_STEP[status] ?? 0;
  return (
    <ol className={styles.stepper} aria-label="Workflow progress">
      {STEPS.map((label, i) => {
        const cls = i < current ? styles.stepDone : i === current ? styles.stepCurrent : '';
        return (
          <li key={label} className={`${styles.step} ${cls}`} aria-current={i === current ? 'step' : undefined}>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
