// Jobrx for the desktop: the apply runner (workers/apply.ts) in your menu bar (the tray on Windows). It signs you in
// with a window of its own, starts the runner and starts it again when it restarts, says in its menu what's open,
// tells you when a form is ready for you, and checks GitHub for a newer version (installed by you, for now).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, shell, Tray, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from "electron";
import { RESTART_EXIT } from "../../workers/apply-update";
import { SIGNED_OUT_EXIT, type AppMessage, type RunnerMessage, type WaitingForm } from "../../workers/runner-messages";

declare const __BUILD_SHA__: string;
declare const __BUILD_MESSAGE__: string;

/** The web app (where the runner asks Claude, and where Open Jobrx goes); JOBRX_APP_URL points it elsewhere. */
const APP_URL = process.env.JOBRX_APP_URL ?? "https://jobrx.ai";
/** Where new versions are published (GitHub Releases tagged desktop-v1.2.3). */
const RELEASES = "https://api.github.com/repos/henrymalik19/jobrx/releases?per_page=20";
const TAG_PREFIX = "desktop-v";
/** How often it looks for a newer version. */
const UPDATE_CHECK_MS = 6 * 60 * 60_000;
/** More runner restarts than this in 10 minutes means something is wrong: it stops and says so. */
const MAX_RESTARTS = 3;
/** How much of the runner's log the Log window keeps. */
const LOG_LINES = 1000;

/** The runner's own folder: your session, its Chrome profile (your sign-ins on job sites), its run records. */
const dataDir = () => path.join(app.getPath("userData"), "runner");
const sessionFile = () => path.join(dataDir(), "apply-session.json");
/** The runner's session in that file (the same key the runner uses). */
const STORAGE_KEY = "apply-runner";

type Config = { supabaseUrl: string; supabaseAnonKey: string };
/** This app's own settings. */
type Settings = { linkedin: boolean; openAtLoginSet: boolean };
/** What the runner is doing, for the menu. */
type Phase =
  | { kind: "starting" }
  | { kind: "running"; state: Extract<RunnerMessage, { type: "state" }> | null }
  | { kind: "signed_out" }
  | { kind: "stopped" }
  | { kind: "failed"; why: string };
type Update = { version: string; url: string; file: string };

let tray: Tray | null = null;
let runner: UtilityProcess | null = null;
let phase: Phase = { kind: "starting" };
let config: Config | null = null;
let settings: Settings = { linkedin: true, openAtLoginSet: false };
let update: Update | null = null;
let downloading = false;
let quitting = false;
/** Set when the runner is stopped on purpose (Stop, Sign out, an update), so its exit isn't a failure. */
let stopReason: "stop" | "sign_out" | "linkedin" | null = null;
const restarts: number[] = [];
/** Whether its stopping has been notified (once, until it runs again). */
let failureSaid = false;
const logLines: string[] = [];
let signInWindow: BrowserWindow | null = null;
let logWindow: BrowserWindow | null = null;

// ---- Settings and the database's address ------------------------------------------------------------------

async function readJson<T>(file: string): Promise<T | null> {
  return readFile(file, "utf8").then((t) => JSON.parse(t) as T, () => null);
}

async function saveSettings() {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(path.join(app.getPath("userData"), "settings.json"), JSON.stringify(settings, null, 2));
}

/** The database's public address and key, from the web app (kept, for when it can't be reached). */
async function loadConfig(): Promise<Config> {
  const file = path.join(app.getPath("userData"), "config.json");
  try {
    const res = await net.fetch(`${APP_URL}/api/runner/config`);
    if (res.ok) {
      const fresh = (await res.json()) as Config;
      if (fresh.supabaseUrl && fresh.supabaseAnonKey) {
        await writeFile(file, JSON.stringify(fresh));
        return fresh;
      }
    }
  } catch {
    // Offline: the copy from last time.
  }
  const kept = await readJson<Config>(file);
  if (!kept) throw new Error(`couldn't reach ${APP_URL} to find the database`);
  return kept;
}

// ---- Signing in -------------------------------------------------------------------------------------------

/** The runner's session file as Supabase's auth storage (the same format the runner reads). */
function fileStorage() {
  const read = async (): Promise<Record<string, string>> => (await readJson<Record<string, string>>(sessionFile())) ?? {};
  return {
    getItem: async (key: string) => (await read())[key] ?? null,
    setItem: async (key: string, value: string) => {
      await mkdir(dataDir(), { recursive: true });
      await writeFile(sessionFile(), JSON.stringify({ ...(await read()), [key]: value }), { mode: 0o600 });
    },
    removeItem: async (key: string) => {
      const all = await read();
      delete all[key];
      await writeFile(sessionFile(), JSON.stringify(all), { mode: 0o600 });
    },
  };
}

const hasSession = async () => !!(await readJson<Record<string, string>>(sessionFile()))?.[STORAGE_KEY];

/**
 * Signs in and leaves the session for the runner. Only the runner keeps it fresh: two copies refreshing the same
 * session would sign each other out, so this one never refreshes and is dropped right away.
 */
async function signIn(email: string, password: string): Promise<string | null> {
  if (!config) return "Jobrx couldn't be reached. Check your connection and try again.";
  const db = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { storage: fileStorage(), storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
  return error ? error.message : null;
}

function showSignIn() {
  if (signInWindow) return signInWindow.focus();
  addLog("not signed in: asking you to sign in");
  signInWindow = new BrowserWindow({
    width: 380,
    height: 440,
    resizable: false,
    title: "Sign in to Jobrx",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  signInWindow.removeMenu();
  signInWindow.once("ready-to-show", () => signInWindow?.show());
  signInWindow.on("closed", () => (signInWindow = null));
  void signInWindow.loadFile(path.join(__dirname, "signin.html"));
  if (process.platform === "darwin") app.dock?.show().catch(() => undefined);
}

// ---- The runner -------------------------------------------------------------------------------------------

function addLog(text: string) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    logLines.push(line);
    logWindow?.webContents.send("log", line);
    // Run from the folder (npm start), or with JOBRX_DEBUG=1, it's in the terminal too.
    if (!app.isPackaged || process.env.JOBRX_DEBUG) console.log(line);
  }
  if (logLines.length > LOG_LINES) logLines.splice(0, logLines.length - LOG_LINES);
}

const tellRunner = (message: AppMessage) => runner?.postMessage(message);

function notifyForm(form: WaitingForm) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: "Ready for you to submit", body: `${form.title} at ${form.company}` });
  n.on("click", () => tellRunner({ type: "focus", id: form.id }));
  n.show();
}

function onMessage(message: RunnerMessage) {
  if (message.type === "log") addLog(message.line);
  else if (message.type === "state") {
    phase = { kind: "running", state: message };
    failureSaid = false;
    refreshMenu();
  } else if (message.type === "waiting") notifyForm(message.form);
  else if (message.type === "notice" && Notification.isSupported()) new Notification({ title: message.title, body: message.body }).show();
}

async function startRunner() {
  if (runner || quitting) return;
  if (!(await hasSession())) {
    phase = { kind: "signed_out" };
    refreshMenu();
    return showSignIn();
  }
  if (!config) return;
  phase = { kind: "starting" };
  stopReason = null;
  refreshMenu();
  await mkdir(dataDir(), { recursive: true });
  const child = utilityProcess.fork(path.join(__dirname, "runner.cjs"), [], {
    serviceName: "Jobrx runner",
    stdio: "pipe",
    cwd: dataDir(),
    env: {
      ...process.env,
      JOBRX_DESKTOP: "1",
      JOBRX_DATA_DIR: dataDir(),
      JOBRX_VERSION: __BUILD_SHA__,
      JOBRX_VERSION_MESSAGE: __BUILD_MESSAGE__,
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_ANON_KEY: config.supabaseAnonKey,
      APPLY_APP_URL: APP_URL,
      APPLY_LINKEDIN: settings.linkedin ? "1" : "0",
    },
  });
  runner = child;
  child.stdout?.on("data", (d: Buffer) => addLog(String(d)));
  child.stderr?.on("data", (d: Buffer) => addLog(String(d)));
  child.on("message", (m: RunnerMessage) => onMessage(m));
  child.on("exit", (code) => void onExit(code));
}

async function onExit(code: number) {
  runner = null;
  const why = stopReason;
  stopReason = null;
  if (quitting) return app.quit();
  if (code === SIGNED_OUT_EXIT || why === "sign_out") {
    phase = { kind: "signed_out" };
    refreshMenu();
    return showSignIn();
  }
  if (why === "stop") {
    phase = { kind: "stopped" };
    return refreshMenu();
  }
  if (code === RESTART_EXIT || why === "linkedin") return void startRunner();
  // Anything else is a failure: started again a few times, then left for you.
  const now = Date.now();
  restarts.push(now);
  const lastLine = logLines.at(-1) ?? `exited with ${code}`;
  if (restarts.filter((t) => t > now - 10 * 60_000).length > MAX_RESTARTS) {
    // Said once; then tried every 5 minutes (it may be offline), or now from Start.
    if (!failureSaid && Notification.isSupported()) new Notification({ title: "The Jobrx runner stopped", body: lastLine }).show();
    failureSaid = true;
    phase = { kind: "failed", why: lastLine };
    refreshMenu();
    setTimeout(() => phase.kind === "failed" && void startRunner(), 5 * 60_000);
    return;
  }
  addLog(`runner exited (${code}); starting it again in 10 seconds`);
  phase = { kind: "starting" };
  refreshMenu();
  setTimeout(() => void startRunner(), 10_000);
}

/** Asks the runner to stop (it hands back what's open first), waiting at most 30 seconds. */
function stopRunner(reason: NonNullable<typeof stopReason>): Promise<void> {
  const child = runner;
  if (!child) return Promise.resolve();
  stopReason = reason;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 30_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.postMessage({ type: "stop" } satisfies AppMessage);
  });
}

/** How many forms are open (being filled or waiting for you). */
function openForms(): number {
  if (phase.kind !== "running" || !phase.state) return 0;
  return phase.state.filling + phase.state.waiting.length;
}

/** Asks first when stopping would hand back open forms (to Runner stuck). */
async function okToStop(what: string): Promise<boolean> {
  const n = openForms();
  if (!n) return true;
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: [what, "Cancel"],
    defaultId: 1,
    message: `${n === 1 ? "A form is" : `${n} forms are`} open`,
    detail: "They move to Runner stuck in Jobrx, where you can retry them.",
  });
  return response === 0;
}

async function signOut() {
  if (!(await okToStop("Sign out"))) return;
  await stopRunner("sign_out");
  await rm(sessionFile(), { force: true });
  phase = { kind: "signed_out" };
  refreshMenu();
  showSignIn();
}

// ---- Updates ----------------------------------------------------------------------------------------------

/** Whether version a is newer than b (1.2.10 > 1.2.9). */
function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/** This computer's installer in a release: the Mac's disk image for its chip, or the Windows setup. */
function installerFor(assets: { name: string; browser_download_url: string }[]) {
  const wanted = process.platform === "darwin" ? (n: string) => n.endsWith(`-${process.arch}.dmg`) : (n: string) => n.endsWith(".exe");
  return assets.find((a) => wanted(a.name)) ?? null;
}

async function checkForUpdate(manual = false) {
  try {
    const res = await net.fetch(RELEASES, { headers: { accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const releases = (await res.json()) as { tag_name: string; draft: boolean; prerelease: boolean; assets: { name: string; browser_download_url: string }[] }[];
    const latest = releases.find((r) => r.tag_name.startsWith(TAG_PREFIX) && !r.draft && !r.prerelease && installerFor(r.assets));
    const version = latest?.tag_name.slice(TAG_PREFIX.length);
    const asset = latest && installerFor(latest.assets);
    if (latest && version && asset && newer(version, app.getVersion())) {
      const first = update?.version !== version;
      update = { version, url: asset.browser_download_url, file: asset.name };
      refreshMenu();
      if (first && Notification.isSupported()) {
        const n = new Notification({ title: `Jobrx ${version} is available`, body: "Choose Install update in the Jobrx menu." });
        n.on("click", () => void installUpdate());
        n.show();
      }
    } else if (manual) {
      await dialog.showMessageBox({ message: "Jobrx is up to date", detail: `You have version ${app.getVersion()}.` });
    }
  } catch (err) {
    if (manual) await dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates", detail: (err as Error).message });
  }
}

/**
 * Downloads the new version and opens it: on Windows the installer replaces this version; on a Mac you drag it
 * into Applications. Either way this one quits first (the runner hands back what's open).
 */
async function installUpdate() {
  if (!update || downloading) return;
  const u = update;
  const mac = process.platform === "darwin";
  const { response } = await dialog.showMessageBox({
    type: "info",
    buttons: ["Download and install", "Not now"],
    defaultId: 0,
    message: `Install Jobrx ${u.version}?`,
    detail:
      (mac
        ? "Jobrx downloads it, opens it and quits. In the window that opens, drag Jobrx into Applications (Replace), then open it again."
        : "Jobrx downloads it, quits and runs the installer, which opens the new version when it's done.") +
      (openForms() ? "\n\nOpen forms move to Runner stuck in Jobrx, where you can retry them." : ""),
  });
  if (response !== 0) return;
  downloading = true;
  refreshMenu();
  try {
    const res = await net.fetch(u.url);
    if (!res.ok) throw new Error(`the download answered ${res.status}`);
    const file = path.join(app.getPath("downloads"), u.file);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    await stopRunner("stop");
    const failed = await shell.openPath(file);
    if (failed) throw new Error(failed);
    quitting = true;
    app.quit();
  } catch (err) {
    downloading = false;
    refreshMenu();
    await dialog.showMessageBox({ type: "warning", message: "Couldn't install the update", detail: (err as Error).message });
    if (!runner) void startRunner();
  }
}

// ---- The menu ---------------------------------------------------------------------------------------------

function statusLine(): string {
  switch (phase.kind) {
    case "starting":
      return "Starting…";
    case "signed_out":
      return "Signed out";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Stopped: something went wrong (see Log)";
    case "running": {
      const s = phase.state;
      if (!s) return "Running";
      if (s.updating) return "Restarting once what's open is done";
      const parts = [s.filling ? `filling ${s.filling}` : "", s.waiting.length ? `${s.waiting.length} waiting for you` : ""].filter(Boolean);
      return `${s.paused ? "Paused" : "Running"}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
    }
  }
}

function showLog() {
  if (logWindow) return logWindow.focus();
  logWindow = new BrowserWindow({
    width: 760,
    height: 520,
    title: "Jobrx runner log",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  logWindow.removeMenu();
  logWindow.on("closed", () => (logWindow = null));
  void logWindow.loadFile(path.join(__dirname, "log.html"));
}

function refreshMenu() {
  if (!tray) return;
  const running = phase.kind === "running" ? phase.state : null;
  const items: MenuItemConstructorOptions[] = [
    { label: statusLine(), enabled: false },
    ...(running?.waiting.length
      ? [
          { type: "separator" as const },
          { label: "Waiting for you", enabled: false },
          ...running.waiting.map((f) => ({ label: `${f.company}: ${f.title}`.slice(0, 70), click: () => tellRunner({ type: "focus", id: f.id }) })),
        ]
      : []),
    { type: "separator" },
    phase.kind === "running"
      ? { label: running?.paused ? "Resume" : "Pause", click: () => tellRunner({ type: "pause", paused: !running?.paused }) }
      : phase.kind === "signed_out"
        ? { label: "Sign in…", click: showSignIn }
        : phase.kind === "starting"
          ? { label: "Start", enabled: false }
          : { label: "Start", click: () => void (config ? startRunner() : boot()) },
    { label: "Open Jobrx", click: () => void shell.openExternal(`${APP_URL}/app/applying`) },
    { label: "Show log", click: showLog },
    { type: "separator" },
    {
      label: "LinkedIn Easy Apply",
      type: "checkbox",
      checked: settings.linkedin,
      click: async (item) => {
        // The runner reads it when it starts: it's started again (once what's open is handed back).
        if (runner && !(await okToStop("Restart the runner"))) return refreshMenu();
        settings.linkedin = item.checked;
        await saveSettings();
        if (runner) await stopRunner("linkedin");
        else void startRunner();
      },
    },
    {
      label: process.platform === "darwin" ? "Open at login" : "Start with Windows",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    update
      ? { label: downloading ? `Downloading ${update.version}…` : `Install update (${update.version})…`, enabled: !downloading, click: () => void installUpdate() }
      : { label: "Check for updates", click: () => void checkForUpdate(true) },
    ...(phase.kind === "running" || phase.kind === "starting"
      ? [{ label: "Stop runner", click: async () => (await okToStop("Stop")) && void stopRunner("stop") }]
      : []),
    ...(phase.kind !== "signed_out" ? [{ label: "Sign out", click: () => void signOut() }] : []),
    { type: "separator" },
    { label: `Jobrx ${app.getVersion()}`, enabled: false },
    { label: "Quit Jobrx", click: async () => (await okToStop("Quit")) && app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(`Jobrx: ${statusLine()}`);
}

// ---- Start ------------------------------------------------------------------------------------------------

// A folder of its own for trying it out (JOBRX_USER_DATA), apart from the installed app's.
if (process.env.JOBRX_USER_DATA) app.setPath("userData", path.resolve(process.env.JOBRX_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId("ai.jobrx.desktop");
  // A second launch (opening it again from Applications) shows what this one is doing.
  app.on("second-instance", () => (phase.kind === "signed_out" ? showSignIn() : showLog()));
  // It lives in the menu bar: closing its windows doesn't quit it.
  app.on("window-all-closed", () => {
    if (process.platform === "darwin") app.dock?.hide();
  });
  app.on("before-quit", (e) => {
    if (!runner) return;
    // The runner hands back what's open first; quitting goes on once it has exited.
    e.preventDefault();
    if (quitting) return;
    quitting = true;
    void stopRunner("stop");
  });

  ipcMain.handle("sign-in", async (_e, email: string, password: string) => {
    const failed = await signIn(email, password);
    if (!failed) {
      signInWindow?.close();
      void startRunner();
    }
    return failed;
  });
  ipcMain.handle("log", () => logLines);
  ipcMain.handle("open-app", (_e, where: string) => shell.openExternal(`${APP_URL}${where.startsWith("/") ? where : "/"}`));

  void app.whenReady().then(async () => {
    if (process.platform === "darwin") app.dock?.hide();
    settings = { ...settings, ...(await readJson<Partial<Settings>>(path.join(app.getPath("userData"), "settings.json"))) };
    // Opens at login from the first run on (the menu turns it off).
    if (app.isPackaged && !settings.openAtLoginSet) {
      app.setLoginItemSettings({ openAtLogin: true });
      settings.openAtLoginSet = true;
      await saveSettings();
    }
    const icon = nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 18, height: 18 });
    tray = new Tray(icon);
    // Windows opens a tray icon's menu on right-click only; a click opens it too.
    if (process.platform === "win32") tray.on("click", () => tray?.popUpContextMenu());
    refreshMenu();
    void checkForUpdate();
    setInterval(() => void checkForUpdate(), UPDATE_CHECK_MS);
    await boot();
  });
}

/** Finds the database and starts the runner; offline at login, it tries again every minute. */
async function boot() {
  try {
    config = await loadConfig();
  } catch (err) {
    phase = { kind: "failed", why: (err as Error).message };
    addLog(`${(err as Error).message}; trying again in a minute`);
    refreshMenu();
    setTimeout(() => void boot(), 60_000);
    return;
  }
  await startRunner();
}
