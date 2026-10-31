// Gym Log: the screens and what they do. Saved data goes through storage.js and store.js,
// and the small HTML and page helpers are in ui.js.
import { sessionTypes, exercises, exercisesForGroup } from "./exercises.js";
import { emptySettings, allExercises, configFor, updateExercise, toNumber } from "./settings.js";
import { effectiveConfig, globalDefaults, updateGlobalDefaults, warmupReps, ownWarmupReps } from "./defaults.js";
import {
  makeSet, todaysSets, defaultsFor, removeLastSet, weightOptions,
  isDoneToday, markDone, unmarkDone,
} from "./log.js";
import {
  formatTime, startWorkout, isRunning, workoutElapsed, machineElapsed,
  runMachines, endWorkout, cleanWorkout,
} from "./timer.js";
import { hasExtras, extraOptions, totalWeight, splitFor } from "./extras.js";
import { STEP_CHOICES, buildPins, addPin, removePin, describePins, hasPins } from "./stacks.js";
import {
  cleanStore, migrateLegacy, toLegacySettings, applyLegacySettings, supportsWarmup, exportMachines, importMachines,
} from "./store.js";
import { makeBackup, backupFileName, parseBackup, fileKind, dataSummary, describeData, backupAge } from "./backup.js";
import { KEY, load, loadList, save } from "./storage.js";
import {
  $, esc, optionsHtml, selectHtml, field, numField, cols, box, muted, ghostBtn, backBtn, wire, addItems, addChoices, sendFile,
} from "./ui.js";

// ---------- Saved data ----------
let sets = loadList(KEY.sets);
let done = loadList(KEY.done);       // exercises finished today: { exerciseId, date }
// The workout timer: started by opening the first exercise, stopped by End workout. A workout
// left over from an earlier day is dropped.
let workout = cleanWorkout(load(KEY.workout, null), Date.now());

// The permanent store. The first time, it is built from the old gymlog.settings data, which is left
// untouched as a backup.
let store = cleanStore(load(KEY.store, null));
if (!store) {
  store = migrateLegacy(load(KEY.settings, {}));
  save(KEY.store, store);
}

// The screens use the current person's and gym's settings in a flat shape. The store is the saved copy.
let settings;
let exCache = null;
function reloadSettings() {
  settings = { ...emptySettings(), ...toLegacySettings(store, store.currentPerson, store.currentGym) };
  exCache = null;
}
function saveSettings(next) {
  settings = next;
  exCache = null;
  store = applyLegacySettings(store, store.currentPerson, store.currentGym, settings);
  save(KEY.store, store);
}
reloadSettings();
const exList = () => (exCache ??= allExercises(exercises, settings));   // includes your renames and stacks

// The selected session. Whatever is selected is remembered and is what Quick start uses.
let session = { type: "legs", mode: "heavy", ...load(KEY.session, {}) };
if (!sessionTypes.some((t) => t.id === session.type)) session.type = "legs";
if (session.mode !== "volume") session.mode = "heavy";

// ---------- What is on screen ----------
let screen = "start";
let showMore = false;      // show less common exercises on the list
let showDone = false;      // is the "done today" list open on the exercise list?
let pickMore = false;      // show less common exercises when picking a superset partner
let panels = [];           // exercises on the logging page: one, or two when supersetting
let editId = null;         // the exercise being set up
let flash = "";            // a short message shown once, e.g. "Defaults saved"
let backupMsg = "";        // a short message shown once on the Backup screen
let stackFilter = "all";   // Machine setup list: "all", "legs" or "arms"
let stackId = null;        // the machine being set up on the Machine setup screen
let stackPins = [];        // the list of stack weights being built for that machine

const app = $("app");
const typeInfo = (id) => sessionTypes.find((t) => t.id === id);
const hasDayType = () => typeInfo(session.type).weights;             // Legs and Arms only
const dayMode = () => (hasDayType() ? session.mode : null);          // "heavy", "volume" or null
const modeKey = () => (dayMode() === "heavy" ? "Heavy" : "Volume");  // sessions without a day type use the Volume settings
const sessionLabel = (s) => {
  const t = typeInfo(s.type);
  return t.weights ? t.label + " · " + (s.mode === "volume" ? "Volume" : "Heavy") : t.label;
};

// Text from a box to a whole number above zero, or null if blank or invalid.
function wholeOrNull(text) {
  const n = toNumber(text);
  return n !== null && Math.round(n) > 0 ? Math.round(n) : null;
}

// ---------- Timers ----------
// The workout starts by itself when you open an exercise and stops when you tap End workout.
// A machine's clock runs while it is on the logging page (or the superset picker) and is not
// finished. Times come from the clock, so they stay right when the phone sleeps.
function syncTimers() {
  const want = (screen === "exercise" || screen === "pick")
    ? panels.filter((p) => !isDoneToday(done, p.ex.id)).map((p) => p.ex.id)
    : [];
  if (want.length > 0 && !isRunning(workout)) workout = startWorkout(Date.now());
  if (!isRunning(workout)) return;
  workout = runMachines(workout, want, Date.now());
  save(KEY.workout, workout);
}

// The total workout time, shown on every screen except the machine page while a workout is on.
// After End workout it stays visible on the exercise list only.
function timeBar() {
  if (!workout) return "";
  if (!isRunning(workout) && screen !== "list") return "";
  return '<div class="timebar"><span>' + (isRunning(workout) ? "Workout" : "Workout finished") + "</span>" +
    '<span class="tm" data-t="workout">' + formatTime(workoutElapsed(workout, Date.now())) + "</span></div>";
}

// Keeps the screen on while a workout is running and the app is on screen (where the phone supports it).
let wakeLock = null;
let waking = false;
async function keepAwake() {
  if (waking || !("wakeLock" in navigator)) return;
  waking = true;
  try {
    const want = isRunning(workout) && document.visibilityState === "visible";
    if (want && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
  waking = false;
}

// Updates the clocks on screen once a second without redrawing the page.
function tick() {
  keepAwake();
  const now = Date.now();
  document.querySelectorAll("[data-t]").forEach((el) => {
    const t = el.dataset.t;
    el.textContent = formatTime(t === "workout" ? workoutElapsed(workout, now) : machineElapsed(workout, t.slice(2), now));
  });
}
setInterval(tick, 1000);
document.addEventListener("visibilitychange", tick);

// ---------- Moving between screens ----------
// Where each screen's Back button (and the phone's back gesture) goes.
const BACK = {
  list: "start", setup: "start", edit: "setup", exercise: "list", pick: "exercise",
  stacks: "start", stackEdit: "stacks", backup: "start",
};
const SCREENS = {
  start: renderStart, list: renderList, exercise: renderExercise, pick: renderPick, setup: renderSetup,
  edit: renderEdit, stacks: renderStacks, stackEdit: renderStackEdit, backup: renderBackup,
};

function render() {
  syncTimers();
  SCREENS[screen]();
}

function go(name) {
  screen = name;
  armBack();
  render();
  window.scrollTo(0, 0);
}

function goBack() {
  if (screen === "exercise") panels = [];
  go(BACK[screen]);
}

// The phone's back button or gesture steps back one screen instead of closing the app.
function armBack() {
  if (!history.state || !history.state.armed) history.pushState({ armed: true }, "");
}
window.addEventListener("popstate", () => {
  if (screen !== "start") goBack();   // on the start screen, back leaves the app as usual
});

// The exercises to show now (the common ones until "Show less common" is tapped) and that button.
function commonSplit(list, expanded, id) {
  const common = list.filter((e) => e.common);
  return {
    shown: expanded ? list : common,
    toggle: list.length > common.length ? ghostBtn(id, (expanded ? "Hide" : "Show") + " less common") : "",
  };
}

// ---------- Start screen ----------
function renderStart() {
  const t = typeInfo(session.type);
  const age = backupAge(load(KEY.lastBackup, null));
  app.innerHTML =
    "<h1>Gym Log</h1>" + timeBar() +
    '<button class="primary" id="quick">Quick start: ' + esc(sessionLabel(session)) + "</button>" +
    "<label>Session</label>" +
    '<div class="choices" id="types"></div>' +
    (t.weights ? '<label>Day type</label><div class="choices" id="modes"></div>' : "") +
    '<button class="secondary" id="setupBtn">Set up ' + esc(sessionLabel(session)) + "</button>" +
    '<button class="link" id="stacksBtn" style="display:block;margin:32px auto 0;opacity:0.6">Machine setup</button>' +
    '<button class="faintlink" id="backupBtn">Backup &amp; restore' + (age.stale ? " (last backup: " + age.text + ")" : "") + "</button>";

  // Choosing a session or day type updates Quick start and is remembered straight away.
  const choose = (change) => { Object.assign(session, change); save(KEY.session, session); render(); };
  addChoices("types", sessionTypes.map((st) => [st.label, st.id === session.type, () => choose({ type: st.id })]));
  if (t.weights) {
    addChoices("modes", [["heavy", "Heavy"], ["volume", "Volume"]].map(([mode, label]) => [label, session.mode === mode, () => choose({ mode })]));
  }
  wire({
    quick: () => { showMore = false; go("list"); },
    setupBtn: () => go("setup"),
    stacksBtn: () => go("stacks"),
    backupBtn: () => go("backup"),
  });
}

// ---------- Exercise list ----------
function renderList() {
  const all = exercisesForGroup(session.type, true, exList());
  // Finished exercises include any pull-ups done as a superset on an arms day.
  const finished = sessionPool().filter((e) => isDoneToday(done, e.id));
  const open = all.filter((e) => !isDoneToday(done, e.id));
  const { shown, toggle } = commonSplit(open, showMore, "more");

  let message = "";
  if (all.length === 0) message = "No exercises here yet. You will be able to add some in a later step.";
  else if (shown.length === 0 && finished.length > 0) message = open.length === 0 ? "All done for today. Nice work." : "All the main exercises are done.";

  app.innerHTML =
    timeBar() + ghostBtn("change", esc(sessionLabel(session)) + " &#9662; change", "margin-top:0") +
    '<div id="list"></div>' +
    (message ? muted(message) : "") +
    toggle +
    (finished.length > 0 ? ghostBtn("doneToggle", (showDone ? "Hide" : "Show") + " done today (" + finished.length + ")") : "") +
    '<div id="doneList"></div>' +
    (isRunning(workout) ? '<button class="secondary" id="endWorkout">End workout</button>' : "");

  addItems("list", shown.map((e) => [esc(e.name), () => openExercise(e)]));
  if (showDone) {
    addItems("doneList", finished.map((e) => {
      const n = todaysSets(sets, e.id).length;
      return ["&#10003; " + esc(e.name) + "<small>" + n + (n === 1 ? " set" : " sets") + " &middot; tap to view or reopen</small>", () => openExercise(e)];
    }));
  }
  wire({
    change: () => go("start"),
    more: () => { showMore = !showMore; render(); },
    doneToggle: () => { showDone = !showDone; render(); },
    endWorkout: () => {
      if (!confirm("End the workout and stop the timer?")) return;
      workout = endWorkout(workout, Date.now());
      save(KEY.workout, workout);
      render();
    },
  });
}

// ---------- Exercise screen ----------
// The logging page shows one exercise, or two when supersetting. Every exercise uses the same
// compact card with its own weight, reps, Log set, Undo and Finish buttons.

// A machine's settings as the logging page uses them. Exercises with no warm-up set have no warm-up weight.
function cfgFor(e) {
  const cfg = effectiveConfig(settings, e.id);
  if (!supportsWarmup(e)) { cfg.startHeavy = null; cfg.startVolume = null; }
  return cfg;
}

function resetPanel(p) {
  const cfg = cfgFor(p.ex);
  const key = modeKey();
  const d = defaultsFor(p.ex, sets, cfg, dayMode() ?? "volume");
  p.reps = d.reps;
  p.weight = d.weight;
  // The warm-up set (the first set of the day, when a warm-up weight is set) uses the warm-up reps.
  if (cfg["start" + key] !== null && todaysSets(sets, p.ex.id).length === 0) {
    p.reps = warmupReps(settings, p.ex.id, key);
  }
  if (!hasExtras(p.ex)) return;
  // Machines with extras: keep the stack weight and extra already chosen when the total is unchanged
  // (the next set at the same weight), otherwise work them out from the total.
  if (p.pin !== undefined && totalWeight(p.pin, p.extra) === d.weight) return;
  const s = splitFor(settings, p.ex, d.weight, cfg, key);
  p.pin = s.pin;
  p.extra = s.extra;
}

function newPanel(e) {
  const p = { ex: e, weight: 0, reps: 5 };
  resetPanel(p);
  return p;
}

function openExercise(e) {
  panels = [newPanel(e)];
  go("exercise");
}

// The list of extra weights a machine offers, with "None" first.
const extraSelectHtml = (id, e, chosen) =>
  selectHtml(id, '<option value="0">None</option>' + optionsHtml(extraOptions(e), chosen, (x) => "+" + x + " " + e.unit));

function panelHtml(p, i) {
  const e = p.ex;
  const cfg = cfgFor(e);
  const key = modeKey();
  const today = todaysSets(sets, e.id);
  const hasWarmup = cfg["start" + key] !== null;
  const totalSets = cfg["sets" + key] + (hasWarmup ? 1 : 0);
  const complete = today.length >= totalSets;
  const progress = complete
    ? "All " + totalSets + " sets done"
    : "Set " + (today.length + 1) + " of " + totalSets + (hasWarmup && today.length === 0 ? " (warm-up)" : "");
  const withExtras = hasExtras(e);
  const shown = withExtras ? p.pin : p.weight;     // the stack weight, or the whole weight when there is no stack
  const weightSel = selectHtml("weightSel" + i, optionsHtml(weightOptions(e, shown), shown, (w) => w + " " + e.unit));
  const notes = cfg.notes ? '<div class="note">' + esc(cfg.notes).replace(/\n/g, "<br>") + "</div>" : "";
  // Finish appears once there is a set to save. It turns green when all target sets are done.
  const finishHtml = isDoneToday(done, e.id)
    ? '<div class="finished">&#10003; Finished for today</div><button class="outline" id="reopen' + i + '">Reopen exercise</button>'
    : today.length > 0
      ? '<button class="' + (complete ? "primary" : "secondary") + '" id="finish' + i + '" style="margin-top:12px">Finish exercise</button>'
      : "";
  const setsText = today.length === 0
    ? "No sets yet"
    : today.map((s) => s.weight + " " + e.unit + " x " + s.reps).join(" &middot; ");
  const repsHtml = '<button id="rMinus' + i + '">-</button><span class="val">' + p.reps + " <small>reps</small></span>" +
    '<button id="rPlus' + i + '">+</button>';
  // Machines with extras: a stack list and an extra list, then the total beside the reps.
  // Other exercises: one weight list and an "Other weight" box.
  const weightHtml = withExtras
    ? '<div class="pe"><div><span class="cap">Stack</span>' + weightSel + "</div>" +
      '<div><span class="cap">Extra</span>' + extraSelectHtml("extraSel" + i, e, p.extra) + "</div></div>" +
      '<div class="wr"><span class="total">Total <b>' + p.weight + " " + e.unit + "</b></span>" + repsHtml + "</div>"
    : '<div class="wr">' + weightSel + repsHtml + "</div>" +
      "<details><summary>Other weight (" + e.unit + ")</summary>" +
      '<div class="other"><input id="otherW' + i + '" type="number" inputmode="decimal" step="any" placeholder="e.g. 12.5"><button id="otherBtn' + i + '">Set</button></div></details>';

  return '<div class="card"><div class="cardhead"><strong>' + esc(e.name) + "</strong>" +
    '<span class="tm cardtime" data-t="m:' + esc(e.id) + '">' + formatTime(machineElapsed(workout, e.id, Date.now())) + "</span>" +
    (panels.length > 1 ? '<button class="link" id="remove' + i + '">Remove</button>' : "") + "</div>" +
    notes + weightHtml +
    '<div class="logrow"><span class="progress">' + progress + '</span><button class="' + (complete ? "outline" : "primary") + '" id="logBtn' + i + '">Log set</button></div>' +
    '<div class="muted small">' + setsText + (today.length > 0 ? ' <button class="link" id="undo' + i + '">Undo last set</button>' : "") + "</div>" +
    finishHtml + "</div>";
}

function setDone(next) {
  done = next;
  save(KEY.done, done);
}

function bindPanel(p, i) {
  const e = p.ex;
  // After the logged sets change: save them, work out the next defaults and redraw.
  const setsChanged = () => { save(KEY.sets, sets); resetPanel(p); render(); };

  $("weightSel" + i).onchange = (ev) => {
    const v = Number(ev.target.value);
    if (!hasExtras(e)) { p.weight = v; return; }
    p.pin = v;
    p.weight = totalWeight(p.pin, p.extra);
    render();
  };
  if ($("extraSel" + i)) {
    $("extraSel" + i).onchange = (ev) => {
      p.extra = Number(ev.target.value);
      p.weight = totalWeight(p.pin, p.extra);
      render();
    };
  }
  wire({
    otherBtn: () => {
      const v = parseFloat($("otherW" + i).value);
      if (Number.isFinite(v) && v >= 0) { p.weight = v; render(); }
    },
    rMinus: () => { p.reps = Math.max(0, p.reps - 1); render(); },
    rPlus: () => { p.reps += 1; render(); },
    logBtn: () => {
      sets.push(makeSet({ exerciseId: e.id, weight: p.weight, reps: p.reps, mode: dayMode() || undefined }));
      setsChanged();
    },
    undo: () => { sets = removeLastSet(sets, e.id); setsChanged(); },
    // Sets are saved as you log them. Finish marks only this exercise as done for today and takes it
    // off the list. If it was one of a superset, the other exercise stays on the page.
    finish: () => {
      setDone(markDone(done, e.id));
      showDone = false;
      panels.splice(i, 1);
      go(panels.length === 0 ? "list" : "exercise");
    },
    reopen: () => { setDone(unmarkDone(done, e.id)); render(); },
    // Take this exercise off the page without finishing it. Its sets are kept.
    remove: () => { panels.splice(i, 1); go("exercise"); },
  }, i);
}

function renderExercise() {
  const single = panels.length === 1;
  app.innerHTML =
    '<div class="topbar">' + ghostBtn("back", "&larr; " + (single ? "Pick another machine" : "Back to list")) +
    (single ? ghostBtn("superset", "+ Superset") : "") + "</div>" +
    panels.map(panelHtml).join("");
  wire({ back: goBack, superset: () => { pickMore = false; go("pick"); } });
  panels.forEach(bindPanel);
}

// ---------- Pick a superset exercise ----------
// Only this session's exercises (legs on a legs day, arms on an arms day). Pull-ups are the
// exception: they can also be paired on an arms day.
const ANY_DAY_SUPERSET = ["pull-up"];

// This session's exercises, plus the any-day ones when the session is legs or arms.
function sessionPool() {
  const own = exercisesForGroup(session.type, true, exList());
  const extra = hasDayType()
    ? exList().filter((e) => ANY_DAY_SUPERSET.includes(e.id) && !own.some((o) => o.id === e.id))
    : [];
  return [...own, ...extra];
}

function renderPick() {
  const onPage = new Set(panels.map((p) => p.ex.id));
  const choices = sessionPool().filter((e) => !onPage.has(e.id) && !isDoneToday(done, e.id));
  const { shown, toggle } = commonSplit(choices, pickMore, "pickMore");
  app.innerHTML =
    backBtn() + timeBar() + "<h2>Add a superset exercise</h2>" +
    '<div id="pickList"></div>' +
    (shown.length === 0 ? muted("No other exercises left to add.") : "") +
    toggle;
  addItems("pickList", shown.map((e) => [esc(e.name), () => { panels.push(newPanel(e)); go("exercise"); }]));
  wire({ back: goBack, pickMore: () => { pickMore = !pickMore; render(); } });
}

// ---------- Set up session: list of machines ----------
function summary(e, cfg, key) {
  const v = (k) => cfg[k + key];
  const parts = [
    v("start") !== null && "Warm-up " + v("start") + " " + e.unit,
    v("work") !== null && "Working " + v("work") + " " + e.unit,
    v("reps") !== null && v("reps") + " reps",
    v("sets") !== null && v("sets") + " sets",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Uses the defaults";
}

function renderSetup() {
  const list = exercisesForGroup(session.type, true, exList());
  const key = modeKey();
  const g = globalDefaults(settings);
  app.innerHTML =
    backBtn() + timeBar() + "<h2>Set up " + esc(sessionLabel(session)) + "</h2>" +
    box("Defaults for every machine · " + key + " day",
      cols(numField("g_reps", "Reps", g["reps" + key]), numField("g_sets", "Sets", g["sets" + key])) +
      '<button class="secondary" id="saveDefaults" style="margin-top:12px">Save defaults</button>' +
      (flash ? muted(flash) : "") +
      (hasDayType() ? "" : muted(esc(typeInfo(session.type).label) + " uses the Volume day defaults."))) +
    muted("Tap a machine to give it its own weights, reps or sets.") +
    '<div id="list"></div>' +
    (list.length === 0 ? muted("No exercises here yet. You will be able to add some in a later step.") : "");
  flash = "";

  addItems("list", list.map((e) => [
    esc(e.name) + "<small>" + esc(summary(e, configFor(settings, e.id), key)) + "</small>",
    () => { editId = e.id; go("edit"); },
  ]));
  wire({
    back: goBack,
    saveDefaults: () => {
      saveSettings(updateGlobalDefaults(settings, {
        ["reps" + key]: wholeOrNull($("g_reps").value),
        ["sets" + key]: wholeOrNull($("g_sets").value),
      }));
      flash = "Defaults saved";
      render();
    },
  });
}

// ---------- Set up session: one machine (personal settings) ----------
// Name and stack are set on Machine setup. This screen is just for you: warm-up and working
// weights and reps, and notes (the same notes for Heavy and Volume days).
function renderEdit() {
  const e = exList().find((x) => x.id === editId);
  const cfg = configFor(settings, e.id);
  const eff = effectiveConfig(settings, e.id);   // what this machine uses right now
  const key = modeKey();
  const withExtras = hasExtras(e);
  const withWarmup = supportsWarmup(e);
  const hasStack = Array.isArray(e.pins) && e.pins.length > 0;
  const savedExtra = (kind) => {
    const x = settings.exercises?.[e.id]?.[kind + "Extra" + key];
    return Number.isFinite(x) ? x : 0;
  };

  // A stack weight: chosen from the machine's stack when it has one, otherwise typed.
  const stackField = (id, label, value) => hasStack
    ? field(id, label, selectHtml(id, '<option value="">None</option>' + optionsHtml(weightOptions(e, value ?? undefined), value, (w) => w + " " + e.unit), "field"))
    : numField(id, label + " (" + e.unit + ")", value, "none");

  // A warm-up or working weight. Machines with extras get a stack weight and an extra list (the total is the sum).
  const weightField = (kind, label) => {
    const total = cfg[kind + key];
    const id = "f_" + kind;
    if (!withExtras) return stackField(id, label + " weight", total);
    const extra = total === null ? 0 : savedExtra(kind);
    const stack = total === null ? null : totalWeight(total, -extra);
    return cols(stackField(id, label + " weight", stack), field(id + "Extra", "Extra", extraSelectHtml(id + "Extra", e, extra)));
  };

  app.innerHTML =
    backBtn("Back without saving") + timeBar() + "<h2>" + esc(e.name) + "</h2>" +
    muted(hasStack ? "Weights come from this machine's stack." : "No stack set up yet. Add one on Machine setup to get a list of weights.") +
    box(esc(sessionLabel(session)) + " for you",
      (withWarmup
        ? weightField("start", "Warm-up") +
          numField("f_warmReps", "Warm-up reps", ownWarmupReps(settings, e.id, key), "default " + warmupReps(settings, e.id, key))
        : muted("No warm-up set for this exercise.")) +
      weightField("work", "Working") +
      cols(numField("f_reps", "Working reps", cfg["reps" + key], "default " + eff["reps" + key]),
           numField("f_sets", "Working sets", cfg["sets" + key], "default " + eff["sets" + key])) +
      muted("The warm-up is optional. Leave reps or sets blank to use the defaults.")) +
    field("f_notes", "Notes (seat height, pad position, etc.)", '<textarea class="field" id="f_notes" rows="3">' + esc(cfg.notes) + "</textarea>") +
    muted("Notes are the same for Heavy and Volume days.") +
    '<button class="primary" id="save">Save</button>';

  wire({
    back: goBack,
    save: () => {
      const patch = { notes: $("f_notes").value };
      for (const kind of withWarmup ? ["start", "work"] : ["work"]) {
        const typed = toNumber($("f_" + kind).value);
        if (!withExtras) { patch[kind + key] = typed; continue; }
        const extra = typed === null ? 0 : Number($("f_" + kind + "Extra").value);
        patch[kind + key] = typed === null ? null : totalWeight(typed, extra);       // the total is what is used
        patch[kind + "Extra" + key] = typed === null || extra === 0 ? null : extra;   // remembered so the split shows again
      }
      if (withWarmup) patch["warmReps" + key] = wholeOrNull($("f_warmReps").value);
      patch["reps" + key] = wholeOrNull($("f_reps").value);
      patch["sets" + key] = wholeOrNull($("f_sets").value);
      saveSettings(updateExercise(settings, e.id, patch));
      go("setup");
    },
  });
}

// ---------- Machine setup: the weights on each machine's stack ----------
// A one-off job done at the gym (it can be repeated for any machine). The saved list of weights
// replaces the step-based weight list for that machine.
const stackMachines = () =>
  exList().filter((e) => e.unit === "lb" && e.kind !== "time" && (e.group === "legs" || e.group === "arms"));

function renderStacks() {
  const all = stackMachines();
  const shown = stackFilter === "all" ? all : all.filter((e) => e.group === stackFilter);
  app.innerHTML =
    backBtn() + "<h2>Machine setup</h2>" +
    muted(all.filter(hasPins).length + " of " + all.length + " machines done. Tap a machine to enter its weights. You can redo any machine later.") +
    '<div class="choices" id="filters" style="margin-top:12px"></div><div id="list"></div>';

  addChoices("filters", [["all", "All"], ["legs", "Legs"], ["arms", "Arms"]].map(([id, label]) => [label, stackFilter === id, () => { stackFilter = id; render(); }]));
  addItems("list", shown.map((e) => [
    (hasPins(e) ? "&#10003; " : "") + esc(e.name) + "<small>" + esc(hasPins(e) ? describePins(e.pins) : "Not set up") + "</small>",
    () => { stackId = e.id; stackPins = hasPins(e) ? [...e.pins] : []; go("stackEdit"); },
  ]));
  wire({ back: goBack });
}

function renderStackEdit() {
  const e = exList().find((x) => x.id === stackId);
  const saved = settings.exercises?.[e.id]?.stackSpec || {};
  const changes = Array.isArray(saved.changes) ? saved.changes : [];

  const stepSelect = (id, chosen, optional) =>
    selectHtml(id, (optional ? '<option value="">None</option>' : "") + optionsHtml(STEP_CHOICES, chosen, (s) => s + " lb"));
  const changeRow = (n) => {
    const c = changes[n - 1] || {};
    return cols(numField("s_at" + n, "From weight (lb)", c.at, "e.g. 100"), field("s_cs" + n, "New step", stepSelect("s_cs" + n, c.step, true)));
  };

  app.innerHTML =
    backBtn("Back without saving") + "<h2>" + esc(e.name) + "</h2>" +
    numField("s_low", "Lowest weight (lb)", saved.low, "e.g. 10") +
    field("s_step", "Step", stepSelect("s_step", saved.step ?? 10, false)) +
    box("Step changes (optional)",
      muted("Use these if the step changes part way up the stack, e.g. from 100 lb the step becomes 15 lb.") + changeRow(1) + changeRow(2)) +
    numField("s_top", "Top weight (lb)", saved.top, "e.g. 150") +
    box("Weights on this machine",
      '<div id="preview"></div><div class="other"><input id="s_add" type="number" inputmode="decimal" step="any" placeholder="Add a weight, e.g. 125"><button id="addBtn">Add weight</button></div>') +
    '<button class="primary" id="save">Save</button>' +
    (hasPins(e) ? '<button class="ghost" id="clear">Clear this machine</button>' : "");

  const readSpec = () => ({
    low: toNumber($("s_low").value),
    step: Number($("s_step").value),
    top: toNumber($("s_top").value),
    changes: [1, 2].map((n) => {
      const step = Number($("s_cs" + n).value);
      return { at: toNumber($("s_at" + n).value), step: step > 0 ? step : null };
    }),
  });

  const drawPreview = (message) => {
    $("preview").innerHTML =
      muted(esc(message)) +
      (stackPins.length ? muted(stackPins.length + " weights. Tap one to remove it.", "small") : "") +
      stackPins.map((w) => '<button class="chip" data-w="' + w + '">' + w + "</button>").join("");
    $("preview").querySelectorAll(".chip").forEach((b) => {
      b.onclick = () => { stackPins = removePin(stackPins, Number(b.dataset.w)); drawPreview("Removed " + b.dataset.w + " lb."); };
    });
  };

  // Typing in the boxes rebuilds the list (this replaces any weights added or removed by hand).
  const rebuild = () => {
    const r = buildPins(readSpec());
    if (r.error) return drawPreview(r.error);
    stackPins = r.pins;
    drawPreview(r.note || "Built from the boxes. Check it against the machine.");
  };
  for (const id of ["s_low", "s_step", "s_at1", "s_cs1", "s_at2", "s_cs2", "s_top"]) {
    $(id).addEventListener("input", rebuild);
    $(id).addEventListener("change", rebuild);
  }
  drawPreview(stackPins.length ? "Saved weights shown below." : "Fill in the boxes to see the weights.");

  wire({
    back: goBack,
    addBtn: () => {
      const w = toNumber($("s_add").value);
      if (w === null) return;
      stackPins = addPin(stackPins, w);
      $("s_add").value = "";
      drawPreview("Added " + w + " lb.");
    },
    save: () => {
      if (stackPins.length === 0) { alert("Fill in the boxes first so there are weights to save."); return; }
      const spec = readSpec();
      saveSettings(updateExercise(settings, e.id, {
        pins: stackPins,
        stackSpec: { low: spec.low, step: spec.step, top: spec.top, changes: spec.changes.filter((c) => c.at !== null && c.step !== null) },
      }));
      go("stacks");
    },
    clear: () => {
      if (!confirm("Remove the saved weights for this machine?")) return;
      saveSettings(updateExercise(settings, e.id, { pins: null, stackSpec: null }));
      go("stacks");
    },
  });
}

// ---------- Backup and restore ----------
// Sends a file, then shows the message for how it went (nothing if the person cancelled).
async function shareFile(kind, text, sentMsg, downloadedMsg, isBackup) {
  const result = await sendFile(backupFileName(kind), text);
  if (result !== "cancelled") {
    if (isBackup) save(KEY.lastBackup, new Date().toISOString());
    backupMsg = result === "shared" ? sentMsg : downloadedMsg;
  }
  render();
}

// Reads a chosen file: a machines file adds machines, a full backup replaces what is on the phone.
async function importFile(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  let text;
  try { text = await file.text(); }
  catch { backupMsg = "That file could not be read."; return render(); }

  const kind = fileKind(text);
  if (kind === "machines") {
    const r = importMachines(store, store.currentGym, text);
    if (r.error) backupMsg = r.error;
    else {
      store = r.store;
      save(KEY.store, store);
      reloadSettings();
      backupMsg = "Added " + r.count + (r.count === 1 ? " machine" : " machines") + " from the file. Your own weights and notes were not changed.";
    }
  } else if (kind === "backup") {
    const r = parseBackup(text);
    if (r.error) backupMsg = r.error;
    else if (!confirm(
      "Restore this backup?\n\nIn the file: " + describeData(dataSummary(r.backup.store, r.backup.sets)) +
      "\nOn this phone now: " + describeData(dataSummary(store, sets)) +
      "\n\nThis replaces what is on this phone."
    )) backupMsg = "Restore cancelled.";
    else {
      save(KEY.beforeRestore, { at: new Date().toISOString(), store, sets });   // a safety copy, in case of a mistake
      save(KEY.store, r.backup.store);
      save(KEY.sets, r.backup.sets);
      alert("Backup restored. The app will now reload.");
      location.reload();
      return;
    }
  } else {
    backupMsg = "That is not a Gym Log file.";
  }
  render();
}

function renderBackup() {
  const age = backupAge(load(KEY.lastBackup, null));
  app.innerHTML =
    backBtn() + "<h2>Backup &amp; restore</h2>" +
    (backupMsg ? '<div class="note">' + esc(backupMsg) + "</div>" : "") +
    box("Back up everything",
      muted("On this phone now: " + esc(describeData(dataSummary(store, sets))) + ".") +
      muted("Last backup: " + age.text + (age.stale ? " (a new backup is due)" : "")) +
      muted("Saves your machines, settings and logged sets to one file. Keep it somewhere safe, such as Files, iCloud Drive or an email to yourself.", "small") +
      '<button class="primary" id="backupNow">Back up now</button>') +
    box("Share machines",
      muted("Machine names and stacks only, with no weights or notes. Family can import this file and then set their own weights.", "small") +
      '<button class="secondary" id="shareMachines">Share machines file</button>') +
    box("Import a file",
      muted("A machines file adds machines and leaves your own settings alone. A full backup replaces what is on this phone.", "small") +
      '<button class="secondary" id="importBtn">Choose a file</button>' +
      '<input type="file" id="importFile" accept=".json,application/json" style="display:none">');
  backupMsg = "";

  wire({
    back: goBack,
    backupNow: () => shareFile("backup", JSON.stringify(makeBackup({ store, sets }), null, 2),
      "Backup sent. Check that you saved it somewhere safe.", "Backup downloaded.", true),
    shareMachines: () => shareFile("machines", exportMachines(store, store.currentGym), "Machines file sent.", "Machines file downloaded."),
    importBtn: () => $("importFile").click(),
  });
  $("importFile").onchange = importFile;
}

armBack();
render();

// Lets the app open with no signal once it has been loaded once (needs https, so not on a plain LAN address).
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});