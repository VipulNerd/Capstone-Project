// One place that maps every backend status to a label and colour.
export const STATUS = {
  live: { label: 'Live · capturing', tone: 'danger' },
  uploaded: { label: 'Uploaded', tone: 'neutral' },
  transcribing: { label: 'Transcribing', tone: 'info' },
  extracting: { label: 'Generating MOM', tone: 'info' },
  draft_ready: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'primary' },
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  // delivery statuses
  queued: { label: 'Queued', tone: 'neutral' },
};

export const STATUS_OPTIONS = Object.entries(STATUS)
  .filter(([key]) => key !== 'queued')
  .map(([value, { label }]) => ({ value, label }));
