/*
 * Academelp scraper.
 *
 * academelpExtract(doc, base) — pure extraction: takes any Document (the live
 * page in the bookmarklet, or a DOMParser document when raw HTML is pasted
 * into the import box) and returns { course, tasks }.
 *
 * academelpGrab() — the bookmarklet entry point: runs on the uni site, calls
 * the extractor on the live page and copies the JSON payload to the clipboard.
 *
 * Both functions are serialized into a javascript: URL by app.js, so they must
 * only reference each other and browser globals — nothing else in this file.
 *
 * Tuned for OPAL (opal.openu.ac.il) — the Open University's Moodle — with
 * generic fallbacks for other sites.
 */
function academelpExtract(doc, base) {
  var KEYWORDS = /assignment|homework|quiz|exercise|task|submit|due|deadline|\bhw\b|\blab\b|project|exam|מטלה|תרגיל|בוחן|עבודה|הגשה|מבחן|ממ"ן|ממ״ן|ממן|שיעורי בית/i;
  var NOT_DONE = /לא הוגש|טרם הוגש|לא הושלם|טרם הושלם|not submitted|no submission|no attempt|not complete|incomplete|לא נשלח/i;
  var DONE = /הוגש|הושלם|נבדק|נשלח|submitted|completed|graded|turned in|✓|✔/i;
  var DATE_RE = /(\d{4}-\d{2}-\d{2})|(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4})|((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?)/i;

  function parseDate(s) {
    var m = s.match(/\d{4}-\d{2}-\d{2}/);
    if (m) return m[0];
    m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/); // day-first (IL order)
    if (m) {
      var d = +m[1], mo = +m[2], y = +m[3];
      if (mo > 12 && d <= 12) { var t = d; d = mo; mo = t; }
      if (y < 100) y += 2000;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
        return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
    }
    m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
    if (m) {
      var months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      var mi = months.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
      var yr = m[3] ? +m[3] : new Date().getFullYear();
      return yr + '-' + ('0' + mi).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    }
    return '';
  }

  // A row can hold several dates (publish/"from" date, due date, submission
  // timestamp). When we can't tell columns apart, the due date is the latest
  // of the publish/due pair, so take the max.
  function pickDue(s) {
    var re = /(\d{4}-\d{2}-\d{2})|(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4})|((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?)/gi;
    var m, best = '';
    while ((m = re.exec(s))) {
      var d = parseDate(m[0]);
      if (d && d > best) best = d;
    }
    return best;
  }

  function clean(s) { return (s || '').trim().replace(/\s+/g, ' '); }
  function resolve(href) {
    if (!href) return '';
    try { return new URL(href, base).href; } catch (e) { return href; }
  }

  // --- course name ---
  // Moodle marks the body with course-<id>; the "my courses" menu holds the
  // human name for that id — much better than the "20476-2026c: …" title.
  var course = '';
  var cm = ((doc.body && doc.body.className) || '').match(/course-(\d+)/);
  if (cm) {
    var link = doc.querySelector('a[href*="course/view.php?id=' + cm[1] + '"] .text-wrapper, a[href*="course/view.php?id=' + cm[1] + '"]');
    if (link) course = clean(link.textContent);
  }
  if (!course) {
    var h = doc.querySelector('.page-header-headings h1, #region-main h1, h1, .page-title, .breadcrumb li:last-child');
    if (h) course = clean(h.textContent);
  }
  if (!course) course = clean((doc.title || '').split(':')[1] || doc.title) || 'Imported';
  course = course.slice(0, 80);

  // --- scan scope: main content only, so navbars/menus never leak in ---
  var main = doc.querySelector('#region-main, [role="main"], #maincontent, main') || doc;
  if (main.id === 'maincontent' && main.parentElement) main = main.parentElement;

  // A course home page lists lessons/units; a mod index page lists assignments.
  var isCourseView = /path-course-view/.test((doc.body && doc.body.className) || '');
  var kind = isCourseView ? 'lesson' : 'task';

  var tasks = [], seen = {};
  function addTask(title, due, url, submitted) {
    title = clean(title).slice(0, 140);
    if (title.length < 3) return;
    var key = title.toLowerCase();
    if (seen[key]) return;
    seen[key] = 1;
    tasks.push({ title: title, course: course, due: due, url: url || '', submitted: !!submitted, kind: kind });
  }

  // Lessons pass (course home page): Moodle activities, excluding
  // assignment/quiz/forum modules (those belong to the assignments screen).
  var NOT_LESSON = /\/mod\/(ouilassign|assign|quiz|forum|ouilforum|choice|feedback|attendance)\//;
  if (isCourseView) {
    var acts = main.querySelectorAll('li.activity, .activity');
    if (!acts.length) acts = main.querySelectorAll('a[href*="/mod/"]');
    for (var ai = 0; ai < acts.length; ai++) {
      var act = acts[ai];
      var link = act.tagName === 'A' ? act : act.querySelector('a[href*="/mod/"]');
      if (!link) continue;
      var href = link.getAttribute('href') || link.href || '';
      if (NOT_LESSON.test(href)) continue;
      // strip Moodle's hidden "activity type" suffix from the visible name
      var nameEl = (act.querySelector && act.querySelector('.instancename')) || link;
      var nameCopy = nameEl.cloneNode(true);
      var hidden = nameCopy.querySelectorAll('.accesshide, .sr-only');
      for (var hj = 0; hj < hidden.length; hj++) hidden[hj].parentNode.removeChild(hidden[hj]);
      // Moodle marks completion on the row via icon title/alt ("הושלם: …")
      var done = false;
      if (act.querySelectorAll) {
        var marks = act.querySelectorAll('[title], [alt], [aria-label]');
        for (var mk = 0; mk < marks.length; mk++) {
          var mtext = (marks[mk].getAttribute('title') || '') + ' ' +
                      (marks[mk].getAttribute('alt') || '') + ' ' +
                      (marks[mk].getAttribute('aria-label') || '');
          if (NOT_DONE.test(mtext)) { done = false; break; }
          if (DONE.test(mtext)) done = true;
        }
      }
      addTask(nameCopy.textContent, '', resolve(href), done);
    }

    // Fallback for custom course formats (OPAL "smartopal"): scan the whole
    // document for activity links, skipping navigation/menus and duplicates.
    if (!tasks.length) {
      var links = doc.querySelectorAll('a[href*="/mod/"]');
      var seenUrl = {};
      for (var li2 = 0; li2 < links.length; li2++) {
        var a2 = links[li2];
        var href2 = a2.getAttribute('href') || '';
        if (!/\/mod\/[a-z_]+\/(view|index)\.php/.test(href2)) continue;
        if (NOT_LESSON.test(href2)) continue;
        if (a2.closest && a2.closest('nav, header, footer, .navbar, .dropdown-menu, [role="menu"], [role="menubar"], .breadcrumb, .block')) continue;
        var idm = href2.match(/id=(\d+)/);
        var ukey = idm ? idm[1] : href2;
        if (seenUrl[ukey]) continue;
        var copy2 = a2.cloneNode(true);
        var hid2 = copy2.querySelectorAll('.accesshide, .sr-only');
        for (var hk = 0; hk < hid2.length; hk++) hid2[hk].parentNode.removeChild(hid2[hk]);
        var t2 = clean(copy2.textContent);
        if (t2.length < 3) continue;
        seenUrl[ukey] = 1;
        // completion mark lives in the smallest container holding only this activity
        var cont = a2;
        while (cont.parentElement && cont.parentElement.querySelectorAll('a[href*="/mod/"]').length === 1)
          cont = cont.parentElement;
        var done2 = false;
        var marks2 = cont.querySelectorAll('[title], [alt], [aria-label]');
        for (var mj = 0; mj < marks2.length; mj++) {
          var mt2 = (marks2[mj].getAttribute('title') || '') + ' ' +
                    (marks2[mj].getAttribute('alt') || '') + ' ' +
                    (marks2[mj].getAttribute('aria-label') || '');
          if (NOT_DONE.test(mt2)) { done2 = false; break; }
          if (DONE.test(mt2)) done2 = true;
        }
        addTask(t2, '', resolve(href2), done2);
      }
    }
    return { course: course, tasks: tasks, kind: kind };
  }

  // Pass 1 (Moodle): table rows whose link points at an activity view page.
  // Column-aware: the due date is read from the column whose header says
  // "תאריך אחרון להגשה" / "due", never from a publish/"from"-date column.
  var tables = main.querySelectorAll('table');
  for (var ti = 0; ti < tables.length; ti++) {
    var table = tables[ti];
    var dueCol = -1;
    var headRow = table.querySelector('tr');
    var headCells = headRow ? headRow.children : [];
    for (var hi = 0; hi < headCells.length; hi++) {
      var ht = clean(headCells[hi].textContent);
      if (/אחרון להגשה|תאריך הגשה|מועד הגשה|due|deadline/i.test(ht)) { dueCol = hi; break; }
    }
    if (dueCol < 0) {
      for (hi = 0; hi < headCells.length; hi++) {
        if (/הגשה|submission/i.test(clean(headCells[hi].textContent))) { dueCol = hi; break; }
      }
    }
    var rows = table.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var a = row.querySelector('a[href*="view.php"], a[href*="/mod/"]');
      if (!a) continue;
      var text = clean(row.textContent);
      if (!text || text.length > 500) continue;
      var due = '';
      if (dueCol >= 0 && row.cells && row.cells.length > dueCol)
        due = parseDate(clean(row.cells[dueCol].textContent));
      if (!due) due = pickDue(text);
      addTask(a.textContent, due, resolve(a.getAttribute('href')), !NOT_DONE.test(text) && DONE.test(text));
    }
  }

  // Pass 2 (generic): keyword/date rows anywhere in the main region.
  if (!tasks.length) {
    var nodes = main.querySelectorAll('tr, li, .activity, .assignment, [class*="assign" i], [class*="task" i]');
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      if (el.querySelector('tr, li')) continue;
      var t = clean(el.textContent);
      if (!t || t.length > 400) continue;
      if (!KEYWORDS.test(t) && !DATE_RE.test(t)) continue;
      var lnk = el.querySelector('a[href]');
      var title = lnk && clean(lnk.textContent).length > 2 ? lnk.textContent : t.slice(0, 100);
      if (!KEYWORDS.test(title) && !KEYWORDS.test(t)) continue;
      addTask(title, pickDue(t), lnk ? resolve(lnk.getAttribute('href')) : '', !NOT_DONE.test(t) && DONE.test(t));
    }
  }

  return { course: course, tasks: tasks, kind: kind };
}

function academelpGrab() {
  var res = academelpExtract(document, location.href);
  var tasks = res.tasks;

  if (!tasks.length) {
    alert('Academelp: no assignment-looking rows found on this page.\nTry the course assignments page (מטלות הקורס).');
    return;
  }

  var payload = JSON.stringify({ academelp: 1, source: location.hostname, tasks: tasks }, null, 1);
  function fallbackCopy() {
    var ta = document.createElement('textarea');
    ta.value = payload;
    ta.style.position = 'fixed';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    alert('Academelp: copied ' + tasks.length + ' task(s) from "' + res.course + '" to clipboard.\nPaste them into the Academelp import box.');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(payload).then(function () {
      alert('Academelp: copied ' + tasks.length + ' task(s) from "' + res.course + '" to clipboard.\nPaste them into the Academelp import box.');
    }, fallbackCopy);
  } else fallbackCopy();
}
