# Academelp

A standalone tracker for your university work, with two screens over one dataset:
**Assignments** (submission tracking, imported from מטלות הקורס pages) and
**Lessons** (study progress, imported from course home pages — Moodle completion
marks like הושלם come in pre-ticked). Paste a page's HTML into the import box and
the right screen is detected automatically. Progress percentages are tracked
overall and per course.

## Run it

Double-click `start.command` (or run `node server.js`). It starts a tiny local
server at http://localhost:8642, opens the app in your browser, and saves your
tasks to `data.json` in this folder — a real file on disk that survives browser
cleanups. No dependencies to install (just Node).

Opening `index.html` directly still works, but then data is saved only in that
browser's localStorage. The header shows which mode you're in.

### Run it with Docker

```
echo '[]' > data.json    # first run only — creates the file the container mounts
docker compose up -d --build
```

The app is then at http://localhost:8642. Tasks persist to `data.json` in this
folder via a bind mount, so they survive container rebuilds. Without Compose:

```
docker build -t academelp .
docker run -d -p 8642:8642 -v "$(pwd)/data.json:/app/data.json" academelp
```

## Getting tasks from your uni site

**Easiest — paste the page HTML:** on OPAL, open the course's מטלות הקורס page,
view its source (⌘⌥U in Safari/Chrome on Mac, Ctrl+U elsewhere, or right-click →
View Page Source), select all, copy, and paste it into the app's import box.
The app parses the assignments straight out of the HTML — course name, due
dates, links, and הוגש / לא הוגש submission status.

**Or use the bookmarklet:**

1. Open the app and click **Import from uni site**.
2. Drag the **📥 Grab uni tasks** button to your bookmarks bar.
3. Log in to your university portal and open the page listing your assignments —
   on OPAL (opal.openu.ac.il) that's the course's מטלות הקורס page.
4. Click the bookmark. It scans the page for assignment rows and copies them to
   your clipboard as JSON. It's tuned for OPAL/Moodle: it reads the real course
   name from the course menu, understands הוגש / לא הוגש submission status,
   Hebrew and English keywords, and day-first (Israeli) date formats — and falls
   back to generic heuristics on any other site.
5. Paste into the import box and click **Import**.

Re-importing is safe: existing tasks are matched by course + title, so nothing is
duplicated — due dates, links, and submitted-status get refreshed instead. Ticks
you made manually are never un-ticked by an import.

You can also paste plain lines into the import box, one task per line:

```
Calculus 1 | Homework 4 | 2026-07-30
Physics 2 | Lab report 1
```

## Features

- Overall completion percentage with a progress meter
- Per-course cards with their own progress bars
- Overdue detection (unsubmitted + past due date)
- Filters (all / pending / overdue / submitted) and sorting (due date / course / added)
- Manual add, edit, delete; links open the original assignment page
- Export everything as JSON (also works as a backup — re-import it later)
- Light and dark mode follow your system setting

## Files

- `index.html` — the app shell
- `styles.css` — theme (light/dark) and layout
- `app.js` — state, rendering, import/export
- `bookmarklet.js` — the scraper that runs on the uni site (serialized into the
  bookmarklet link by `app.js`)
- `server.js` — local server; persists tasks to `data.json` (no dependencies)
- `start.command` — double-click launcher for the server (macOS)
- `data.json` — your tasks (created on first save; back it up if you like;
  not committed to git since it's your personal data)
- `Dockerfile` / `docker-compose.yml` — containerized run (see above)
