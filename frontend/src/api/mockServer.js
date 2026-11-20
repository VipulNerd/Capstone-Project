// In-browser fake backend. It mirrors the FastAPI contract documented in
// frontend/README.md so the UI can be built and demoed before the backend exists.
// State lives in memory (persisted to sessionStorage so a page refresh keeps it).

const STORE_KEY = 'mom_mock_db_v2';

const delay = (min = 300, max = 800) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

const fail = (status, message) => Promise.reject({ status, message });

const today = new Date();
const daysFromNow = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

function seed() {
  const team = [
    { name: 'Priya Sharma', email: 'priya.sharma@example.com' },
    { name: 'Rahul Verma', email: 'rahul.verma@example.com' },
    { name: 'Ananya Iyer', email: 'ananya.iyer@example.com' },
    { name: 'Karan Mehta', email: 'karan.mehta@example.com' },
  ];
  return {
    nextId: 4,
    meetings: [
      {
        id: '1',
        title: 'Sprint 14 Planning',
        date: daysFromNow(-6),
        sourceType: 'audio',
        fileName: 'sprint14.m4a',
        status: 'sent',
        createdAt: daysFromNow(-6),
        approvedAt: daysFromNow(-6),
        mom: {
          summary:
            'The team planned Sprint 14 with a focus on the transcription pipeline and the review UI. Capacity was confirmed at 32 story points.',
          discussionPoints: [
            'Whisper API latency for files longer than 30 minutes',
            'Chunking strategy for long audio uploads',
            'Design of the MOM review screen',
          ],
          decisions: [
            'Split audio into 10-minute chunks before transcription',
            'Use FAISS flat index for the first release',
          ],
          actionItems: [
            { id: 'a1', task: 'Implement audio chunking service', owner: 'Rahul Verma', ownerEmail: 'rahul.verma@example.com', deadline: daysFromNow(2) },
            { id: 'a2', task: 'Build MOM review page wireframes', owner: 'Ananya Iyer', ownerEmail: 'ananya.iyer@example.com', deadline: daysFromNow(1) },
          ],
          participants: team,
        },
        deliveries: team.map((p) => ({ email: p.email, name: p.name, status: 'sent', formats: ['pdf'], updatedAt: daysFromNow(-6) })),
      },
      {
        id: '2',
        title: 'Client Onboarding – Acme Corp',
        date: daysFromNow(-3),
        sourceType: 'transcript',
        fileName: 'acme-onboarding.vtt',
        status: 'approved',
        createdAt: daysFromNow(-3),
        approvedAt: daysFromNow(-2),
        mom: {
          summary:
            'Kick-off with Acme Corp to agree scope, timelines and the communication plan for the onboarding project.',
          discussionPoints: ['Project scope and phases', 'Data migration timeline', 'Weekly status call cadence'],
          decisions: ['Phase 1 go-live set for end of next month', 'Weekly status call every Tuesday'],
          actionItems: [
            { id: 'b1', task: 'Share signed SOW with Acme', owner: 'Priya Sharma', ownerEmail: 'priya.sharma@example.com', deadline: daysFromNow(3) },
            { id: 'b2', task: 'Prepare data migration checklist', owner: 'Karan Mehta', ownerEmail: 'karan.mehta@example.com', deadline: daysFromNow(7) },
          ],
          participants: [team[0], team[3]],
        },
        deliveries: [],
      },
      {
        id: '3',
        title: 'Budget Review Q4',
        date: daysFromNow(-1),
        sourceType: 'live',
        fileName: 'Microsoft Teams · live capture',
        status: 'draft_ready',
        createdAt: daysFromNow(-1),
        mom: {
          summary: 'Review of Q4 spend against budget, with cloud costs flagged as the main overrun.',
          discussionPoints: ['Cloud costs 18% over budget', 'Hiring freeze for Q4', 'Training budget reallocation'],
          decisions: ['Move non-prod environments to auto-shutdown at night'],
          actionItems: [
            { id: 'c1', task: 'Configure auto-shutdown for dev and test VMs', owner: 'Rahul Verma', ownerEmail: 'rahul.verma@example.com', deadline: daysFromNow(5) },
            { id: 'c2', task: 'Draft revised training budget', owner: '', ownerEmail: '', deadline: '' },
          ],
          participants: [
            ...team.slice(0, 3).map((p) => ({ ...p, source: 'teams' })),
            { name: 'Daniel Brooks (External)', email: '', source: 'teams' },
          ],
        },
        deliveries: [],
      },
    ],
  };
}

function load() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore corrupt storage */
  }
  return seed();
}

let db = load();
const save = () => {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {
    /* storage may be unavailable */
  }
};

const clone = (x) => JSON.parse(JSON.stringify(x));
const findMeeting = (id) => db.meetings.find((m) => m.id === String(id));
const summaryOf = ({ mom, deliveries, ...rest }) => ({
  ...rest,
  participantCount: mom?.participants?.length ?? rest.participants?.length ?? 0,
  actionItemCount: mom?.actionItems?.length ?? 0,
  failedDeliveries: (deliveries || []).filter((d) => d.status === 'failed').length,
});

// ---------- auth ----------
export async function login(email, password) {
  await delay();
  if (password.length < 6) return fail(401, 'Invalid email or password');
  const name = email.split('@')[0].replace(/[._]/g, ' ');
  return { token: `mock-token-${Date.now()}`, user: { email, name } };
}

export async function me() {
  await delay(100, 200);
  return { email: 'organiser@example.com', name: 'organiser' };
}

// ---------- meetings ----------
export async function listMeetings() {
  await delay();
  return clone(db.meetings)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(summaryOf);
}

export async function getMeeting(id) {
  await delay(150, 300);
  const m = findMeeting(id);
  if (!m) return fail(404, 'Meeting not found');
  // eslint-disable-next-line no-unused-vars
  const { mom, deliveries, ...rest } = clone(m);
  return { ...rest, participants: m.participants || mom?.participants || [] };
}

// Simulates transcription -> LLM extraction -> draft ready.
function generateDraft(meeting) {
  if (meeting.sourceType === 'live') {
    meeting.mom = liveMom(meeting);
    return;
  }
  // Without a linked Teams meeting, participants come from speaker diarization:
  // voices are separated but names are unknown until the organiser renames them.
  if (!meeting.participants?.length) {
    meeting.participants = [
      { name: 'Speaker 1', email: '', source: 'speaker' },
      { name: 'Speaker 2', email: '', source: 'speaker' },
      { name: 'Speaker 3', email: '', source: 'speaker' },
    ];
  }
  const p = meeting.participants;
  const owner = (i) => p[i % p.length] || { name: '', email: '' };
  meeting.mom = {
    summary: `The meeting "${meeting.title}" covered progress updates, open risks and next steps. The team agreed on priorities for the coming week and assigned follow-up tasks.`,
    discussionPoints: [
      'Status of ongoing deliverables',
      'Risks and blockers raised by the team',
      'Resource allocation for next week',
    ],
    decisions: ['Proceed with the current release plan', 'Hold a follow-up review next week'],
    actionItems: [
      { id: `n${Date.now()}1`, task: 'Circulate updated project timeline', owner: owner(0).name, ownerEmail: owner(0).email, deadline: daysFromNow(3) },
      { id: `n${Date.now()}2`, task: 'Investigate the reported blocker and report back', owner: owner(1).name, ownerEmail: owner(1).email, deadline: daysFromNow(5) },
      // Deliberately incomplete so the organiser has something to fix in review.
      { id: `n${Date.now()}3`, task: 'Book room for follow-up review', owner: '', ownerEmail: '', deadline: '' },
    ],
    participants: clone(p),
  };
}

export async function uploadMeeting(formData, onProgress) {
  // Fake upload progress.
  for (let pct = 20; pct <= 100; pct += 20) {
    await delay(120, 200);
    onProgress?.(pct);
  }
  const meta = JSON.parse(formData.get('metadata'));
  const file = formData.get('file');
  const id = String(db.nextId++);
  const meeting = {
    id,
    title: meta.title,
    date: meta.date,
    sourceType: meta.sourceType,
    fileName: file ? file.name : 'pasted-transcript.txt',
    participants: rosterFor(meta.teamsMeetingId),
    status: meta.sourceType === 'audio' ? 'transcribing' : 'extracting',
    createdAt: new Date().toISOString(),
    mom: null,
    deliveries: [],
    _startedAt: Date.now(),
  };
  db.meetings.push(meeting);
  save();
  return { id, status: meeting.status };
}

// Advance processing status based on elapsed time (called on every status poll).
function advance(m) {
  if (!m._startedAt || !['transcribing', 'extracting'].includes(m.status)) return;
  const elapsed = Date.now() - m._startedAt;
  const audio = m.sourceType === 'audio';
  if (audio && elapsed < 4000) m.status = 'transcribing';
  else if (elapsed < (audio ? 8000 : 4000)) m.status = 'extracting';
  else {
    generateDraft(m);
    m.status = 'draft_ready';
    delete m._startedAt;
  }
  save();
}

export async function getMeetingStatus(id) {
  await delay(100, 200);
  const m = findMeeting(id);
  if (!m) return fail(404, 'Meeting not found');
  advance(m);
  return { id: m.id, status: m.status, title: m.title, sourceType: m.sourceType };
}

// ---------- MOM ----------
export async function getMom(id) {
  await delay();
  const m = findMeeting(id);
  if (!m) return fail(404, 'Meeting not found');
  if (!m.mom) return fail(409, 'The MOM draft is not ready yet');
  return { ...clone(m.mom), status: m.status, title: m.title, date: m.date };
}

export async function updateMom(id, mom) {
  await delay();
  const m = findMeeting(id);
  if (!m) return fail(404, 'Meeting not found');
  if (['approved', 'sent'].includes(m.status)) return fail(409, 'An approved MOM cannot be edited');
  const { summary, discussionPoints, decisions, actionItems, participants } = mom;
  m.mom = clone({ summary, discussionPoints, decisions, actionItems, participants });
  save();
  return { ...clone(m.mom), status: m.status };
}

export async function approveMom(id) {
  await delay();
  const m = findMeeting(id);
  if (!m) return fail(404, 'Meeting not found');
  if (m.status !== 'draft_ready') return fail(409, `Cannot approve a meeting in status "${m.status}"`);
  m.status = 'approved';
  m.approvedAt = new Date().toISOString();
  save();
  return { id: m.id, status: m.status };
}

export async function exportMom(id, format) {
  await delay();
  const m = findMeeting(id);
  if (!m?.mom) return fail(404, 'Meeting not found');
  const { mom } = m;
  const text = [
    `MINUTES OF MEETING — ${m.title}`,
    `Date: ${m.date}`,
    '',
    'Participants:',
    ...mom.participants.map((p) => `  - ${p.name} <${p.email}>`),
    '',
    'Summary:',
    mom.summary,
    '',
    'Key Discussion Points:',
    ...mom.discussionPoints.map((d) => `  - ${d}`),
    '',
    'Decisions:',
    ...mom.decisions.map((d) => `  - ${d}`),
    '',
    'Action Items:',
    ...mom.actionItems.map((a) => `  - ${a.task} | Owner: ${a.owner} | Due: ${a.deadline}`),
    '',
    `(Mock ${format.toUpperCase()} export — the real backend generates this with ${format === 'pdf' ? 'ReportLab' : 'python-docx'}.)`,
  ].join('\n');
  return new Blob([text], { type: 'text/plain' });
}

// ---------- email ----------
export async function sendMom(id, formats) {
  await delay();
  const m = findMeeting(id);
  if (!m) return fail(404, 'Meeting not found');
  if (!['approved', 'sent'].includes(m.status)) return fail(409, 'The MOM must be approved before it is sent');
  const now = Date.now();
  m.deliveries = m.mom.participants.filter((p) => p.email).map((p) => ({
    email: p.email,
    name: p.name,
    formats,
    status: 'queued',
    updatedAt: new Date().toISOString(),
    _resolveAt: now + 1500 + Math.random() * 3000,
    _willFail: Math.random() < 0.15,
  }));
  save();
  return { queued: m.deliveries.length };
}

export async function retryDelivery(id, email) {
  await delay();
  const m = findMeeting(id);
  const d = m?.deliveries.find((x) => x.email === email);
  if (!d) return fail(404, 'Delivery not found');
  Object.assign(d, { status: 'queued', _resolveAt: Date.now() + 1500, _willFail: false, error: undefined });
  save();
  return { ok: true };
}

export async function getDeliveries(id) {
  await delay(100, 250);
  const m = findMeeting(id);
  if (!m) return fail(404, 'Meeting not found');
  let changed = false;
  m.deliveries.forEach((d) => {
    if (d.status === 'queued' && Date.now() >= d._resolveAt) {
      d.status = d._willFail ? 'failed' : 'sent';
      if (d._willFail) d.error = 'SMTP 550: mailbox unavailable';
      d.updatedAt = new Date().toISOString();
      changed = true;
    }
  });
  if (m.deliveries.length && m.deliveries.every((d) => d.status === 'sent') && m.status !== 'sent') {
    m.status = 'sent';
    changed = true;
  }
  if (changed) save();
  // eslint-disable-next-line no-unused-vars
  return m.deliveries.map(({ _resolveAt, _willFail, ...d }) => d);
}

// ---------- search ----------
const tokenize = (s) => s.toLowerCase().match(/[a-z0-9]+/g) || [];

export async function search(query) {
  await delay();
  const q = new Set(tokenize(query));
  if (!q.size) return [];
  return db.meetings
    .filter((m) => m.mom && ['approved', 'sent'].includes(m.status))
    .map((m) => {
      const sentences = [m.title, m.mom.summary, ...m.mom.discussionPoints, ...m.mom.decisions, ...m.mom.actionItems.map((a) => a.task)];
      let best = { score: 0, text: m.mom.summary };
      sentences.forEach((s) => {
        const words = tokenize(s);
        const hits = words.filter((w) => q.has(w)).length;
        const score = hits / Math.sqrt(q.size * Math.max(words.length, 1));
        if (score > best.score) best = { score, text: s };
      });
      return { meetingId: m.id, title: m.title, date: m.date, score: Math.min(0.99, best.score + 0.2), snippet: best.text, matched: best.score > 0 };
    })
    .filter((r) => r.matched)
    .sort((a, b) => b.score - a.score)
    // eslint-disable-next-line no-unused-vars
    .map(({ matched, ...r }) => r);
}


// =====================================================================
// Microsoft Teams + live capture (overlay) mock
// =====================================================================

const at = (hour, min) => {
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};

// What Microsoft Graph (/me/calendarView, onlineMeeting attendees) would return.
const TEAMS_MEETINGS = [
  {
    id: 'teams-1',
    title: 'Product Launch Readiness',
    start: at(10, 0),
    end: at(10, 30),
    organizer: 'Priya Sharma',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_launch',
    attendees: [
      { name: 'Priya Sharma', email: 'priya.sharma@example.com' },
      { name: 'Rahul Verma', email: 'rahul.verma@example.com' },
      { name: 'Ananya Iyer', email: 'ananya.iyer@example.com' },
      { name: 'Karan Mehta', email: 'karan.mehta@example.com' },
      { name: 'Daniel Brooks (External)', email: '' },
    ],
  },
  {
    id: 'teams-2',
    title: 'Design Review – Mobile App',
    start: at(14, 0),
    end: at(15, 0),
    organizer: 'Ananya Iyer',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_design',
    attendees: [
      { name: 'Ananya Iyer', email: 'ananya.iyer@example.com' },
      { name: 'Priya Sharma', email: 'priya.sharma@example.com' },
      { name: 'Meera Nair', email: 'meera.nair@example.com' },
    ],
  },
  {
    id: 'teams-3',
    title: 'Weekly Engineering Sync',
    start: at(17, 0),
    end: at(17, 30),
    organizer: 'Rahul Verma',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_sync',
    attendees: [
      { name: 'Rahul Verma', email: 'rahul.verma@example.com' },
      { name: 'Karan Mehta', email: 'karan.mehta@example.com' },
      { name: 'Sameer Khan', email: 'sameer.khan@example.com' },
    ],
  },
];

function rosterFor(teamsMeetingId) {
  const tm = TEAMS_MEETINGS.find((t) => t.id === teamsMeetingId);
  return tm ? tm.attendees.map((a) => ({ ...a, source: 'teams' })) : [];
}

// Scripted conversation the mock "hears". [seconds, speaker, text]
const SCRIPT = [
  [1, 'Priya Sharma', "Okay, let's get started. This is the launch readiness check for version 2.0."],
  [4, 'Priya Sharma', 'Rahul, can you start with the status of the backend?'],
  [7, 'Rahul Verma', 'Sure. The transcription service is stable, but recordings over an hour still time out.'],
  [11, 'Rahul Verma', "I'd suggest we split the audio into ten-minute chunks before sending it to the API."],
  [15, 'Ananya Iyer', 'That works for the UI. I can show a progress bar per chunk.'],
  [18, 'Priya Sharma', "Good, let's go with chunking. Rahul, can you have that done by Friday?"],
  [21, 'Rahul Verma', 'Yes, Friday is fine.'],
  [24, 'Daniel Brooks (External)', "From Acme's side, we need the minutes exported as DOCX, not just PDF."],
  [28, 'Priya Sharma', "Noted. We'll support both formats at launch."],
  [32, 'Karan Mehta', "Sorry I'm late. Quick QA update: we found two blockers in the email flow."],
  [36, 'Karan Mehta', 'Some recipients get the email twice when the organiser resends.'],
  [39, 'Priya Sharma', 'Karan, please log both blockers and share them with Rahul today.'],
  [42, 'Karan Mehta', 'Will do.'],
  [45, 'Ananya Iyer', 'One more thing: the review screen needs an approval checklist before anything is sent.'],
  [49, 'Priya Sharma', "Agreed, nothing goes out without the organiser's approval. Ananya, can you finish that by Wednesday?"],
  [53, 'Ananya Iyer', 'Yes, Wednesday works.'],
  [56, 'Daniel Brooks (External)', 'Could we get a demo before go-live?'],
  [59, 'Priya Sharma', "Let's do a demo for Acme next Tuesday. I'll send the invite."],
  [63, 'Priya Sharma', 'So the launch date stays the 15th, pending the two QA blockers.'],
  [67, 'Rahul Verma', 'Sounds good.'],
  [69, 'Priya Sharma', "Thanks everyone, that's it for today."],
];

// When each roster member joins the call (seconds). Others never join.
const JOIN_TIMES = {
  'Priya Sharma': 0,
  'Rahul Verma': 0,
  'Ananya Iyer': 2,
  'Daniel Brooks (External)': 3,
  'Karan Mehta': 30,
};

const activeSeconds = (s) => {
  const end = s.pausedAt ?? Date.now();
  return Math.max(0, (end - s.startedAt - s.pausedMs) / 1000);
};

export async function listTeamsMeetings() {
  await delay();
  return clone(TEAMS_MEETINGS);
}

export async function startLiveSession({ teamsMeetingId, joinUrl, title }) {
  await delay();
  const tm = TEAMS_MEETINGS.find((t) => t.id === teamsMeetingId) ||
    (joinUrl && { ...TEAMS_MEETINGS[0], title: title || 'Teams meeting', joinUrl });
  if (!tm) return fail(400, 'Choose a Teams meeting or paste a join link');
  const id = String(db.nextId++);
  db.meetings.push({
    id,
    title: title || tm.title,
    date: new Date().toISOString().slice(0, 10),
    sourceType: 'live',
    fileName: 'Microsoft Teams · live capture',
    status: 'live',
    createdAt: new Date().toISOString(),
    teamsMeetingId: tm.id,
    participants: [],
    mom: null,
    deliveries: [],
    live: { startedAt: Date.now(), pausedAt: null, pausedMs: 0, roster: tm.attendees },
  });
  save();
  return { id, status: 'live' };
}

/** Snapshot of a live session: transcript so far, who's in the call, timer. */
export async function getLiveState(id) {
  await delay(60, 120);
  const m = findMeeting(id);
  if (!m) return fail(404, 'Meeting not found');
  if (m.status !== 'live' || !m.live) {
    return { id: m.id, title: m.title, status: m.status, elapsed: 0, paused: false, transcript: m.transcript || [], participants: m.participants || [] };
  }
  const secs = activeSeconds(m.live);
  const transcript = SCRIPT.filter(([t]) => t <= secs).map(([t, speaker, text], i) => ({ id: `l${i}`, t, speaker, text }));
  const participants = m.live.roster
    .filter((a) => JOIN_TIMES[a.name] !== undefined && JOIN_TIMES[a.name] <= secs)
    .map((a) => ({ ...a, source: 'teams', joinedAt: JOIN_TIMES[a.name] }));
  const last = transcript[transcript.length - 1];
  return {
    id: m.id,
    title: m.title,
    status: m.status,
    elapsed: secs,
    paused: m.live.pausedAt !== null,
    transcript,
    participants,
    invited: m.live.roster.length,
    speaking: last && secs - last.t < 3 && m.live.pausedAt === null ? last.speaker : null,
  };
}

export async function pauseLiveSession(id, paused) {
  await delay(100, 200);
  const m = findMeeting(id);
  if (!m?.live) return fail(409, 'Session is not live');
  if (paused && m.live.pausedAt === null) m.live.pausedAt = Date.now();
  if (!paused && m.live.pausedAt !== null) {
    m.live.pausedMs += Date.now() - m.live.pausedAt;
    m.live.pausedAt = null;
  }
  save();
  return { paused: m.live.pausedAt !== null };
}

export async function stopLiveSession(id) {
  const state = await getLiveState(id);
  const m = findMeeting(id);
  if (!m?.live) return fail(409, 'Session is not live');
  m.transcript = state.transcript;
  m.participants = state.participants.map(({ name, email }) => ({ name, email, source: 'teams' }));
  m.durationSec = Math.round(state.elapsed);
  delete m.live;
  m.status = 'extracting';
  m._startedAt = Date.now();
  save();
  return { id, status: m.status };
}

function liveMom(m) {
  const said = (name) => m.transcript.some((l) => l.speaker === name);
  const person = (name) => m.participants.find((p) => p.name === name) || { name: '', email: '' };
  const item = (task, name, days) => {
    const p = said(name) ? person(name) : { name: '', email: '' };
    return { id: `lv${Math.random().toString(36).slice(2, 8)}`, task, owner: p.name, ownerEmail: p.email, deadline: p.name ? daysFromNow(days) : '' };
  };
  const heard = m.transcript.length;
  return {
    summary: heard
      ? 'Launch readiness check for version 2.0. The team reviewed backend stability, client export requirements and QA blockers in the email flow. The launch date stays on the 15th, subject to resolving the two QA blockers.'
      : 'No speech was captured during this session.',
    discussionPoints: [
      'Transcription timeouts for recordings longer than one hour',
      'Acme requires DOCX export in addition to PDF',
      'Two QA blockers in the email flow (duplicate emails on resend)',
      'Approval checklist on the review screen',
    ].slice(0, Math.max(1, Math.ceil(heard / 5))),
    decisions: [
      'Split audio into ten-minute chunks before transcription',
      'Support both PDF and DOCX export at launch',
      "Nothing is sent without the organiser's approval",
      'Launch date stays the 15th, pending the QA blockers',
    ].slice(0, Math.max(1, Math.ceil(heard / 6))),
    actionItems: [
      item('Implement ten-minute audio chunking', 'Rahul Verma', 3),
      item('Log both email-flow blockers and share with Rahul', 'Karan Mehta', 0),
      item('Add approval checklist to the review screen', 'Ananya Iyer', 2),
      item('Send demo invite to Acme for next Tuesday', 'Priya Sharma', 1),
      // The AI couldn't tell who owns this one, so the organiser must assign it.
      { id: `lv${Date.now()}`, task: 'Fix duplicate emails when the MOM is resent', owner: '', ownerEmail: '', deadline: '' },
    ],
    participants: clone(m.participants),
  };
}

export async function getTranscript(id) {
  await delay();
  const m = findMeeting(id);
  if (!m) return fail(404, 'Meeting not found');
  return m.transcript || [];
}

export function resetMockDb() {
  db = seed();
  save();
}
