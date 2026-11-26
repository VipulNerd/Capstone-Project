const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (v) => EMAIL_RE.test(String(v).trim());
export const isBlank = (v) => !v || !String(v).trim();

// Voices the backend could not match to an invitee keep a placeholder like "Speaker 3A".
export const isUnnamedSpeaker = (name) => /^speaker\s*\d+[a-z]?$/i.test(String(name).trim());

export function validateOrganiser({ name, email }) {
  const errors = {};
  if (isBlank(name)) errors.name = 'Name is required';
  if (isBlank(email)) errors.email = 'Email is required';
  else if (!isEmail(email)) errors.email = 'Enter a valid email address';
  return errors;
}

export const MIN_PASSWORD = 8;

/** New password + confirmation (sign-up, reset, change). */
export function validateNewPassword(password, confirm) {
  const errors = {};
  if (!password) errors.password = 'Choose a password';
  else if (password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters`;
  if (password && confirm !== password) errors.confirm = "Passwords don't match";
  return errors;
}

/** Returns one error object per participant ({} when the row is valid). */
export function validateParticipants(participants) {
  const seen = new Set();
  return participants.map((p) => {
    const e = {};
    const email = String(p.email || '').trim().toLowerCase();
    if (isBlank(p.name)) e.name = 'Name is required';
    else if (isUnnamedSpeaker(p.name)) e.name = 'Who is this? Enter their name';
    // Email is optional: auto-detected guests may not have one. They just won't be emailed.
    if (email && !isEmail(email)) e.email = 'Invalid email';
    else if (email && seen.has(email)) e.email = 'Duplicate email';
    if (email) seen.add(email);
    return e;
  });
}

export function validateActionItems(items) {
  return items.map((a) => {
    const e = {};
    if (isBlank(a.task)) e.task = 'Task is required';
    if (isBlank(a.owner)) e.owner = 'Owner is required';
    if (isBlank(a.deadline)) e.deadline = 'Deadline is required';
    return e;
  });
}

/** Participants typed in when starting a meeting without a calendar invite. */
export function validateNewMeeting({ title, participants }) {
  const errors = {};
  if (isBlank(title)) errors.title = 'Meeting title is required';
  else if (title.trim().length > 255) errors.title = 'Title must be 255 characters or fewer';
  const people = validateParticipants(participants);
  if (hasErrors(people)) errors.participants = people;
  return errors;
}

export const hasErrors = (errors) =>
  Array.isArray(errors)
    ? errors.some((e) => Object.keys(e).length > 0)
    : Object.keys(errors).length > 0;

/** Validates a full MOM before approval. */
export function validateMom(mom) {
  const errors = {};
  if (isBlank(mom.title)) errors.title = 'Title is required';
  if (isBlank(mom.summary)) errors.summary = 'Summary is required';
  if (!mom.participants.length) errors.participantsGeneral = 'Add at least one participant';
  const participants = validateParticipants(mom.participants);
  if (hasErrors(participants)) errors.participants = participants;
  const actionItems = validateActionItems(mom.actionItems);
  if (hasErrors(actionItems)) errors.actionItems = actionItems;
  return errors;
}
