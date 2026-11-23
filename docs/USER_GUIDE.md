# User guide: recording a Microsoft Teams meeting

The app runs in **Chrome or Edge**, beside Teams. It records two things: **your microphone** and **the meeting's audio**, which is everyone else. A small floating overlay stays on top of Teams while you talk.

## First time
1. Open the app link and choose **Create account**.
2. **Copy the API token** it shows and keep it somewhere safe. It's your password for signing in on another browser, and it is shown only once.
3. Optional: **Settings → Connect Outlook**, so you can pick meetings from your calendar.

## Recording a meeting
1. **Join the Teams meeting** as usual.
2. In the app, click **New meeting** and choose one of:
   - **Outlook**: pick the meeting, and the title and attendees fill in.
   - **Invite file**: drop the `.ics` file from the invite email.
   - **Type it in**: enter a title and add participants.
3. Tick the box confirming **everyone knows the meeting is recorded**, then **Continue to recording**.
4. Click **Start microphone**.
5. Click **Share meeting audio**:
   - **Teams in a browser tab:** choose the *Chrome Tab* (or *Edge Tab*) running Teams and switch on **Share tab audio**.
   - **Teams desktop app (Windows):** choose **Entire screen** and switch on **Share system audio**.
   - Only audio is kept; the video of your screen is discarded straight away.
6. Click **Pop out overlay**. A small window with the timer, Pause and End floats above Teams. You can minimise the app tab.
7. When the meeting ends, click **End** in the overlay or the app.

The app uploads audio every couple of minutes, so a crash or reload loses at most the last slice. Reopening the meeting lets you continue.

## After the meeting
1. **Processing** takes a few minutes: transcription, then working out who said what, then drafting the minutes.
2. **Review**:
   - Read the transcript.
   - Give names to any unknown voices (shown as "Speaker 3A").
   - Check the summary, decisions and action items, making sure each has an owner and a deadline.
   - Click **Approve**.
3. **Distribute**: choose PDF or Word and click **Send MOM**. Every participant with an email gets it, and the delivery log shows any failures, which you can resend.

## If something goes wrong
| Problem | Fix |
|---|---|
| "Share meeting audio" picked the wrong thing / no audio | Click it again. For a tab, make sure **Share tab audio** is on. On macOS, use Teams in a browser tab (system audio isn't available) |
| No overlay button | Use Chrome or Edge 116+ |
| Processing failed | Click **Retry**. If one slice is unreadable, use **Retry without unreadable chunks** |
| Can't approve | Name every "Speaker …" and give each action item an owner and deadline |
| Signed out on another device | Sign in with **I have a token**. If you got a new token in Settings, the old one stops working |
