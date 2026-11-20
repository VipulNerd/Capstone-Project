/** Returns the page a meeting should open on, based on where it is in the workflow. */
export function meetingLink(m) {
  switch (m.status) {
    case 'live':
      return `/live/${m.id}`;
    case 'uploaded':
    case 'transcribing':
    case 'extracting':
      return `/meetings/${m.id}/processing`;
    case 'draft_ready':
      return `/meetings/${m.id}/review`;
    case 'approved':
      return `/meetings/${m.id}/distribute`;
    default:
      return `/meetings/${m.id}`;
  }
}
