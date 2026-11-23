import styles from './mom.module.css';

const STEPS = ['Record', 'Transcribe & draft', 'Review & approve', 'Distribute'];

// Maps a backend meeting status to the index of the current workflow step.
const STATUS_STEP = {
  recording: 0,
  finalizing: 1,
  failed: 1,
  draft: 2,
  approved: 3,
  distributed: 4,
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
