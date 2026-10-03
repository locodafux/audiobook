# Audiobook: behaviour spec

What the existing (v1) audiobook app and generator do today. The new app in this repo
implements this spec from scratch; nothing is ported from the old code. Source: a
read-only reading of the old Expo app and Python generator, plus
the rework-plan research report.

**In plain English.** The generator turns an EPUB into one narrated MP3 per chapter,
plus a per-sentence timing list. A read API serves the catalog, chapter list, timing
and audio. The Android app browses the catalog, downloads chapters to the phone, and
plays them offline with the current sentence highlighted as it is read.

## 1. Mobile app (Android only)

### 1.1 Shell and navigation
- Four bottom tabs: **Library**, **Catalog**, **Downloads**, **Settings**.
- Stack-style routes on top of the tabs: **Story detail** and **Player**.
- A persistent bar above the tabs: a **mini-player** (cover, title, play/pause, progress)
  whenever something is loaded; otherwise a **download badge** (circular progress) when
  downloads are active, queued, paused or failed. The mini-player wins the row; the
  badge is hidden while on the Downloads tab.
- Light and dark themes follow the system colour scheme. Android back button navigates
  back through the routes.
- A top-level error boundary keeps a render crash from blanking the app.

### 1.2 Catalog (remote)
- Lists stories from the read API. Only stories with `chapterCount > 0` are shown.
- Search box filters by title and author (case-insensitive).
- Card shows cover, title, author-or-series, "N generated chapters · M min".
- Pull to refresh. Result is cached in memory so switching tabs does not refetch.
- Failure states: when the backend cannot be reached (network or 8 s timeout) show
  "Backend unavailable. Downloaded chapters still work offline."; other HTTP errors
  show the server's `{error}` message.

### 1.3 Library (local)
- Lists stories that have at least one downloaded chapter, from local SQLite.
- Filter tabs with counts: **All / In progress / Finished**.
  - *In progress*: has saved progress. *Finished*: progress is on the last chapter and
    within 5 s of its end. Stories with no progress are "not started".
- Tapping opens the story detail (local source). Long-press/menu deletes a downloaded
  story after a confirm dialog ("Delete downloaded story?"), cascading to its chapters,
  sentences, progress and bookmarks and removing files.

### 1.4 Story detail
- Header: cover, title, author, series/volume, summary with "Read more / Show less".
- Chapter list, each row showing number, title, duration, and a state label:
  *Not downloaded, Ready to download, Queued #n, Downloading, Retry queued, Failed,
  Available offline, Backend unavailable*.
- Primary action adapts: **Listen now** (something is downloaded), **Queue chapter 1**,
  **Download whole story** / **Downloaded**, **Backend unavailable**.
- Multi-select sheet over chapters: Select all / Clear, "Not downloaded" shortcut,
  **Download**, **Retry**, **Delete**.
- Link to **Manage downloads**.
- Works from either source: remote (catalog preview + live manifest) or local (offline).

### 1.5 Player
- Plays the story's downloaded chapters as one queue; starts at the last saved chapter
  and position, or a chosen chapter.
- Controls: play/pause, previous/next **sentence**, previous/next chapter, seek bar,
  playback speed cycling through 0.75, 1, 1.25, 1.5, 1.75, 2x, and a sleep timer cycling
  15 / 30 / 45 / 60 min / off (pauses playback when it fires).
- Previous-sentence rule: if more than 2 s into the current sentence, restart it;
  otherwise go to the previous sentence.
- Background playback with a lock-screen/notification media session (play, pause, stop,
  seek, next, previous) that continues after the app is swiped away. Audio focus and
  interruptions (calls) are handled by the player.
- A missing or unreadable audio file stops playback and shows "Couldn't play this
  chapter, the downloaded audio file may be missing."
- If the current chapter is deleted while playing, playback is cleared.
- **Bookmarks**: toggle on the current sentence ("Bookmark saved/removed"; requires a
  current sentence). Bookmark chips list chapter number/title and the sentence text;
  tapping seeks there, a button removes it. One bookmark per sentence.
- **Progress**: position and sentence index are saved every 5 s of playback, on
  pause/background (flush), and per story (one progress row per story).

### 1.6 Read-along highlight
- Each downloaded chapter has a sentence list: `index, text, startTime, endTime,
  paragraphId` (seconds, floats).
- A sync tick runs every 500 ms (`SYNC_INTERVAL_MS`); position is looked up in the local
  sentence table (`startTime <= position < endTime`) and the current index is updated.
- The text view shows all sentences: already-spoken sentences at full opacity, upcoming
  ones faded, the current one marked with a left accent rule (no layout shift). The view
  auto-scrolls to the current sentence. Tapping a sentence seeks to its start.
- Timing validation on download (see 1.7) guarantees the highlight data is trustworthy.

### 1.7 Downloads
- Unit of work is one chapter: an MP3 plus its timing JSON. Files live under the app's
  document directory at `stories/<storyId>/chapter_NN.mp3` (+ timing), named by chapter
  number.
- A persistent queue (SQLite `download_jobs`) with states `queued, downloading, paused,
  completed, failed, canceled`; survives app restarts. Interrupted jobs are re-queued on
  start unless the queue was explicitly paused.
- The queue drains sequentially in a single loop (not timer-chained, because Android
  stops JS timers when backgrounded). A native **foreground service** (data-sync type,
  with a wake lock and a low-importance "Downloads" notification that opens the app)
  keeps the process alive while the queue drains and ends when it is empty.
- Per job: fetch the story manifest (cached once per drain), resolve the audio URL,
  download with progress, fetch the timing, **validate timing** (non-empty, indices
  sequential from 0, entries ordered and non-overlapping, every entry has positive
  duration), then atomically import: move the file first, then upsert story, chapter and
  sentences in one transaction. A redownload must not wipe bookmarks or progress.
- Progress is throttled (every 1.5 s or 256 KiB) and shows bytes, speed and ETA.
- Automatic retry up to 2 times for transient errors (network, timeout, HTTP
  408/429/500/502/503/504); everything else fails and can be retried manually.
- Downloads screen: sections for active, queued, failed and completed; per-row cancel,
  retry, delete; **Pause queue / Resume queue / Cancel all**; confirm dialogs for
  destructive actions; snackbar feedback.
- Deleting a chapter, a story, or everything removes files and rows consistently.
  Rows never claim "downloaded" when the file is gone (an earlier incident: files
  missing while rows said downloaded, then foreign-key errors wiping rows).

### 1.8 Settings
- Shows backend URL and sync interval (read-only).
- **Clear offline library** (confirm dialog), removing all local downloads and playback
  data, then an alert confirming.

### 1.9 Local data (SQLite)
Tables: `stories`, `chapters` (id `storyId:NNNN`, audioPath, timingPath, duration,
downloadStatus), `sentences`, `progress` (unique per story), `bookmarks` (unique per
story+chapter+sentence), `download_jobs`, `app_settings` (`queuePaused`). Foreign keys
cascade on delete. Indexes: sentence lookup by `(chapterId, startTime, endTime)`, unique
`(chapterId, sentenceIndex)`, chapters by `(storyId, chapterNumber)`. Schema versioning
uses `PRAGMA user_version` migrations. All writes are serialized through one exclusive
runner.

### 1.10 Non-functional
- Android only; minimum behaviours must work offline once downloaded.
- Notifications permission requested on Android 13+; the download service runs even if
  denied (only its notification is hidden).
- All API calls have an 8 s timeout and typed errors (`timeout | network | http`).

## 2. Read API contract (the live one: Supabase Edge Function `api`)

All paths under `/api`; errors are `{ "error": "<message>" }`.

| Route | Returns |
|---|---|
| `GET /stories` | `{ stories: CatalogStory[] }` |
| `GET /stories/:id` | `CatalogStory` + `coverFile, voice, ttsProvider, generatedAt, chapters[]` |
| `GET /stories/:id/chapters/:n/timing` | bare JSON array of `{index,text,startTime,endTime,paragraphId}` |
| `GET /stories/:id/chapters/:n/audio-url` | `{storyId, chapterNumber, downloadUrl, fileSize}` |
| `GET /stories/:id/chapters/:n/audio` | audio bytes, HTTP Range supported |

`CatalogStory`: `id, title, displayTitle, seriesTitle, volumeNumber, author, description,
summary, language, coverUrl, totalDuration, chapterCount, telegramAudioCount, timingCount,
mobileReady`.

Business rules (from `BUSINESS_RULES.md`, BR-n):
- BR-1..4 Displayed title: `displayTitle` if set; else raw title unless it is "untitled"
  (any case) or under 2 chars, in which case derive from the id (split on `-`/`_`,
  upper-case the first letter of each part, join with spaces). `title == displayTitle`.
- BR-5 `chapterCount` = length of the chapters list.
- BR-6 `telegramAudioCount` = chapters with a truthy audio file id.
- BR-7 `timingCount` = number of chapters that have timing.
- BR-8 `mobileReady` = `chapterCount > 0 && audioCount == chapterCount && timingCount >= chapterCount`.
- BR-9 Catalog sorted ascending by raw stored title.
- BR-10 Chapter URLs are root-relative, story id percent-encoded.
- BR-13 Timing row id `storyId:NNNN` (4-digit zero padded chapter number).
- Errors: 400 bad chapter number; 404 story / chapter / timing not found; 409 chapter has
  no audio; 502 upstream storage failure; 500 generic.
- Timing units are seconds (floats).

The new app keeps reading this contract unchanged until the v2 schema lands (later phase).

## 3. Generator

### 3.1 Pipeline (one EPUB to one story)
1. **Parse** (ebooklib + BeautifulSoup): metadata (title, author, language, cover),
   chapters from the spine/TOC (including anchor-split TOC entries), front-matter and
   boilerplate/watermark stripping, zero-width character removal, chapter title headings.
   Chapters split into paragraphs and **sentences** by regex; sentences over ~900 chars
   are hard-chunked. `chapterNumber` is positional (1-based, spine order).
2. **Synthesize** with **edge-tts**, one request per sentence. Voice
   `en-US-BrianNeural`, rate **`+0%` (normal speed)**, volume `+0%`. Content-addressed
   cache keyed by `sha256(voice|rate|volume|text)`; bounded retries with back-off for the
   transient "no audio received" throttling.
3. **Measure** each sentence MP3's duration (mutagen) to build `startTime/endTime`.
4. **Concatenate** a chapter's sentences with ffmpeg concat (`-c copy`) into
   `chapter_NN.mp3`.
5. **Store** audio (v1: Telegram `sendAudio`, with splitting above 19 MiB; v2 target:
   Cloudflare R2) and persist story, chapter and timing records to Postgres.
6. Concurrency: several chapters in parallel, many sentences in flight per chapter
   (v1 defaults 6 chapters x 20 sentences). Per-chapter status `pending, generating,
   complete, failed`; a chapter is skipped on resume only if complete and stored.
7. Jobs: enqueue by EPUB, one worker, pause / resume / cancel (cancel can stop
   mid-chapter), de-duplication of the same book, interrupted jobs re-queued on restart,
   errors recorded rather than swallowed.
8. Local output: `processed/<story>/chapter_NN.mp3` + timing JSON; sentence cache outside
   the repo.

### 3.2 Surfaces
- CLI to process one EPUB; admin HTTP API (health, stories, epubs, process, process-batch,
  jobs, cancel, pause, resume, processing status with sub-chapter progress).
- Auth on admin routes via an admin key; never expose the full book text or server paths
  on public routes.

### 3.3 Known defects the new build must not reproduce
- Re-run drops multi-part audio references and nulls unmodelled story fields.
- Resume predicate tied to the storage backend.
- Positional chapter numbers renumber silently after a parser change (needs a guard).
- Whole-array JSON rewrites per chapter status update (use one row per chapter).
- Public endpoints leaking book text and server paths.

## 4. Out of scope for this spec
iOS, accounts/multi-user, a web player, OTA updates. Later phases (schema v2, R2 audio,
sign-in, generator rework, in-app updater) build on this spec.
