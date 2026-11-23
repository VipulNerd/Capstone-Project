/** Returns the page a meeting should open on, based on where it is in the workflow. */
export function meetingLink(m) {
  switch (m.status) {
    case 'recording':
      return `/meetings/${m.id}/record`;
    case 'finalizing':
    case 'failed':
      return `/meetings/${m.id}/processing`;
    case 'draft':
      return `/meetings/${m.id}/review`;
    case 'approved':
      return `/meetings/${m.id}/distribute`;
    default:
      return `/meetings/${m.id}`;
  }
}

/** Where a page should send the user if the meeting is not in a state that page handles. */
export function redirectFor(m, allowed) {
  return allowed.includes(m.status) ? null : meetingLink(m);
}
