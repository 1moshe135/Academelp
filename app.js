/* Academelp — course-oriented tracker.
   One flat list of items; every item belongs to a course and has a kind:
   'task' (assignment), 'lesson', or 'exam' (test). The dashboard summarises
   the courses, and each course opens onto its own three tabs. */
(function () {
  'use strict';

  const STORE_KEY = 'academelp.tasks.v1';
  const VIEW_KEY = 'academelp.view.v1';
  const API = /^https?:$/.test(location.protocol) ? '/api/tasks' : null;
  const $ = (sel) => document.querySelector(sel);

  /** @type {{id:string,title:string,course:string,due:string,url:string,submitted:boolean,added:number,kind:string,grade?:string}[]} */
  let tasks = loadLocal();

  const KINDS = ['task', 'lesson', 'exam'];
  const WORDS = {
    task: { one: 'assignment', many: 'assignments', verb: 'submitted', short: 'assignments' },
    lesson: { one: 'lesson', many: 'lessons', verb: 'learned', short: 'lessons' },
    exam: { one: 'test', many: 'tests', verb: 'taken', short: 'tests' },
  };
  const kindOf = (t) => (KINDS.includes(t.kind) ? t.kind : 'task');

  // ---------- navigation state ----------

  let view = 'home';       // 'home' | 'course'
  let course = null;       // course name when view === 'course'
  let kind = 'task';       // active tab inside a course
  let filter = 'all';
  let editingId = null;

  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY)) || {};
    if (saved.course) { view = 'course'; course = saved.course; }
    if (KINDS.includes(saved.kind)) kind = saved.kind;
  } catch { /* first run */ }

  function saveView() {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ course: view === 'course' ? course : null, kind }));
  }

  // ---------- storage ----------

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  }
  function save() {
    const json = JSON.stringify(tasks);
    localStorage.setItem(STORE_KEY, json);
    if (API) fetch(API, { method: 'PUT', body: json }).catch(() => {});
  }

  // When served by server.js, data.json on disk is the source of truth;
  // localStorage is kept as a cache and migrated up on first run.
  async function initStorage() {
    if (!API) {
      $('#storage-note').textContent = '· saved in this browser only';
      $('#storage-note').hidden = false;
      return;
    }
    try {
      const server = await (await fetch(API)).json();
      if (Array.isArray(server) && server.length) tasks = server;
      $('#storage-note').textContent = '· saved to data.json';
      $('#storage-note').hidden = false;
      save();
      render();
    } catch {
      $('#storage-note').textContent = '· server unreachable, saved in browser';
      $('#storage-note').hidden = false;
    }
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- dates ----------

  function toISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayISO() { return toISO(new Date()); }
  function isOverdue(t) { return !t.submitted && t.due && t.due < todayISO(); }
  function isDueSoon(t) {
    if (t.submitted || !t.due) return false;
    const limit = new Date();
    limit.setDate(limit.getDate() + 7);
    return t.due >= todayISO() && t.due <= toISO(limit);
  }
  function daysUntil(due) {
    const [y, m, d] = due.split('-').map(Number);
    const then = new Date(y, m - 1, d);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((then - now) / 86400000);
  }
  function fmtDue(due) {
    if (!due) return '';
    const [y, m, d] = due.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, {
      day: 'numeric', month: 'short',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  }
  // Kept short and in words, so it reads well inside a pill.
  function countdown(due) {
    const n = daysUntil(due);
    if (n < 0) return '';
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n < 14) return `in ${n} days`;
    if (n < 60) {
      const w = Math.round(n / 7);
      return `in ${w} weeks`;
    }
    const m = Math.round(n / 30);
    return `in ${m} months`;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- derived data ----------

  function courseNames() {
    return [...new Set(tasks.map((t) => t.course))].sort((a, b) => a.localeCompare(b));
  }

  /** Per-course roll-up. Completion covers assignments + lessons; tests are
      events rather than things you tick off, so they're reported separately. */
  function statsFor(name) {
    const mine = tasks.filter((t) => t.course === name);
    const by = {};
    for (const k of KINDS) {
      const items = mine.filter((t) => kindOf(t) === k);
      by[k] = { total: items.length, done: items.filter((t) => t.submitted).length, items };
    }
    const completable = by.task.total + by.lesson.total;
    const completed = by.task.done + by.lesson.done;
    const upcoming = mine
      .filter((t) => !t.submitted && t.due && t.due >= todayISO())
      .sort((a, b) => (a.due < b.due ? -1 : 1));
    const nextExam = by.exam.items
      .filter((t) => !t.submitted && t.due && t.due >= todayISO())
      .sort((a, b) => (a.due < b.due ? -1 : 1))[0];
    return {
      by,
      total: mine.length,
      completable,
      completed,
      pct: completable ? Math.round((completed / completable) * 100) : null,
      overdue: mine.filter(isOverdue).length,
      next: upcoming[0] || null,
      nextExam: nextExam || null,
    };
  }

  // ---------- rendering ----------

  function render() {
    // Fall back to the dashboard when the course isn't there — but only for
    // this paint. The first render can run before the server's data has
    // arrived, and clobbering `view` would strand us on the dashboard.
    const showing = view === 'course' && tasks.some((t) => t.course === course) ? 'course' : 'home';

    $('#course-list').innerHTML = courseNames().map((c) => `<option value="${escapeHTML(c)}">`).join('');
    $('#view-home').hidden = showing !== 'home';
    $('#view-course').hidden = showing !== 'course';
    $('#crumb').hidden = showing !== 'course';

    if (showing === 'home') renderHome();
    else renderCourse();
  }

  function setHero(pct, caption, overdue) {
    const shown = pct === null ? 0 : pct;
    $('#hero-pct').textContent = shown;
    $('#hero-count').textContent = caption;
    $('#stat-overdue').textContent = overdue;
    $('#stat-overdue-wrap').hidden = overdue === 0;
    const fill = $('#hero-fill');
    fill.style.width = shown + '%';
    fill.classList.toggle('is-full', shown === 100);
    $('#hero-meter').setAttribute('aria-valuenow', shown);
  }

  function renderHome() {
    const names = courseNames();
    // An empty meter above an empty page says nothing worth the space.
    $('.hero-card').hidden = tasks.length === 0;
    const completable = tasks.filter((t) => kindOf(t) !== 'exam');
    const done = completable.filter((t) => t.submitted).length;
    const pct = completable.length ? Math.round((done / completable.length) * 100) : 0;

    setHero(
      pct,
      `${done} of ${completable.length} done · ${names.length} ${names.length === 1 ? 'course' : 'courses'}`,
      tasks.filter(isOverdue).length
    );

    // Coming up: the next unfinished dated items across every course.
    const soon = tasks
      .filter((t) => !t.submitted && t.due && t.due >= todayISO())
      .sort((a, b) => (a.due < b.due ? -1 : 1))
      .slice(0, 5);
    $('#upcoming').hidden = soon.length === 0;
    $('#upcoming-list').innerHTML = soon.map((t) => {
      const k = kindOf(t);
      return `
      <button class="up-row" data-course="${escapeHTML(t.course)}" data-kind="${k}"
              aria-label="${escapeHTML(WORDS[k].one + ': ' + t.title + ' — ' + t.course)}">
        <span class="up-dot up-dot-${k}" aria-hidden="true"></span>
        <span class="up-main">
          <span class="up-title" dir="auto">${escapeHTML(t.title)}</span>
          ${k === 'exam' ? '<span class="pill">Test</span>' : ''}
        </span>
        <span class="up-course" dir="auto">${escapeHTML(t.course)}</span>
        <span class="up-when">${escapeHTML(fmtDue(t.due))}<small>${escapeHTML(countdown(t.due))}</small></span>
      </button>`;
    }).join('');

    $('#courses-label').hidden = names.length === 0;
    $('#course-grid').innerHTML = names.map(courseTile).join('');
    $('#empty-home').hidden = names.length > 0;
  }

  function courseTile(name) {
    const s = statsFor(name);
    const pct = s.pct === null ? 0 : s.pct;
    const bits = [];
    if (s.by.task.total) bits.push(`${s.by.task.done}/${s.by.task.total} assignments`);
    if (s.by.lesson.total) bits.push(`${s.by.lesson.done}/${s.by.lesson.total} lessons`);
    if (s.by.exam.total) bits.push(`${s.by.exam.total} ${s.by.exam.total === 1 ? 'test' : 'tests'}`);

    const flags = [];
    if (s.overdue) flags.push(`<span class="tile-flag is-bad">⚠ ${s.overdue} overdue</span>`);
    if (s.nextExam) {
      const when = countdown(s.nextExam.due) || fmtDue(s.nextExam.due);
      flags.push(`<span class="tile-flag is-exam">Test ${escapeHTML(when)}</span>`);
    } else if (s.next) {
      const when = countdown(s.next.due) || fmtDue(s.next.due);
      flags.push(`<span class="tile-flag">Next ${escapeHTML(when)}</span>`);
    }

    return `
      <button class="course-tile" data-course="${escapeHTML(name)}">
        <span class="tile-name" dir="auto">${escapeHTML(name)}</span>
        <span class="tile-meter">
          <span class="meter">
            <span class="meter-fill ${pct === 100 ? 'is-full' : ''}" style="width:${pct}%"></span>
          </span>
          <span class="tile-pct">${s.pct === null ? '—' : pct + '%'}</span>
        </span>
        <span class="tile-counts">${escapeHTML(bits.join(' · '))}</span>
        <span class="tile-flags">${flags.join('')}</span>
      </button>`;
  }

  function renderCourse() {
    const s = statsFor(course);
    const w = WORDS[kind];
    $('.hero-card').hidden = false;

    $('#course-title').textContent = course;
    setHero(s.pct, `${s.completed} of ${s.completable} done`, s.overdue);

    document.querySelectorAll('#kind-tabs .tab').forEach((tab) => {
      const k = tab.dataset.kind;
      tab.classList.toggle('is-active', k === kind);
      const n = s.by[k].total;
      tab.querySelector('.tab-n')?.remove();
      if (n) tab.insertAdjacentHTML('beforeend', ` <span class="tab-n">${n}</span>`);
    });

    const all = s.by[kind].items;
    $('#kind-summary').textContent = all.length
      ? `${s.by[kind].done} of ${all.length} ${all.length === 1 ? w.one : w.many} ${w.verb}`
      : '';

    const visible = all.filter((t) => {
      if (filter === 'pending') return !t.submitted;
      if (filter === 'submitted') return t.submitted;
      if (filter === 'overdue') return isOverdue(t);
      return true;
    }).sort((a, b) => ((a.due || '9999') < (b.due || '9999') ? -1 : 1));

    $('#items').innerHTML = visible.map(itemRow).join('');
    const empty = $('#empty-course');
    empty.hidden = visible.length > 0;
    empty.textContent = all.length
      ? `No ${w.many} match this filter.`
      : `No ${w.many} in this course yet.`;
    $('#btn-add').textContent = '+ Add ' + w.one;
  }

  function itemRow(t) {
    const k = kindOf(t);
    const title = t.url
      ? `<a href="${escapeHTML(t.url)}" target="_blank" rel="noopener">${escapeHTML(t.title)}</a>`
      : escapeHTML(t.title);
    const soon = k === 'exam' && !t.submitted && t.due ? countdown(t.due) : '';
    return `
      <div class="task ${t.submitted ? 'is-done' : ''} ${isDueSoon(t) ? 'is-due-soon' : ''}" data-id="${t.id}">
        <input type="checkbox" ${t.submitted ? 'checked' : ''} data-act="toggle"
               aria-label="Mark ${WORDS[k].verb}">
        <span class="task-title" dir="auto">${title}</span>
        ${t.grade ? `<span class="grade">${escapeHTML(t.grade)}</span>` : ''}
        ${isOverdue(t) ? '<span class="badge-overdue">⚠ Overdue</span>' : ''}
        <span class="task-due">${escapeHTML(fmtDue(t.due))}${soon ? `<small>${escapeHTML(soon)}</small>` : ''}</span>
        <span class="task-actions">
          <button class="icon-btn" data-act="edit" title="Edit">✎</button>
          <button class="icon-btn" data-act="del" title="Delete">✕</button>
        </span>
      </div>`;
  }

  // ---------- navigation ----------

  function openCourse(name, k) {
    view = 'course';
    course = name;
    if (KINDS.includes(k)) kind = k;
    filter = 'all';
    syncChips();
    saveView();
    render();
    scrollTo({ top: 0 });
  }
  function goHome() {
    view = 'home';
    saveView();
    render();
    scrollTo({ top: 0 });
  }
  function syncChips() {
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c.dataset.filter === filter));
  }

  $('#btn-home').addEventListener('click', goHome);
  $('#btn-back').addEventListener('click', goHome);

  $('#course-grid').addEventListener('click', (e) => {
    const tile = e.target.closest('.course-tile');
    if (tile) openCourse(tile.dataset.course);
  });
  $('#upcoming-list').addEventListener('click', (e) => {
    const row = e.target.closest('.up-row');
    if (row) openCourse(row.dataset.course, row.dataset.kind);
  });

  document.querySelectorAll('#kind-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      kind = tab.dataset.kind;
      filter = 'all';
      syncChips();
      saveView();
      render();
    });
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      filter = chip.dataset.filter;
      syncChips();
      render();
    });
  });

  // ---------- item CRUD ----------

  $('#items').addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    const id = e.target.closest('.task').dataset.id;
    const t = tasks.find((x) => x.id === id);
    if (act === 'toggle') { t.submitted = e.target.checked; save(); render(); }
    if (act === 'del' && confirm(`Delete "${t.title}"?`)) {
      tasks = tasks.filter((x) => x.id !== id); save(); render();
    }
    if (act === 'edit') openTaskDialog(t);
  });

  const dlgTask = $('#dlg-task');
  function openTaskDialog(t) {
    editingId = t ? t.id : null;
    const k = t ? kindOf(t) : kind;
    const w = WORDS[k];
    $('#dlg-task-title').textContent = (t ? 'Edit ' : 'Add ') + w.one;
    $('#lbl-due').firstChild.textContent = k === 'exam' ? 'Date ' : 'Due date ';
    $('#lbl-grade').hidden = k !== 'exam';
    const f = $('#form-task');
    f.title.value = t ? t.title : '';
    f.course.value = t ? t.course : (course || '');
    f.due.value = t ? t.due : '';
    f.url.value = t ? t.url : '';
    f.grade.value = t && t.grade ? t.grade : '';
    dlgTask.showModal();
  }
  $('#btn-add').addEventListener('click', () => openTaskDialog(null));
  $('#btn-empty-add').addEventListener('click', () => openTaskDialog(null));
  $('#btn-empty-import').addEventListener('click', () => $('#btn-import').click());
  $('#btn-cancel-task').addEventListener('click', () => dlgTask.close());

  $('#form-task').addEventListener('submit', (e) => {
    const f = e.target;
    const title = f.title.value.trim();
    const courseName = f.course.value.trim();
    if (!title || !courseName) return;
    const fields = {
      title, course: courseName,
      due: f.due.value,
      url: f.url.value.trim(),
      grade: f.grade.value.trim(),
    };
    if (editingId) {
      Object.assign(tasks.find((x) => x.id === editingId), fields);
    } else {
      tasks.push({ id: uid(), ...fields, submitted: false, added: Date.now(), kind });
      // Adding into a brand-new course should land you in it.
      if (view === 'home') { view = 'course'; course = courseName; saveView(); }
    }
    save(); render();
  });

  // ---------- import / export ----------

  const dlgImport = $('#dlg-import');
  $('#btn-import').addEventListener('click', () => {
    $('#import-text').value = '';
    setImportResult('', '');
    dlgImport.showModal();
  });
  $('#btn-cancel-import').addEventListener('click', () => dlgImport.close());

  // Build the bookmarklet link from the scraper functions in bookmarklet.js
  $('#bookmarklet-link').href = 'javascript:' + encodeURIComponent(
    '(function(){\n' + academelpExtract.toString() + '\n(' + academelpGrab.toString() + ')();\n})()'
  );
  $('#bookmarklet-link').addEventListener('click', (e) => e.preventDefault());

  function setImportResult(msg, cls) {
    const el = $('#import-result');
    el.textContent = msg;
    el.className = 'import-result ' + cls;
  }

  $('#btn-do-import').addEventListener('click', () => {
    const text = $('#import-text').value.trim();
    if (!text) { setImportResult('Nothing to import — paste the copied tasks first.', 'err'); return; }
    let incoming = [];
    try {
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : data.tasks;
      if (!Array.isArray(arr)) throw new Error('no tasks array');
      incoming = arr
        .filter((t) => t && t.title)
        .map((t) => ({
          title: String(t.title).trim(),
          course: String(t.course || 'Imported').trim(),
          due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '',
          url: String(t.url || ''),
          submitted: !!t.submitted,
          grade: t.grade ? String(t.grade) : '',
          kind: KINDS.includes(t.kind) ? t.kind : 'task',
        }));
    } catch (e) {
      if (/<\s*(!doctype|html|body|table|tr|div|ul|main)\b/i.test(text)) {
        // raw HTML pasted (page source of the uni site) — run the same
        // extractor the bookmarklet uses on a parsed copy of the page
        const doc = new DOMParser().parseFromString(text, 'text/html');
        let base = 'https://opal.openu.ac.il/';
        const ww = text.match(/"wwwroot":\s*"(https?:[^"]+)"/); // Moodle M.cfg
        if (ww) base = ww[1].replace(/\\\//g, '/') + '/';
        else {
          const abs = text.match(/https?:\/\/[^\/"'\s\\]+/);
          if (abs) base = abs[0] + '/';
        }
        incoming = academelpExtract(doc, base).tasks;
        if (!incoming.length) {
          setImportResult('That HTML has no assignment rows I can recognize — paste the source of the מטלות הקורס page.', 'err');
          return;
        }
      } else {
        incoming = null;
      }
    }
    if (!incoming) {
      // fallback: one item per line, "Course | Title | YYYY-MM-DD"
      incoming = text.split('\n').map((line) => {
        const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
        if (!parts.length) return null;
        if (parts.length === 1) return { title: parts[0], course: course || 'Imported', due: '', url: '', submitted: false, kind };
        return {
          course: parts[0],
          title: parts[1],
          due: /^\d{4}-\d{2}-\d{2}$/.test(parts[2] || '') ? parts[2] : '',
          url: '',
          submitted: false,
          kind,
        };
      }).filter(Boolean);
    }

    const keyOf = (t) => (kindOf(t) + '::' + t.course + '::' + t.title).toLowerCase();
    const existing = new Map(tasks.map((t) => [keyOf(t), t]));
    let added = 0, updated = 0;
    for (const inc of incoming) {
      const match = existing.get(keyOf(inc));
      if (match) {
        // refresh due date / link / submitted status from the site, keep manual ticks
        let changed = false;
        if (inc.due && inc.due !== match.due) { match.due = inc.due; changed = true; }
        if (inc.url && inc.url !== match.url) { match.url = inc.url; changed = true; }
        if (inc.submitted && !match.submitted) { match.submitted = true; changed = true; }
        if (changed) updated++;
      } else {
        const t = { id: uid(), added: Date.now(), ...inc };
        tasks.push(t);
        existing.set(keyOf(t), t);
        added++;
      }
    }

    // Land on whatever was just imported: its course if it was all one course.
    const courses = new Set(incoming.map((t) => t.course));
    const kinds = new Set(incoming.map(kindOf));
    if (courses.size === 1) {
      course = [...courses][0];
      view = 'course';
      if (kinds.size === 1) kind = [...kinds][0];
      filter = 'all';
      syncChips();
      saveView();
    }

    save(); render();
    const w = WORDS[kinds.size === 1 ? [...kinds][0] : 'task'];
    setImportResult(
      `Imported ${added} new ${added === 1 ? w.one : w.many}` +
      `${updated ? `, updated ${updated}` : ''}` +
      `${added + updated === 0 ? ' — everything was already up to date' : ''}.`,
      'ok'
    );
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!tasks.length) return;
    if (!confirm(`Delete all ${tasks.length} items and start fresh? This cannot be undone.`)) return;
    tasks = [];
    view = 'home';
    saveView();
    save();
    render();
    dlgImport.close();
  });

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ academelp: 1, exported: new Date().toISOString(), tasks }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'academelp-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  syncChips();
  render();
  initStorage();
})();
