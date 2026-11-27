/**
 * Waiter Rewards – Google Sheet backend (multi-branch).
 * Paste into Extensions → Apps Script of the Google Sheet, run setup() once,
 * then Deploy → Manage deployments → ✏️ → New version. See README.md.
 *
 * Roles:
 *   Waiter              – branch + name + PIN. Records sales.
 *   Branch manager      – branch + branch PIN. Live board, payouts, waiters for that branch.
 *   Operations manager  – ops PIN. Targets for every branch, branches, all payouts, backup.
 */
const RESET_HOUR = 4;      // a new working day starts at 4 AM, so late-night sales stay on the same shift
const KEEP_RAW_DAYS = 3;   // tap-by-tap rows are kept this long; daily totals stay forever in "Daily"
const SCHEMA = '2';

// The branch column is last in each sheet so data from the first version keeps its place.
const HEAD = {
  Branches: ['branch', 'manager_pin', 'active'],
  Targets:  ['item', 'icon', 'qty', 'reward', 'branch'],
  Waiters:  ['name', 'pin', 'active', 'branch'],
  Sales:    ['time', 'shift', 'waiter', 'item', 'change', 'id', 'branch'],
  Daily:    ['shift', 'waiter', 'item', 'sold', 'target', 'reward', 'earned', 'branch'],
  Settings: ['key', 'value']
};
const TEXT_COLS = { Branches: [2], Waiters: [2], Sales: [2], Daily: [1], Settings: [2] };
const DEFAULT_TARGETS = [['Soup', '🍲', 10, 100], ['Biryani', '🍛', 10, 200], ['Starter', '🍢', 10, 150], ['Beverage', '🥤', 10, 100]];

const ACTIONS = {
  // anyone
  branches: listBranches,
  waiters: listWaiters,
  // waiter
  today: function (r) { return waiterView(waiter(r)); },
  sync: sync,
  // branch manager (the ops PIN also opens any branch)
  m_state: managerState,
  m_waiters: saveWaiters,
  m_payouts: managerPayouts,
  m_pin: changeBranchPin,
  // operations manager
  o_state: opsState,
  o_targets: saveTargets,
  o_branches: saveBranches,
  o_payouts: opsPayouts,
  o_pin: changeOpsPin,
  o_backup: backupNow
};

function doPost(e) {
  var out;
  try {
    ensureSchema();
    var r = JSON.parse(e && e.postData ? e.postData.contents : '{}');
    var fn = ACTIONS[r.action];
    if (!fn) throw new Error('Unknown action. Update the page and the Apps Script to the same version.');
    out = fn(r);
  } catch (err) {
    out = { ok: false, error: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('Waiter Rewards API is running.');
}

/* ---------- setup and upgrade ---------- */

function setup() {
  Object.keys(HEAD).forEach(sheet);
  migrate();
  if (!rows('Waiters').length) replaceRows('Waiters', [['Ravi', '1111', true, firstBranch()]]);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightly').timeBased().atHour((RESET_HOUR + 2) % 24).everyDays(1).create();
  var ss = SpreadsheetApp.getActive(), blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);
  Logger.log('Setup done. Time zone is ' + Session.getScriptTimeZone() +
    ' — if that is wrong, change it in Project Settings and run setup() again.');
}

/** Upgrades data from the single-restaurant version: everything moves into one branch called "Main". */
function ensureSchema() {
  var cache = CacheService.getScriptCache();
  if (cache.get('schema') === SCHEMA) return;
  withLock(function () {
    if (settings().schema !== SCHEMA) migrate();
  });
  cache.put('schema', SCHEMA, 21600);
}

function migrate() {
  Object.keys(HEAD).forEach(sheet);
  var s = settings(), oldPin = s.manager_pin || '1234';
  if (!rows('Branches').length) replaceRows('Branches', [['Main', oldPin, true]]);
  var first = firstBranch();
  ['Targets', 'Waiters', 'Sales', 'Daily'].forEach(function (n) {
    var sh = sheet(n), w = HEAD[n].length;
    sh.getRange(1, w).setValue(HEAD[n][w - 1]).setFontWeight('bold');
    var last = sh.getLastRow();
    if (last < 2) return;
    var col = sh.getRange(2, w, last - 1, 1), v = col.getValues(), changed = false;
    v.forEach(function (r) { if (String(r[0]).trim() === '') { r[0] = first; changed = true; } });
    if (changed) col.setValues(v);
  });
  if (!rows('Targets').length) {
    replaceRows('Targets', DEFAULT_TARGETS.map(function (t) { return t.concat([first]); }));
  }
  if (s.ops_pin == null) setSetting('ops_pin', oldPin);
  setSetting('schema', SCHEMA);
}

/** Run once from the editor to check the GitHub token works. */
function testGitHub() {
  Logger.log(pushToGitHub('data/README.md', '# Daily rewards backups\n\nOne CSV per working day, all branches.\n', 'Set up rewards backups'));
}

/* ---------- sheet helpers ---------- */

function sheet(name) {
  var ss = SpreadsheetApp.getActive(), s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.getRange(1, 1, 1, HEAD[name].length).setValues([HEAD[name]]).setFontWeight('bold');
    s.setFrozenRows(1);
    (TEXT_COLS[name] || []).forEach(function (c) { s.getRange(1, c, s.getMaxRows(), 1).setNumberFormat('@'); });
  }
  return s;
}
function rows(name) {
  var s = sheet(name), n = s.getLastRow() - 1;
  return n > 0 ? s.getRange(2, 1, n, HEAD[name].length).getValues() : [];
}
function appendRows(name, data) {
  if (!data.length) return;
  var s = sheet(name), start = s.getLastRow() + 1, extra = start + data.length - 1 - s.getMaxRows();
  if (extra > 0) s.insertRowsAfter(s.getMaxRows(), extra);
  s.getRange(start, 1, data.length, data[0].length).setValues(data);
}
function replaceRows(name, data) {
  var s = sheet(name), n = s.getLastRow() - 1, w = HEAD[name].length;
  if (n > 0) s.getRange(2, 1, n, w).clearContent();
  var extra = data.length + 1 - s.getMaxRows();
  if (extra > 0) s.insertRowsAfter(s.getMaxRows(), extra);
  if (data.length) s.getRange(2, 1, data.length, w).setValues(data);
}
function deleteRows(s, start, count) {
  if (s.getMaxRows() - count <= 1) s.insertRowsAfter(s.getMaxRows(), 1); // Sheets refuses to delete every row
  s.deleteRows(start, count);
}
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function settings() {
  var o = {};
  rows('Settings').forEach(function (r) { if (r[0] !== '') o[r[0]] = String(r[1]); });
  return o;
}
function setSetting(key, value) {
  var r = rows('Settings');
  for (var i = 0; i < r.length; i++) {
    if (r[i][0] === key) { sheet('Settings').getRange(i + 2, 2).setValue(String(value)); return; }
  }
  appendRows('Settings', [[key, String(value)]]);
}

/* ---------- dates, names, PINs ---------- */

function tz() { return Session.getScriptTimeZone(); }
function shiftOf(d) { return Utilities.formatDate(new Date(d.getTime() - RESET_HOUR * 36e5), tz(), 'yyyy-MM-dd'); }
function addDays(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function day(v) { return v instanceof Date ? Utilities.formatDate(v, tz(), 'yyyy-MM-dd') : String(v).trim(); }
function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function samePin(stored, given) {
  given = String(given == null ? '' : given).trim();
  return given !== '' && String(stored).trim().replace(/^0+/, '') === given.replace(/^0+/, '');
}
function isActive(v) { return !(v === false || /^(false|no|0)$/i.test(String(v).trim())); }
function unique(a) { var o = {}; a.forEach(function (x) { o[x] = 1; }); return Object.keys(o).length; }
function stamp() { return Utilities.formatDate(new Date(), tz(), 'd MMM yyyy, h:mm a'); }

/** Five wrong PINs for the same login locks it for 10 minutes. */
function checkPin(key, ok, message) {
  var cache = CacheService.getScriptCache(), k = 'fail_' + key, n = Number(cache.get(k) || 0);
  if (n >= 5) throw new Error('Too many wrong PINs. Try again in 10 minutes.');
  if (!ok) { cache.put(k, String(n + 1), 600); throw new Error(message); }
}

/* ---------- branches and roles ---------- */

function allBranches() {
  return rows('Branches').filter(function (b) { return String(b[0]).trim(); }).map(function (b) {
    return { name: String(b[0]).trim(), pin: String(b[1]), active: isActive(b[2]) };
  });
}
function firstBranch() { var b = allBranches(); return b.length ? b[0].name : 'Main'; }
/** Pages from the first version send no branch: they get the first branch. */
function branchOf(r) {
  var all = allBranches();
  if (!all.length) throw new Error('No branches set up yet');
  var b = r.branch ? all.filter(function (x) { return norm(x.name) === norm(r.branch); })[0] : all[0];
  if (!b) throw new Error('Unknown branch');
  return b;
}
function isOps(r) { return samePin(settings().ops_pin, r.pin); }
function ops(r) { checkPin('ops', isOps(r), 'Wrong operations PIN'); }
function branchManager(r) {
  var b = branchOf(r);
  if (isOps(r)) return b;
  checkPin('m_' + norm(b.name), samePin(b.pin, r.pin), 'Wrong branch or PIN');
  if (!b.active) throw new Error('This branch is switched off. Ask the operations manager.');
  return b;
}
function waiter(r) {
  var b = branchOf(r);
  var w = rows('Waiters').filter(function (x) { return norm(x[3]) === norm(b.name) && norm(x[0]) === norm(r.name); })[0];
  checkPin('w_' + norm(b.name) + '_' + norm(r.name), !!w && samePin(w[1], r.pin), 'Wrong name or PIN');
  if (!b.active) throw new Error('This branch is switched off.');
  if (!isActive(w[2])) throw new Error('This account is switched off. Ask your manager.');
  return { name: String(w[0]).trim(), branch: b.name };
}

/* ---------- targets and totals ---------- */

function targetsFrom(targetRows, branch) {
  return targetRows.filter(function (r) { return String(r[0]).trim() && norm(r[4]) === norm(branch); }).map(function (r) {
    return { item: String(r[0]).trim(), icon: String(r[1] || ''), qty: Number(r[2]) || 0, reward: Number(r[3]) || 0 };
  });
}
function getTargets(branch) { return targetsFrom(rows('Targets'), branch); }

/** Reads the sheets once; ctx(branch) then gives that branch's slice. */
function loader() {
  var sales = rows('Sales'), daily = rows('Daily'), targets = rows('Targets');
  return function (branch) {
    var nb = norm(branch);
    return {
      branch: branch,
      sales: sales.filter(function (r) { return norm(r[6]) === nb; }),
      daily: daily.filter(function (r) { return norm(r[7]) === nb; }),
      targets: targetsFrom(targets, branch)
    };
  };
}
function context(branch) { return loader()(branch); }

function countsFor(sales, shift, name) {
  var c = {};
  sales.forEach(function (r) {
    if (day(r[1]) === shift && (!name || String(r[2]) === name)) {
      var w = String(r[2]), it = String(r[3]);
      if (!name) { c[w] = c[w] || {}; c[w][it] = (c[w][it] || 0) + Number(r[4]); }
      else c[it] = (c[it] || 0) + Number(r[4]);
    }
  });
  return c;
}
/** One row per waiter per item, worked out from the tap-by-tap log. Counts never go past the target. */
function liveRows(ctx, shift) {
  var all = countsFor(ctx.sales, shift), out = [];
  Object.keys(all).sort().forEach(function (w) {
    var c = all[w];
    ctx.targets.forEach(function (t) {
      var sold = Math.max(0, c[t.item] || 0);
      if (t.qty > 0) sold = Math.min(sold, t.qty);
      out.push({ shift: shift, branch: ctx.branch, waiter: w, item: t.item, sold: sold, target: t.qty, reward: t.reward,
        earned: t.qty > 0 && sold >= t.qty ? t.reward : 0 });
    });
  });
  return out;
}
/** A closed day comes from "Daily"; today (or a day not closed yet) is worked out live. */
function shiftRows(ctx, shift) {
  var closed = ctx.daily.filter(function (r) { return day(r[0]) === shift; });
  if (closed.length) return closed.map(function (r) {
    return { shift: shift, branch: ctx.branch, waiter: String(r[1]), item: String(r[2]), sold: Number(r[3]) || 0,
      target: r[4], reward: r[5], earned: Number(r[6]) || 0 };
  });
  return liveRows(ctx, shift);
}
function rangeRows(ctx, from, to) {
  var re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to) || from > to) throw new Error('Pick a valid date range');
  var out = [], s = from, n = 0;
  while (s <= to && n++ < 93) { out = out.concat(shiftRows(ctx, s)); s = addDays(s, 1); }
  return out;
}
function waitersOf(branch) {
  return rows('Waiters').filter(function (w) { return String(w[0]).trim() && norm(w[3]) === norm(branch); }).map(function (w) {
    return { name: String(w[0]).trim(), pin: String(w[1]), active: isActive(w[2]) };
  });
}

/* ---------- anyone ---------- */

function listBranches() {
  return { ok: true, branches: allBranches().filter(function (b) { return b.active; }).map(function (b) { return b.name; }) };
}
function listWaiters(r) {
  var b = branchOf(r);
  return { ok: true, branch: b.name, names: waitersOf(b.name).filter(function (w) { return w.active; })
    .map(function (w) { return w.name; }).sort() };
}

/* ---------- waiter ---------- */

function waiterView(who, ctx) {
  ctx = ctx || context(who.branch);
  var shift = shiftOf(new Date()), counts = countsFor(ctx.sales, shift, who.name), history = [];
  ctx.targets.forEach(function (t) {
    if (counts[t.item] != null && t.qty > 0) counts[t.item] = Math.min(Math.max(0, counts[t.item]), t.qty);
  });
  for (var i = 1; i <= 7; i++) {
    var s = addDays(shift, -i);
    history.push({ shift: s, earned: shiftRows(ctx, s).filter(function (x) { return x.waiter === who.name; })
      .reduce(function (a, x) { return a + x.earned; }, 0) });
  }
  return { ok: true, name: who.name, branch: who.branch, shift: shift, resetHour: RESET_HOUR,
    targets: ctx.targets, counts: counts, history: history };
}

/** Saves queued taps. Each tap has an id, so a retry after a dropped connection is not counted twice. */
function sync(r) {
  var who = waiter(r), events = (r.events || []).slice(0, 200);
  if (events.length) withLock(function () {
    var cache = CacheService.getScriptCache(), now = Date.now();
    var seen = cache.getAll(events.map(function (e) { return String(e.id); }));
    var ctx = context(who.branch), targets = {};
    ctx.targets.forEach(function (t) { targets[t.item] = t; });
    var counts = {}, done = {}, out = [], put = {};
    events.forEach(function (e) {
      var id = String(e.id || ''), t = targets[e.item];
      if (!id || seen[id] || done[id] || !t || (e.change !== 1 && e.change !== -1)) return;
      done[id] = 1; put[id] = '1';
      var ts = Number(e.t), when = new Date(ts > now - 36 * 36e5 && ts < now + 5 * 6e4 ? ts : now), shift = shiftOf(when);
      if (!counts[shift]) counts[shift] = countsFor(ctx.sales, shift, who.name);
      var c = counts[shift], have = Math.max(0, c[e.item] || 0);
      if (e.change === 1 && t.qty > 0 && have >= t.qty) return;   // target already reached: ignore extra taps
      if (e.change === -1 && have <= 0) return;                  // nothing to undo
      c[e.item] = have + e.change;
      out.push([new Date(now), shift, who.name, e.item, e.change, id.slice(0, 60), who.branch]);
    });
    appendRows('Sales', out);
    if (Object.keys(put).length) cache.putAll(put, 21600);
  });
  return waiterView(who);
}

/* ---------- branch manager ---------- */

function managerState(r) {
  var b = branchManager(r), ctx = context(b.name), shift = shiftOf(new Date());
  return { ok: true, branch: b.name, asOps: isOps(r), shift: shift, resetHour: RESET_HOUR,
    targets: ctx.targets, waiters: waitersOf(b.name), today: liveRows(ctx, shift) };
}

function saveWaiters(r) {
  var b = branchManager(r);
  var w = (r.waiters || []).map(function (x) {
    return [String(x.name || '').trim().slice(0, 30), String(x.pin || '').trim(), x.active !== false, b.name];
  }).filter(function (x) { return x[0]; });
  w.forEach(function (x) { if (!/^\d{4,8}$/.test(x[1])) throw new Error(x[0] + ' needs a PIN of 4 to 8 digits'); });
  if (unique(w.map(function (x) { return norm(x[0]); })) !== w.length) throw new Error('Two waiters have the same name');
  withLock(function () {
    var others = rows('Waiters').filter(function (x) { return String(x[0]).trim() && norm(x[3]) !== norm(b.name); });
    replaceRows('Waiters', others.concat(w));
  });
  return managerState(r);
}

function managerPayouts(r) {
  var b = branchManager(r);
  return { ok: true, from: r.from, to: r.to, rows: rangeRows(context(b.name), String(r.from || ''), String(r.to || '')) };
}

function changeBranchPin(r) {
  var b = branchManager(r);
  if (!/^\d{4,8}$/.test(String(r.newPin || ''))) throw new Error('Use 4 to 8 digits');
  if (samePin(settings().ops_pin, r.newPin)) throw new Error('Pick a different PIN');
  withLock(function () {
    var all = rows('Branches');
    for (var i = 0; i < all.length; i++) {
      if (norm(all[i][0]) === norm(b.name)) { sheet('Branches').getRange(i + 2, 2).setValue(String(r.newPin)); break; }
    }
  });
  return { ok: true };
}

/* ---------- operations manager ---------- */

function opsState(r) {
  ops(r);
  var load = loader(), shift = shiftOf(new Date()), p = settings(), allW = rows('Waiters');
  var list = allBranches().map(function (b) {
    var ctx = load(b.name), today = liveRows(ctx, shift), by = {};
    today.forEach(function (x) { by[x.waiter] = (by[x.waiter] || 0) + x.earned; });
    return {
      name: b.name, pin: b.pin, active: b.active, targets: ctx.targets,
      waiters: allW.filter(function (w) { return String(w[0]).trim() && norm(w[3]) === norm(b.name) && isActive(w[2]); }).length,
      selling: Object.keys(by).length,
      hit: Object.keys(by).filter(function (w) { return by[w] > 0; }).length,
      earned: today.reduce(function (a, x) { return a + x.earned; }, 0)
    };
  });
  return { ok: true, shift: shift, resetHour: RESET_HOUR, branches: list, lastBackup: p.last_backup || '',
    github: !!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') };
}

function cleanTargets(list) {
  var t = (list || []).map(function (x) {
    return [String(x.item || '').trim().slice(0, 30), String(x.icon || '').trim().slice(0, 8),
      Math.max(1, Math.round(Number(x.qty) || 0)), Math.max(0, Math.round(Number(x.reward) || 0))];
  }).filter(function (x) { return x[0]; });
  if (!t.length) throw new Error('Add at least one item');
  if (unique(t.map(function (x) { return norm(x[0]); })) !== t.length) throw new Error('Two items have the same name');
  return t;
}

/** Sets one branch's targets, or every branch's when r.all is true. */
function saveTargets(r) {
  ops(r);
  var t = cleanTargets(r.targets);
  var names = r.all ? allBranches().map(function (b) { return b.name; }) : [branchOf(r).name];
  var set = {}; names.forEach(function (n) { set[norm(n)] = 1; });
  withLock(function () {
    var keep = rows('Targets').filter(function (x) { return String(x[0]).trim() && !set[norm(x[4])]; });
    names.forEach(function (n) { keep = keep.concat(t.map(function (x) { return x.concat([n]); })); });
    replaceRows('Targets', keep);
  });
  return opsState(r);
}

/** Adds branches and updates PINs / on-off. Existing branches are never renamed or deleted, so their history stays linked. */
function saveBranches(r) {
  ops(r);
  var given = (r.branches || []).map(function (b) {
    return { name: String(b.name || '').trim().slice(0, 30), pin: String(b.pin || '').trim(), active: b.active !== false };
  }).filter(function (b) { return b.name; });
  var opsPin = settings().ops_pin;
  given.forEach(function (b) {
    if (!/^\d{4,8}$/.test(b.pin)) throw new Error(b.name + ' needs a manager PIN of 4 to 8 digits');
    if (samePin(opsPin, b.pin)) throw new Error(b.name + ': the manager PIN must be different from the operations PIN');
  });
  if (unique(given.map(function (b) { return norm(b.name); })) !== given.length) throw new Error('Two branches have the same name');
  withLock(function () {
    var current = allBranches(), byName = {};
    given.forEach(function (b) { byName[norm(b.name)] = b; });
    var out = current.map(function (b) {
      var g = byName[norm(b.name)];
      delete byName[norm(b.name)];
      return g ? [b.name, g.pin, g.active] : [b.name, b.pin, b.active];
    });
    var added = Object.keys(byName).map(function (k) { return byName[k]; });
    if (added.length) {
      var all = rows('Targets'), copy = targetsFrom(all, current.length ? current[0].name : '');
      if (!copy.length) copy = DEFAULT_TARGETS.map(function (t) { return { item: t[0], icon: t[1], qty: t[2], reward: t[3] }; });
      added.forEach(function (b) {
        out.push([b.name, b.pin, b.active]);
        copy.forEach(function (t) { all.push([t.item, t.icon, t.qty, t.reward, b.name]); });
      });
      replaceRows('Targets', all.filter(function (x) { return String(x[0]).trim(); }));
    }
    replaceRows('Branches', out);
  });
  return opsState(r);
}

/** All branches when r.branch is empty. */
function opsPayouts(r) {
  ops(r);
  var load = loader(), from = String(r.from || ''), to = String(r.to || ''), out = [];
  var names = r.branch ? [branchOf(r).name] : allBranches().map(function (b) { return b.name; });
  names.forEach(function (n) { out = out.concat(rangeRows(load(n), from, to)); });
  return { ok: true, from: from, to: to, rows: out };
}

function changeOpsPin(r) {
  ops(r);
  if (!/^\d{4,8}$/.test(String(r.newPin || ''))) throw new Error('Use 4 to 8 digits');
  if (allBranches().some(function (b) { return samePin(b.pin, r.newPin); })) throw new Error('That PIN is used by a branch manager. Pick a different one.');
  setSetting('ops_pin', String(r.newPin));
  return { ok: true };
}

function backupNow(r) {
  ops(r);
  var msg = closeShift(addDays(shiftOf(new Date()), -1));
  setSetting('last_backup', stamp() + ' — ' + msg);
  return { ok: true, message: msg };
}

/* ---------- nightly close and GitHub backup ---------- */

/** Runs every morning (2 hours after RESET_HOUR). Re-closes the day before too, to catch taps sent late. */
function nightly() {
  ensureSchema();
  var today = shiftOf(new Date());
  var msg = [closeShift(addDays(today, -2)), closeShift(addDays(today, -1))];
  prune();
  setSetting('last_backup', stamp() + ' — ' + msg.join(' | '));
}

function closeShift(shift) {
  var load = loader(), out = [], any = false;
  allBranches().forEach(function (b) {
    var ctx = load(b.name);
    if (ctx.sales.some(function (r) { return day(r[1]) === shift; })) any = true;
    liveRows(ctx, shift).forEach(function (x) {
      out.push([x.shift, x.waiter, x.item, x.sold, x.target, x.reward, x.earned, x.branch]);
    });
  });
  if (!any) return shift + ': no sales';
  withLock(function () {
    var s = sheet('Daily'), idx = [];
    rows('Daily').forEach(function (r, i) { if (day(r[0]) === shift) idx.push(i + 2); });
    for (var i = idx.length - 1; i >= 0;) {          // delete old rows for this day, in blocks from the bottom
      var end = idx[i], start = end;
      while (i > 0 && idx[i - 1] === start - 1) { start--; i--; }
      i--;
      deleteRows(s, start, end - start + 1);
    }
    appendRows('Daily', out);
  });
  var gh;
  try {
    var csvRows = out.map(function (x) { return [x[0], x[7]].concat(x.slice(1, 7)); });
    gh = pushToGitHub('data/' + shift + '.csv',
      toCsv([['shift', 'branch', 'waiter', 'item', 'sold', 'target', 'reward', 'earned']].concat(csvRows)), 'Daily rewards ' + shift);
  } catch (e) { gh = 'failed (' + e.message + ')'; }
  return shift + ': saved, GitHub ' + gh;
}

function prune() {
  var cutoff = Date.now() - KEEP_RAW_DAYS * 864e5, r = rows('Sales'), n = 0;
  while (n < r.length && new Date(r[n][0]).getTime() < cutoff) n++;
  if (n) withLock(function () { deleteRows(sheet('Sales'), 2, n); });
}

function pushToGitHub(path, text, message) {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty('GITHUB_TOKEN'), repo = p.getProperty('GITHUB_REPO'), branch = p.getProperty('GITHUB_BRANCH') || 'main';
  if (!token || !repo) return 'not set up';
  var url = 'https://api.github.com/repos/' + repo + '/contents/' + path;
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  var got = UrlFetchApp.fetch(url + '?ref=' + encodeURIComponent(branch), { headers: headers, muteHttpExceptions: true });
  var sha;
  if (got.getResponseCode() === 200) {
    var j = JSON.parse(got.getContentText());
    sha = j.sha;
    var old = Utilities.newBlob(Utilities.base64Decode(String(j.content || '').replace(/\n/g, ''))).getDataAsString('UTF-8');
    if (old === text) return 'unchanged';
  }
  var body = { message: message, content: Utilities.base64Encode(text, Utilities.Charset.UTF_8), branch: branch };
  if (sha) body.sha = sha;
  var res = UrlFetchApp.fetch(url, { method: 'put', headers: headers, contentType: 'application/json',
    payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error('GitHub ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 150));
  return 'saved';
}

function toCsv(data) {
  return data.map(function (r) {
    return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
  }).join('\n') + '\n';
}
