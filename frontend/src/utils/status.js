// One place that maps every backend status to a label and colour.
// Meeting statuses come from backend/app/models.py MeetingStatus.
export const STATUS = {
  recording: { label: 'Recording', tone: 'danger' },
  finalizing: { label: 'Generating MOM', tone: 'info' },
  draft: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'primary' },
  distributed: { label: 'Distributed', tone: 'success' },
  failed: { label: 'Processing failed', tone: 'danger' },
};

// Email delivery statuses (DeliveryStatus).
export const DELIVERY_STATUS = {
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

// Audio chunk statuses (ChunkStatus) plus local upload states.
export const CHUNK_STATUS = {
  queued: { label: 'Queued', tone: 'neutral' },
  uploading: { label: 'Uploading', tone: 'info' },
  error: { label: 'Upload failed', tone: 'danger' },
  done: { label: 'Uploaded', tone: 'success' },
  pending: { label: 'Waiting', tone: 'neutral' },
  transcribed: { label: 'Transcribed', tone: 'success' },
  failed: { label: 'Transcription failed', tone: 'danger' },
};

export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, { label }]) => ({ value, label }));
