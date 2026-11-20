// What the app's two windows (sign-in, log) may ask of it; nothing else of Electron reaches them.
// A sandboxed preload is CommonJS: require is the only way in.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jobrx", {
  /** Signs in; resolves to an error message, or null once signed in (the window then closes). */
  signIn: (email, password) => ipcRenderer.invoke("sign-in", email, password),
  /** The runner's log so far. */
  log: () => ipcRenderer.invoke("log"),
  /** Each new log line. */
  onLog: (listener) => ipcRenderer.on("log", (_e, line) => listener(line)),
  /** Opens a page of the web app in your browser. */
  openApp: (where) => ipcRenderer.invoke("open-app", where),
});
