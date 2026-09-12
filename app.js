/* Academelp — course tracker, organised by study path.
   One flat list of items. Every item belongs to a course, every course to a
   path, and each item has a kind: assignment, lesson or test.

   Paths are self-contained: inside one you only ever see its own courses and
   deadlines. The dashboard is the single place where everything mixes. */
(function () {
  'use strict';

  const STORE_KEY = 'academelp.tasks.v1';
  const VIEW_KEY = 'academelp.view.v1';
  const API = /^https?:$/.test(location.protocol) ? '/api/tasks' : null;
  const $ = (sel) => document.querySelector(sel);

  /** @type {{id:string,title:string,course:string,path?:string,due:string,url:string,submitted:boolean,added:number,kind:string,grade?:string}[]} */
  let tasks = loadLocal();

  const KINDS = ['task', 'lesson', 'exam'];
  const WORDS = {
    task: { one: 'assignment', many: 'assignments', verb: 'submitted' },
    lesson: { one: 'lesson', many: 'lessons', verb: 'learned' },
    exam: { one: 'test', many: 'tests', verb: 'taken' },
  };
  // Tests are events you sit, not boxes you tick, so they sit outside the
  // completion percentage and are reported on their own.
  const COUNTS_TOWARD_PCT = ['task', 'lesson'];

  const DEFAULT_PATH = 'General';
  const kindOf = (t) => (KINDS.includes(t.kind) ? t.kind : 'task');
  const pathOf = (t) => (t.path || '').trim() || DEFAULT_PATH;

  // ---------- navigation state ----------

  let view = 'home';   // 'home' | 'path' | 'course'
  let scope = null;    // path name when browsing inside a path
  let course = null;
  let kind = 'task';
  let filter = 'pending';   // what's left is the usual question
  let editingId = null;

  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY)) || {};
    if (['home', 'path', 'course'].includes(saved.view)) view = saved.view;
    if (saved.scope) scope = saved.scope;
    if (saved.course) course = saved.course;
    if (KINDS.includes(saved.kind)) kind = saved.kind;
  } catch { /* first run */ }

  function saveView() {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ view, scope, course, kind }));
  }

  // Which dashboard cards are folded shut, by course name.
  const COLLAPSED_KEY = 'academelp.collapsed.v1';
  let collapsed;
  try { collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || []); }
  catch { collapsed = new Set(); }
  function saveCollapsed() { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); }

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

  // Only worth saying when it isn't the happy path — the masthead has a menu
  // to hold now.
  async function initStorage() {
    const note = $('#storage-note');
    const warn = (msg) => { note.textContent = '· ' + msg; note.hidden = false; };
    if (!API) return warn('saved in this browser only');
    try {
      const server = await (await fetch(API)).json();
      if (Array.isArray(server) && server.length) tasks = server;
      note.hidden = true;
      save();
      render();
    } catch {
      warn('server unreachable, saved in browser');
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
    if (n < 60) return `in ${Math.round(n / 7)} weeks`;
    return `in ${Math.round(n / 30)} months`;
  }

  // ---------- typed-by-hand parsing ----------

  const TYPE_WORDS = {
    assignment: 'task', assignments: 'task', task: 'task', hw: 'task', homework: 'task',
    'מטלה': 'task', 'מטלות': 'task',
    lesson: 'lesson', lessons: 'lesson', lecture: 'lesson', unit: 'lesson',
    'שיעור': 'lesson', 'יחידה': 'lesson',
    test: 'exam', tests: 'exam', exam: 'exam', final: 'exam', midterm: 'exam',
    'בחינה': 'exam', 'מבחן': 'exam',
  };

  /** ISO as-is, or day-first (Israeli) 30/10/2026, 30.10.26, 30-10-2026. */
  function parseDate(s) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (!m) return null;
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    return `${y}-${mo}-${d}`;
  }

  /** Lines of "Title | anything else, in any order", with #directives that
      change the defaults for the lines below them. */
  function parseLines(text, defaults) {
    const out = [];
    const ctx = { path: defaults.path, course: defaults.course, kind: defaults.kind };
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;

      const dir = line.match(/^[#@]\s*(path|course|type|kind)\s*[:=]?\s*(.+)$/i);
      if (dir) {
        const key = dir[1].toLowerCase();
        const val = dir[2].trim();
        if (key === 'path') ctx.path = val;
        else if (key === 'course') ctx.course = val;
        else ctx.kind = TYPE_WORDS[val.toLowerCase()] || ctx.kind;
        continue;
      }

      const item = {
        path: ctx.path, course: ctx.course, kind: ctx.kind,
        due: '', url: '', submitted: false, grade: '',
      };
      const free = [];
      const types = [];
      for (const part of line.split('|').map((p) => p.trim()).filter(Boolean)) {
        const lower = part.toLowerCase();
        const date = parseDate(part);
        if (date) { item.due = date; continue; }
        if (TYPE_WORDS[lower]) { types.push(part); continue; }
        if (/^https?:\/\//i.test(part)) { item.url = part; continue; }
        if (lower === 'done' || part === '✓' || part === 'v') { item.submitted = true; continue; }
        const grade = part.match(/^grade\s*[:=]\s*(.+)$/i);
        if (grade) { item.grade = grade[1].trim(); continue; }
        free.push(part);
      }
      // "Final | 2027-02-01" — a title that happens to be a type word is still
      // the title, so give the first one back when nothing else is left.
      if (!free.length && types.length) free.push(types.shift());
      if (types.length) item.kind = TYPE_WORDS[types[types.length - 1].toLowerCase()];
      if (!free.length) continue;

      // With a course already known every field is title; without one, the
      // first field names the course.
      if (ctx.course) item.title = free.join(' — ');
      else if (free.length >= 2) { item.course = free[0]; item.title = free.slice(1).join(' — '); }
      else { item.course = 'Imported'; item.title = free[0]; }

      if (item.title) out.push(item);
    }
    return out;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- derived data ----------

  const byName = (a, b) => a.localeCompare(b);
  function pathNames() { return [...new Set(tasks.map(pathOf))].sort(byName); }
  function coursesOf(items) { return [...new Set(items.map((t) => t.course))].sort(byName); }
  function itemsInPath(p) { return tasks.filter((t) => pathOf(t) === p); }
  function itemsInCourse(name) { return tasks.filter((t) => t.course === name); }
  /** A course lives in one path — whichever its items say. */
  function pathOfCourse(name) {
    const first = itemsInCourse(name)[0];
    return first ? pathOf(first) : DEFAULT_PATH;
  }

  /** Roll a set of items up into the numbers every tile and headline needs. */
  function rollup(items) {
    const by = {};
    for (const k of KINDS) {
      const of = items.filter((t) => kindOf(t) === k);
      by[k] = { total: of.length, done: of.filter((t) => t.submitted).length, items: of };
    }
    const completable = COUNTS_TOWARD_PCT.reduce((n, k) => n + by[k].total, 0);
    const completed = COUNTS_TOWARD_PCT.reduce((n, k) => n + by[k].done, 0);
    // Everything still owed, oldest first — overdue work is the most owed of
    // all, so it heads the list rather than dropping out of sight.
    const dated = items
      .filter((t) => !t.submitted && t.due)
      .sort((a, b) => (a.due < b.due ? -1 : 1));
    // "Next" on a tile should still look forward, not at a missed date.
    const future = dated.filter((t) => t.due >= todayISO());
    return {
      by,
      total: items.length,
      completable,
      completed,
      pct: completable ? Math.round((completed / completable) * 100) : null,
      overdue: items.filter(isOverdue).length,
      next: future[0] || null,
      nextExam: future.find((t) => kindOf(t) === 'exam') || null,
      upcoming: dated,
    };
  }

  // ---------- rendering ----------

  function render() {
    // A scope that no longer exists falls back for this paint only — the first
    // render can run before the server's data has arrived.
    let showing = view;
    if (showing === 'course' && !tasks.some((t) => t.course === course)) showing = scope ? 'path' : 'home';
    if (showing === 'path' && !tasks.some((t) => pathOf(t) === scope)) showing = 'home';

    $('#course-list').innerHTML = coursesOf(tasks).map((c) => `<option value="${escapeHTML(c)}">`).join('');
    $('#path-list').innerHTML = pathNames().map((p) => `<option value="${escapeHTML(p)}">`).join('');

    $('#view-browse').hidden = !(showing === 'home' || showing === 'path');
    $('#view-course').hidden = showing !== 'course';
    // Only a course needs a breadcrumb; a path announces itself in the menu.
    $('#crumb').hidden = showing !== 'course';
    $('.hero-card').hidden = tasks.length === 0;

    renderMenu(showing);

    if (showing === 'home') renderBrowse(tasks, null);
    else if (showing === 'path') renderBrowse(itemsInPath(scope), scope);
    else renderCourse();
  }

  /** Paths live in the masthead — there are only ever a handful. The menu
      stays out of the way until there's more than the default path. */
  function renderMenu(showing) {
    const names = pathNames();
    const menu = $('#toplevel');
    if (names.length <= 1 && (!names.length || names[0] === DEFAULT_PATH)) {
      menu.hidden = true;
      menu.innerHTML = '';
      return;
    }
    // No "Dashboard" entry — the wordmark is that button.
    const here = showing === 'home' ? null : (showing === 'path' ? scope : (scope || pathOfCourse(course)));
    menu.hidden = false;
    menu.innerHTML = names.map((p) =>
      `<button class="tab ${p === here ? 'is-active' : ''}" data-path="${escapeHTML(p)}" dir="auto">${escapeHTML(p)}</button>`
    ).join('');
    $('#btn-home').classList.toggle('is-current', here === null);
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

  /** The dashboard and a single path render identically — only the scope differs. */
  function renderBrowse(items, pathName) {
    const s = rollup(items);
    const names = coursesOf(items);

    setHero(
      s.pct,
      `${s.completed} of ${s.completable} done · ${names.length} ${names.length === 1 ? 'course' : 'courses'}`,
      s.overdue
    );

    $('#courses-label').hidden = names.length === 0;
    $('#course-grid').innerHTML = names.map((n) => courseCard(n, rollup(itemsInCourse(n)))).join('');
    $('#empty-browse').hidden = names.length > 0;
    $('#empty-browse-text').textContent = pathName
      ? `Nothing in ${pathName} yet.`
      : 'Nothing here yet.';
  }

  const SHOWN_PER_COURSE = 6;

  /** A course on the dashboard: its progress, then the work still outstanding
      listed right there — no need to open the course to see what's left. */
  function courseCard(name, s) {
    const pct = s.pct === null ? 0 : s.pct;
    const bits = [];
    for (const k of KINDS) {
      if (!s.by[k].total) continue;
      bits.push(k === 'exam'
        ? `${s.by[k].total} ${s.by[k].total === 1 ? 'test' : 'tests'}`
        : `${s.by[k].done}/${s.by[k].total} ${WORDS[k].many}`);
    }

    // Dated work first, in date order; undated trails it.
    const pending = KINDS
      .flatMap((k) => s.by[k].items)
      .filter((t) => !t.submitted)
      .sort((a, b) => ((a.due || '9999') < (b.due || '9999') ? -1 : 1));
    const shown = pending.slice(0, SHOWN_PER_COURSE);
    const rest = pending.length - shown.length;

    const folded = collapsed.has(name);
    const body = pending.length
      ? shown.map((t) => itemRow(t, true)).join('')
      : '<p class="card-empty">Nothing left here.</p>';

    return `
      <section class="course-card ${folded ? 'is-collapsed' : ''}">
        <button class="course-head" data-fold="${escapeHTML(name)}" aria-expanded="${!folded}">
          <span class="tile-name" dir="auto">${escapeHTML(name)}</span>
          <span class="tile-counts">${escapeHTML(bits.join(' · '))}</span>
          <span class="tile-pct">${s.pct === null ? '—' : pct + '%'}</span>
        </button>
        <span class="meter">
          <span class="meter-fill ${pct === 100 ? 'is-full' : ''}" style="width:${pct}%"></span>
        </span>
        <div class="card-body">
          ${body}
          <button class="card-more" data-course="${escapeHTML(name)}">${
            rest ? `+ ${rest} more` : 'Open course'}</button>
        </div>
      </section>`;
  }

  function renderCourse() {
    const s = rollup(itemsInCourse(course));
    const p = pathOfCourse(course);

    // A course shows only the kinds it actually has — a course without tests
    // has no business showing an empty Tests tab. New kinds arrive through the
    // Add dialog's type picker, and their tab appears with the first item.
    const present = KINDS.filter((k) => s.by[k].total);
    if (present.length && !present.includes(kind)) { kind = present[0]; saveView(); }
    const w = WORDS[kind];

    $('#crumb-title').textContent = course;
    // Prefixed, so it doesn't read as a duplicate of the back link above it.
    const chip = $('#course-path');
    chip.hidden = false;
    chip.textContent = 'Path: ' + p;
    chip.title = 'Move this course to another path';

    setHero(s.pct, `${s.completed} of ${s.completable} done`, s.overdue);

    document.querySelectorAll('#kind-tabs .tab').forEach((tab) => {
      const k = tab.dataset.kind;
      tab.hidden = !s.by[k].total;
      tab.classList.toggle('is-active', k === kind);
      tab.querySelector('.tab-n')?.remove();
      if (s.by[k].total) tab.insertAdjacentHTML('beforeend', ` <span class="tab-n">${s.by[k].total}</span>`);
    });

    const all = s.by[kind].items;
    $('#kind-summary').textContent = all.length
      ? `${s.by[kind].done} of ${all.length} ${all.length === 1 ? w.one : w.many} ${w.verb}`
      : '';

    const visible = all
      .filter((t) => (filter === 'pending' ? !t.submitted : true))
      .sort((a, b) => ((a.due || '9999') < (b.due || '9999') ? -1 : 1));

    $('#items').innerHTML = visible.map(itemRow).join('');
    const empty = $('#empty-course');
    empty.hidden = visible.length > 0;
    empty.textContent = all.length ? `No ${w.many} match this filter.` : `No ${w.many} in this course yet.`;
    $('#btn-add').textContent = '+ Add ' + w.one;
  }

  /** `withKind` labels the row's type — needed on the dashboard, where kinds
      are mixed, but not in a course tab that already names them. */
  function itemRow(t, withKind) {
    const k = kindOf(t);
    const title = t.url
      ? `<a href="${escapeHTML(t.url)}" target="_blank" rel="noopener">${escapeHTML(t.title)}</a>`
      : escapeHTML(t.title);
    const soon = k === 'exam' && !t.submitted && t.due ? countdown(t.due) : '';
    return `
      <div class="task ${t.submitted ? 'is-done' : ''} ${isDueSoon(t) ? 'is-due-soon' : ''}" data-id="${t.id}">
        <input type="checkbox" ${t.submitted ? 'checked' : ''} data-act="toggle" aria-label="Mark ${WORDS[k].verb}">
        <span class="task-title" dir="auto">${title}</span>
        ${withKind && k !== 'task' ? `<span class="pill${k === 'exam' ? '' : ' is-quiet'}">${WORDS[k].one}</span>` : ''}
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

  function go(next) {
    if (next.view !== undefined) view = next.view;
    if (next.scope !== undefined) scope = next.scope;
    if (next.course !== undefined) course = next.course;
    if (next.kind !== undefined && KINDS.includes(next.kind)) kind = next.kind;
    filter = 'pending';
    syncChips();
    saveView();
    render();
    scrollTo({ top: 0 });
  }
  function syncChips() {
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c.dataset.filter === filter));
  }

  $('#btn-home').addEventListener('click', () => go({ view: 'home', scope: null }));
  $('#toplevel').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) go({ view: 'path', scope: tab.dataset.path });
  });

  // Opening a course from inside a path keeps you in that path.
  $('#course-grid').addEventListener('click', (e) => {
    // Ticking a row off must not also fold the card behind it.
    if (itemAction(e)) return;
    const fold = e.target.closest('[data-fold]');
    if (fold) {
      const name = fold.dataset.fold;
      if (collapsed.has(name)) collapsed.delete(name);
      else collapsed.add(name);
      saveCollapsed();
      render();
      return;
    }
    const t = e.target.closest('[data-course]');
    if (t) go({ view: 'course', course: t.dataset.course });
  });
  document.querySelectorAll('#kind-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => go({ kind: tab.dataset.kind }));
  });
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => { filter = chip.dataset.filter; syncChips(); render(); });
  });

  // ---------- item CRUD ----------

  /** Row actions work the same wherever a row is shown. */
  function itemAction(e) {
    const act = e.target.dataset.act;
    if (!act) return false;
    const id = e.target.closest('.task').dataset.id;
    const t = tasks.find((x) => x.id === id);
    if (act === 'toggle') { t.submitted = e.target.checked; save(); render(); }
    if (act === 'del' && confirm(`Delete "${t.title}"?`)) {
      tasks = tasks.filter((x) => x.id !== id); save(); render();
    }
    if (act === 'edit') openTaskDialog(t);
    return true;
  }
  $('#items').addEventListener('click', itemAction);

  const dlgTask = $('#dlg-task');
  function openTaskDialog(t) {
    editingId = t ? t.id : null;
    const k = t ? kindOf(t) : kind;
    const f = $('#form-task');
    f.title.value = t ? t.title : '';
    f.kind.value = k;
    f.course.value = t ? t.course : (course || '');
    f.path.value = t ? pathOf(t) : (course ? pathOfCourse(course) : (scope || ''));
    f.due.value = t ? t.due : '';
    f.url.value = t ? t.url : '';
    f.grade.value = t && t.grade ? t.grade : '';
    syncKindFields();
    $('#dlg-task-title').textContent = (t ? 'Edit ' : 'Add ') + WORDS[k].one;
    dlgTask.showModal();
  }
  // A test takes a date and a grade; everything else takes a due date.
  function syncKindFields() {
    const k = $('#form-task').kind.value;
    $('#lbl-due').firstChild.textContent = k === 'exam' ? 'Date ' : 'Due date ';
    $('#lbl-grade').hidden = k !== 'exam';
  }
  $('#form-task').kind.addEventListener('change', syncKindFields);

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
      title,
      course: courseName,
      path: f.path.value.trim() || DEFAULT_PATH,
      kind: KINDS.includes(f.kind.value) ? f.kind.value : 'task',
      due: f.due.value,
      url: f.url.value.trim(),
      grade: f.grade.value.trim(),
    };
    if (editingId) {
      Object.assign(tasks.find((x) => x.id === editingId), fields);
    } else {
      tasks.push({ id: uid(), ...fields, submitted: false, added: Date.now() });
    }
    kind = fields.kind;
    course = courseName;
    if (view !== 'course') view = 'course';
    saveView();
    save(); render();
  });

  // ---------- moving a course between paths ----------

  const dlgPath = $('#dlg-path');
  $('#course-path').addEventListener('click', () => {
    $('#form-path').path.value = pathOfCourse(course);
    dlgPath.showModal();
  });
  $('#btn-cancel-path').addEventListener('click', () => dlgPath.close());
  $('#form-path').addEventListener('submit', (e) => {
    const p = e.target.path.value.trim() || DEFAULT_PATH;
    for (const t of itemsInCourse(course)) t.path = p;
    // Following the course keeps the breadcrumb honest.
    if (scope) scope = p;
    saveView();
    save(); render();
  });

  // ---------- import / export ----------

  const dlgImport = $('#dlg-import');
  $('#btn-import').addEventListener('click', () => {
    $('#import-text').value = '';
    setImportResult('', '');
    // Start from wherever you are, but everything stays editable.
    $('#imp-path').value = scope || (course ? pathOfCourse(course) : '');
    $('#imp-course').value = course || '';
    $('#imp-kind').value = kind;
    dlgImport.showModal();
  });
  $('#btn-cancel-import').addEventListener('click', () => dlgImport.close());

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
    if (!text) { setImportResult('Nothing to import — paste or type the items first.', 'err'); return; }
    const target = {
      path: $('#imp-path').value.trim(),
      course: $('#imp-course').value.trim(),
      kind: KINDS.includes($('#imp-kind').value) ? $('#imp-kind').value : 'task',
    };
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
          path: t.path ? String(t.path).trim() : '',
          due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '',
          url: String(t.url || ''),
          submitted: !!t.submitted,
          grade: t.grade ? String(t.grade) : '',
          kind: KINDS.includes(t.kind) ? t.kind : 'task',
        }));
    } catch (e) {
      if (/<\s*(!doctype|html|body|table|tr|div|ul|main)\b/i.test(text)) {
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
    if (!incoming) incoming = parseLines(text, target);
    if (!incoming.length) {
      setImportResult('Nothing recognizable in there — check the line format below.', 'err');
      return;
    }

    // A course that already exists keeps the path it has; anything new lands
    // in the path named above.
    const fallbackPath = target.path || DEFAULT_PATH;
    for (const inc of incoming) {
      if (!inc.path) {
        inc.path = tasks.some((t) => t.course === inc.course) ? pathOfCourse(inc.course) : fallbackPath;
      }
    }

    const keyOf = (t) => (kindOf(t) + '::' + t.course + '::' + t.title).toLowerCase();
    const existing = new Map(tasks.map((t) => [keyOf(t), t]));
    let added = 0, updated = 0;
    for (const inc of incoming) {
      const match = existing.get(keyOf(inc));
      if (match) {
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

    const courses = new Set(incoming.map((t) => t.course));
    const kinds = new Set(incoming.map(kindOf));
    if (courses.size === 1) {
      course = [...courses][0];
      view = 'course';
      if (kinds.size === 1) kind = [...kinds][0];
      filter = 'pending';
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
    view = 'home'; scope = null; course = null;
    saveView();
    save(); render();
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
