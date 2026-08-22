<div align="center">

# 🎓 Academelp

**A self-hosted tracker for your university coursework.**

Import assignments and lessons straight from your OPAL/Moodle pages,
then watch the progress bars fill up.

</div>

---

## Quick start

```bash
docker compose up -d
```

Open **http://localhost:8642**. That's it — no dependencies, no setup.

Your tasks live in a Docker volume (`academelp-data`), so they survive
rebuilds, restarts, and browser cleanups.

<details>
<summary>Other ways to run it</summary>

**Plain Docker**

```bash
docker build -t academelp .
docker run -d -p 8642:8642 -v academelp-data:/data --name academelp academelp
```

**Without Docker** — needs only Node 18+:

```bash
node server.js          # or double-click start.command on macOS
```

Data then goes to `data.json` next to the app. Opening `index.html`
directly works too, but saves to browser localStorage only. The header
shows which mode you're in.

</details>

### Configuration

| Variable   | Default     | What it does                        |
| ---------- | ----------- | ----------------------------------- |
| `PORT`     | `8642`      | Port the server listens on          |
| `HOST`     | `127.0.0.1` | Bind address (`0.0.0.0` in Docker)  |
| `DATA_DIR` | app folder  | Where `data.json` is written        |

### Backups

```bash
docker compose exec academelp cat /data/data.json > backup.json
```

Or just hit **Export** in the app — the JSON it downloads re-imports cleanly.

---

## Importing your coursework

**The easy way — paste the page HTML.** On OPAL, open a course's מטלות הקורס
page, view source (`⌘⌥U` on Mac, `Ctrl+U` elsewhere), select all, copy, and
paste into the app's import box. Course name, due dates, links, and
הוגש / לא הוגש status are all parsed out for you.

Assignments and lessons share one dataset; the right screen is detected
automatically from whichever page you paste. Moodle completion marks like
הושלם arrive pre-ticked.

<details>
<summary>Or use the bookmarklet</summary>

1. Open the app → **Import from uni site**.
2. Drag **📥 Grab uni tasks** to your bookmarks bar.
3. Log in to your portal, open the assignments page.
4. Click the bookmark — it scrapes the page to your clipboard as JSON.
5. Paste into the import box → **Import**.

Tuned for OPAL/Moodle: real course names from the course menu, Hebrew and
English keywords, day-first Israeli dates, with generic fallbacks elsewhere.

</details>

<details>
<summary>Or type them by hand</summary>

One task per line, in the import box:

```
Calculus 1 | Homework 4 | 2026-07-30
Physics 2 | Lab report 1
```

</details>

> **Re-importing is safe.** Tasks match on course + title, so nothing
> duplicates — due dates, links, and submission status refresh in place, and
> ticks you made by hand are never undone.

---

## Features

- 📊 Overall and per-course progress meters
- ⏰ Overdue detection (unsubmitted and past due)
- 🔍 Filter by all / pending / overdue / submitted; sort by due date, course, or added
- ✏️ Manual add, edit, delete — links jump to the original assignment page
- 💾 JSON export that doubles as a backup
- 🌗 Light and dark mode, following your system

## Project layout

| File                   | Role                                                    |
| ---------------------- | ------------------------------------------------------- |
| `index.html`           | App shell                                               |
| `styles.css`           | Theme and layout                                        |
| `app.js`               | State, rendering, import/export                         |
| `bookmarklet.js`       | Scraper injected into the uni site                      |
| `server.js`            | Zero-dependency server and JSON persistence             |
| `Dockerfile`           | Container image (non-root, healthchecked)               |
| `docker-compose.yml`   | One-command run with a named data volume                |
| `start.command`        | macOS double-click launcher                             |

## License

MIT
