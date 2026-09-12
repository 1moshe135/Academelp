<div align="center">

# 🎓 Academelp

**A self-hosted tracker for your university coursework.**

Your study paths, their courses, and the assignments, lessons and tests
inside them. Import straight from OPAL/Moodle, then watch the bars fill up.

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
<summary>Deploy on Portainer</summary>

**Option A — from this Git repo** (builds on your host, always current):

*Stacks → Add stack → Repository*

| Field                   | Value                                       |
| ----------------------- | ------------------------------------------- |
| Repository URL          | `https://github.com/1moshe135/Academelp`    |
| Reference               | `refs/heads/main`                           |
| Compose path            | `docker-compose.yml`                        |

Leave authentication off (the repo is public), then **Deploy the stack**.
Tick *GitOps updates* if you want Portainer to redeploy on every push.

**Option B — from the prebuilt image** (no build, fastest):

*Stacks → Add stack → Web editor*, paste:

```yaml
services:
  academelp:
    image: ghcr.io/1moshe135/academelp:latest
    container_name: academelp
    init: true
    ports:
      - "8642:8642"
    volumes:
      - academelp-data:/data
    restart: unless-stopped

volumes:
  academelp-data:
```

The image is published by GitHub Actions for `linux/amd64` and `linux/arm64`.
Make the package public once under *GitHub → Packages → academelp → Package
settings*, or add your registry credentials in Portainer.

Either way the app lands on **http://\<your-host\>:8642**, with tasks kept in
the `academelp-data` volume. Change the left-hand number under `ports` if 8642
is taken.

</details>

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

### Install it on your phone

Academelp is a PWA, so it installs to a home screen and runs fullscreen with
no browser chrome — and keeps working offline (your tasks sync back the next
time it reaches the server).

- **iOS/Safari** — Share → *Add to Home Screen*
- **Android/Chrome** — ⋮ → *Install app*
- **Desktop** — the install icon in the address bar

For your phone to reach it, deploy on a machine that's always on (a NAS, a
home server, a VPS) and use that host's address rather than `localhost`.

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

Everything shares one dataset, and whichever page you paste is detected
automatically — assignments or lessons — then filed under its course. Moodle
completion marks like הושלם arrive pre-ticked. Tests you add yourself, from
the **Tests** tab inside a course.

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

One item per line in the import box. After the title, everything is optional
and order doesn't matter — a date (ISO or day-first), a type word (English or
Hebrew), a link, `done`, or `grade:88`:

```
Calculus 1 | Homework 4 | 2026-07-30
Final exam | 15/01/2027 | test | grade:88
מטלה 12 | 30.10.2026 | done
```

Set the path, course and type once in the dialog's **Add to** row, or with
`#` lines that apply from there on:

```
#path Computer Science
#course Intro to CS
#type lesson
Unit 1 — Models
Unit 2 — Automata
```

</details>

> **Re-importing is safe.** Tasks match on course + title, so nothing
> duplicates — due dates, links, and submission status refresh in place, and
> ticks you made by hand are never undone.

---

## Features

- 🧭 **Paths** — a study track is its own world; inside one you see only its courses and deadlines
- 🏠 A course dashboard — one tile per course, with its progress, counts, and what's next
- 📚 Each course opens onto three tabs: **Assignments**, **Lessons**, **Tests**
- 📝 Tests track their date, a countdown, and an optional grade
- ⏳ "Coming up" — the next deadlines, scoped to wherever you are
- 📊 Overall and per-course progress meters
- ⏰ Overdue detection (unsubmitted and past due)
- 🔍 Filter any tab down to what's still pending
- ✏️ Manual add, edit, delete — links jump to the original assignment page
- 💾 JSON export that doubles as a backup
- 📱 Installs to your phone's home screen; works offline
- 🌗 Light and dark mode, following your system

## Project layout

| File                   | Role                                                    |
| ---------------------- | ------------------------------------------------------- |
| `index.html`           | App shell                                               |
| `styles.css`           | Theme and layout                                        |
| `app.js`               | State, rendering, import/export                         |
| `bookmarklet.js`       | Scraper injected into the uni site                      |
| `sw.js`                | Service worker — offline shell, never caches task data  |
| `manifest.webmanifest` | PWA metadata; `icons/` holds the app icons              |
| `server.js`            | Zero-dependency server and JSON persistence             |
| `Dockerfile`           | Container image (non-root, healthchecked)               |
| `docker-compose.yml`   | One-command run with a named data volume                |
| `start.command`        | macOS double-click launcher                             |

## License

MIT
