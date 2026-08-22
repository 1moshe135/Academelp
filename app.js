/* Academelp — standalone task tracker. Data lives in localStorage. */
(function () {
  'use strict';

  const STORE_KEY = 'academelp.tasks.v1';
  const API = /^https?:$/.test(location.protocol) ? '/api/tasks' : null;
  const $ = (sel) => document.querySelector(sel);

  /** @type {{id:string,title:string,course:string,due:string,url:string,submitted:boolean,added:number,kind:string}[]} */
  let tasks = loadLocal();
  let filter = 'all';
  const sortBy = 'due';
  let editingId = null;

  // Two screens over one dataset: kind 'task' (assignments) / 'lesson'
  const SCREEN_KEY = 'academelp.screen.v1';
  let screen = localStorage.getItem(SCREEN_KEY) === 'lesson' ? 'lesson' : 'task';
  const kindOf = (t) => (t.kind === 'lesson' ? 'lesson' : 'task');
  const WORDS = {
    task: { noun: 'task', nouns: 'tasks', verb: 'submitted' },
    lesson: { noun: 'lesson', nouns: 'lessons', verb: 'learned' },
  };

  const COLLAPSED_KEY = 'academelp.collapsed.v1';
  let collapsed;
  try { collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || []); }
  catch { collapsed = new Set(); }
  function saveCollapsed() { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); }

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
      $('#storage-note').textContent = ' · saved in this browser only';
      return;
    }
    try {
      const server = await (await fetch(API)).json();
      if (Array.isArray(server) && server.length) tasks = server;
      $('#storage-note').textContent = ' · saved to data.json';
      save();
      render();
    } catch {
      $('#storage-note').textContent = ' · server unreachable, saved in browser';
    }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

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

  function fmtDue(due) {
    if (!due) return '';
    const [y, m, d] = due.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- rendering ----------

  function render() {
    const items = tasks.filter((t) => kindOf(t) === screen);
    const words = WORDS[screen];
    const done = items.filter((t) => t.submitted).length;
    const overdue = items.filter(isOverdue).length;
    const total = items.length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    $('#hero-pct').textContent = pct;
    $('#hero-count').textContent = `${done} of ${total} ${total === 1 ? words.noun : words.nouns}`;
    $('#hero-verb').textContent = words.verb;
    $('#stat-overdue').textContent = overdue;
    $('#stat-overdue-wrap').hidden = overdue === 0;
    document.querySelectorAll('.screens .tab').forEach((tab) =>
      tab.classList.toggle('is-active', tab.dataset.screen === screen));
    const heroFill = $('#hero-fill');
    heroFill.style.width = pct + '%';
    heroFill.classList.toggle('is-full', pct === 100 && total > 0);
    $('#hero-meter').setAttribute('aria-valuenow', pct);

    // datalist of known courses for the edit form
    const courses = [...new Set(items.map((t) => t.course))].sort((a, b) => a.localeCompare(b));
    $('#course-list').innerHTML = courses.map((c) => `<option value="${escapeHTML(c)}">`).join('');

    const visible = items.filter((t) => {
      if (filter === 'pending') return !t.submitted;
      if (filter === 'submitted') return t.submitted;
      if (filter === 'overdue') return isOverdue(t);
      return true;
    });

    const cmp = {
      due: (a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1,
      course: (a, b) => a.course.localeCompare(b.course) || ((a.due || '9999') < (b.due || '9999') ? -1 : 1),
      added: (a, b) => b.added - a.added,
    }[sortBy];

    const byCourse = new Map();
    for (const c of courses) byCourse.set(c, []);
    for (const t of visible) byCourse.get(t.course).push(t);

    let html = '';
    for (const [course, courseVisible] of byCourse) {
      if (!courseVisible.length) continue;
      const all = items.filter((t) => t.course === course);
      const cDone = all.filter((t) => t.submitted).length;
      const cPct = Math.round((cDone / all.length) * 100);
      courseVisible.sort(cmp);
      html += `
        <section class="course-card ${collapsed.has(course) ? 'is-collapsed' : ''}">
          <div class="course-head">
            <h2 class="course-name" data-course="${escapeHTML(course)}" role="button" tabindex="0"
                aria-expanded="${!collapsed.has(course)}"><span class="chev" aria-hidden="true">▾</span>${escapeHTML(course)}</h2>
            <span class="course-count">${cDone}/${all.length} ${words.verb}</span>
            <span class="course-pct">${cPct}%</span>
          </div>
          <div class="meter" role="progressbar" aria-valuenow="${cPct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHTML(course)} completion">
            <div class="meter-fill ${cPct === 100 ? 'is-full' : ''}" style="width:${cPct}%"></div>
          </div>
          ${courseVisible.map(taskRow).join('')}
        </section>`;
    }
    $('#courses').innerHTML = html;
    $('#empty-state').hidden = items.length > 0;
  }

  function taskRow(t) {
    const overdue = isOverdue(t);
    const title = t.url
      ? `<a href="${escapeHTML(t.url)}" target="_blank" rel="noopener">${escapeHTML(t.title)}</a>`
      : escapeHTML(t.title);
    return `
      <div class="task ${t.submitted ? 'is-done' : ''} ${isDueSoon(t) ? 'is-due-soon' : ''}" data-id="${t.id}">
        <input type="checkbox" ${t.submitted ? 'checked' : ''} data-act="toggle" aria-label="Mark submitted">
        <span class="task-title">${title}</span>
        ${overdue ? '<span class="badge-overdue">⚠ Overdue</span>' : ''}
        <span class="task-due">${fmtDue(t.due)}</span>
        <span class="task-actions">
          <button class="icon-btn" data-act="edit" title="Edit">✎</button>
          <button class="icon-btn" data-act="del" title="Delete">✕</button>
        </span>
      </div>`;
  }

  // ---------- task CRUD ----------

  function toggleCourse(name) {
    if (collapsed.has(name)) collapsed.delete(name);
    else collapsed.add(name);
    saveCollapsed();
    render();
  }
  $('#courses').addEventListener('click', (e) => {
    const nameEl = e.target.closest('.course-name');
    if (nameEl) return toggleCourse(nameEl.dataset.course);
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
  $('#courses').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const nameEl = e.target.closest('.course-name');
    if (nameEl) { e.preventDefault(); toggleCourse(nameEl.dataset.course); }
  });

  const dlgTask = $('#dlg-task');
  function openTaskDialog(t) {
    editingId = t ? t.id : null;
    $('#dlg-task-title').textContent = t ? 'Edit task' : 'Add task';
    const f = $('#form-task');
    f.title.value = t ? t.title : '';
    f.course.value = t ? t.course : '';
    f.due.value = t ? t.due : '';
    f.url.value = t ? t.url : '';
    dlgTask.showModal();
  }
  $('#btn-cancel-task').addEventListener('click', () => dlgTask.close());
  $('#form-task').addEventListener('submit', (e) => {
    const f = e.target;
    if (!f.title.value.trim() || !f.course.value.trim()) return;
    if (editingId) {
      const t = tasks.find((x) => x.id === editingId);
      Object.assign(t, { title: f.title.value.trim(), course: f.course.value.trim(), due: f.due.value, url: f.url.value.trim() });
    } else {
      tasks.push({ id: uid(), title: f.title.value.trim(), course: f.course.value.trim(), due: f.due.value, url: f.url.value.trim(), submitted: false, added: Date.now(), kind: screen });
    }
    save(); render();
  });

  // ---------- filters & sort ----------

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      filter = chip.dataset.filter;
      render();
    });
  });
  document.querySelectorAll('.screens .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      screen = tab.dataset.screen;
      localStorage.setItem(SCREEN_KEY, screen);
      render();
    });
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
          kind: t.kind === 'lesson' ? 'lesson' : 'task',
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
      // fallback: one task per line, "Course | Title | YYYY-MM-DD"
      incoming = text.split('\n').map((line) => {
        const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
        if (!parts.length) return null;
        if (parts.length === 1) return { title: parts[0], course: 'Imported', due: '', url: '', submitted: false, kind: screen };
        return {
          course: parts[0],
          title: parts[1],
          due: /^\d{4}-\d{2}-\d{2}$/.test(parts[2] || '') ? parts[2] : '',
          url: '',
          submitted: false,
          kind: screen,
        };
      }).filter(Boolean);
    }

    const keyOf = (t) => (kindOf(t) + '::' + t.course + '::' + t.title).toLowerCase();
    const existing = new Map(tasks.map((t) => [keyOf(t), t]));
    let added = 0, updated = 0;
    for (const inc of incoming) {
      const match = existing.get(keyOf(inc));
      if (match) {
        // refresh due date / link / submitted status from the site, keep manual "submitted" ticks
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
    // show the screen matching what was just imported
    const kinds = new Set(incoming.map(kindOf));
    if (kinds.size === 1) {
      screen = [...kinds][0];
      localStorage.setItem(SCREEN_KEY, screen);
    }
    save(); render();
    const noun = kinds.size === 1 && kinds.has('lesson')
      ? (added === 1 ? 'lesson' : 'lessons')
      : (added === 1 ? 'task' : 'tasks');
    setImportResult(`Imported ${added} new ${noun}${updated ? `, updated ${updated}` : ''}${added + updated === 0 ? ' — everything was already up to date' : ''}.`, 'ok');
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!tasks.length) return;
    if (!confirm(`Delete all ${tasks.length} tasks and start fresh? This cannot be undone.`)) return;
    tasks = [];
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

  render();
  initStorage();
})();
