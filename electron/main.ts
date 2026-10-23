import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppSettings, TaskProgress } from '../shared/types';
import {
  createProfile, deleteProfile, duplicateProfile, getProfiles, getSettings,
  initializeLocalStore, saveSettings, selectProfile, updateProfile
} from './services/settings';
import { detectJava, validateJava } from './services/java';
import { installMinecraftVersion, launchMinecraft, listInstalledVersions, listVersions, getGameStatus, openLatestGameLog } from './services/minecraft';
import { getAccountSummary, signInMicrosoft, signOutMicrosoft } from './services/microsoft-auth';
import { analyzeModSource, buildModSource, importMods, importResources, listMods, openProfileFolder, toggleMod } from './services/mods';

let mainWindow: BrowserWindow | null = null;
const isValidId = (value: unknown): value is string => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value);
const progress = (task: TaskProgress) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:progress', task);
};
function ensureString(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is invalid.`);
  return value.trim();
}
function handle(channel: string, callback: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => callback(...args));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    title: 'PRIME CLIENT',
    backgroundColor: '#0b0f10',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    const allowed = app.isPackaged
      ? target.startsWith('file://')
      : target.startsWith('http://127.0.0.1:5173') || target.startsWith('http://localhost:5173');
    if (!allowed) event.preventDefault();
  });
  if (process.env.PRIME_CLIENT_DEV_URL && !app.isPackaged) {
    void mainWindow.loadURL(process.env.PRIME_CLIENT_DEV_URL);
  } else if (!app.isPackaged) {
    void mainWindow.loadURL('http://127.0.0.1:5173').catch(() => mainWindow?.loadFile(path.join(__dirname, '../../dist/index.html')));
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerIPC(): void {
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, userDataPath: app.getPath('userData') }));
  handle('settings:get', () => getSettings());
  handle('settings:save', async (patchInput) => {
    if (!patchInput || typeof patchInput !== 'object' || Array.isArray(patchInput)) throw new Error('Settings patch must be an object.');
    const patch = patchInput as Partial<AppSettings>;
    const allowed = ['locale', 'theme', 'microsoftClientId', 'downloadConcurrency', 'newsEnabled'];
    if (Object.keys(patch).some((key) => !allowed.includes(key))) throw new Error('An unsupported setting was provided.');
    return saveSettings(patch);
  });
  handle('profiles:list', () => getProfiles());
  handle('profiles:create', (name) => createProfile(ensureString(name, 'Profile name', 48)));
  handle('profiles:update', (idInput, patchInput) => {
    if (!isValidId(idInput)) throw new Error('Invalid profile ID.');
    if (!patchInput || typeof patchInput !== 'object' || Array.isArray(patchInput)) throw new Error('Profile patch must be an object.');
    const patch = patchInput as Record<string, unknown>;
    const allowed = ['name', 'versionId', 'loader', 'javaPath', 'minMemoryMb', 'maxMemoryMb'];
    if (Object.keys(patch).some((key) => !allowed.includes(key))) throw new Error('Unsupported profile field.');
    if (patch.loader !== undefined && !['vanilla', 'fabric', 'forge', 'neoforge'].includes(String(patch.loader))) throw new Error('Unsupported loader.');
    return updateProfile(idInput, patch as Parameters<typeof updateProfile>[1]);
  });
  handle('profiles:duplicate', (id) => { if (!isValidId(id)) throw new Error('Invalid profile ID.'); return duplicateProfile(id); });
  handle('profiles:delete', async (id) => { if (!isValidId(id)) throw new Error('Invalid profile ID.'); await deleteProfile(id); });
  handle('profiles:select', async (id) => { if (!isValidId(id)) throw new Error('Invalid profile ID.'); await selectProfile(id); });
  handle('minecraft:versions', (forceRefresh) => listVersions(forceRefresh === true));
  handle('minecraft:installed', (id) => { if (!isValidId(id)) throw new Error('Invalid profile ID.'); return listInstalledVersions(id); });
  handle('minecraft:install', async (profileId, versionId) => {
    if (!isValidId(profileId)) throw new Error('Invalid profile ID.');
    const version = ensureString(versionId, 'Minecraft version', 100);
    await installMinecraftVersion(profileId, version, progress);
    return { ok: true, message: `Minecraft ${version} installed successfully.` };
  });
  handle('minecraft:launch', async (id) => {
    if (!isValidId(id)) throw new Error('Invalid profile ID.');
    const result = await launchMinecraft(id, progress);
    return { ok: true, message: `Minecraft started with process ID ${result.pid}.` };
  });
  handle('minecraft:status', () => getGameStatus());
  handle('minecraft:open-log', async (id) => {
    if (!isValidId(id)) throw new Error('Invalid profile ID.');
    const log = await openLatestGameLog(id);
    if (!log) throw new Error('No PRIME CLIENT launch log exists for this profile yet.');
    const error = await shell.openPath(log);
    if (error) throw new Error(error);
  });
  handle('java:detect', () => detectJava());
  handle('java:choose', async () => {
    const filters = process.platform === 'win32' ? [{ name: 'Java executable', extensions: ['exe'] }] : [{ name: 'Executable', extensions: ['*'] }];
    const result = await dialog.showOpenDialog({ title: 'Choose Java executable', properties: ['openFile'], filters });
    if (result.canceled || !result.filePaths[0]) return null;
    const info = await validateJava(result.filePaths[0]);
    const selected = await getSettings();
    const profileId = selected.defaultProfileId;
    if (profileId) await updateProfile(profileId, { javaPath: info.path });
    return info;
  });
  handle('account:get', () => getAccountSummary());
  handle('account:sign-in', async () => {
    const settings = await getSettings();
    return signInMicrosoft(settings.microsoftClientId);
  });
  handle('account:sign-out', () => signOutMicrosoft());
  handle('mods:list', (id) => { if (!isValidId(id)) throw new Error('Invalid profile ID.'); return listMods(id); });
  handle('mods:import', (id) => { if (!isValidId(id)) throw new Error('Invalid profile ID.'); return importMods(id); });
  handle('mods:toggle', async (id, nameInput, enabled) => {
    if (!isValidId(id)) throw new Error('Invalid profile ID.');
    const name = ensureString(nameInput, 'Mod filename', 256);
    if (typeof enabled !== 'boolean') throw new Error('Mod state is invalid.');
    await toggleMod(id, name, enabled);
  });
  handle('folders:open', async (id, kind) => {
    if (!isValidId(id)) throw new Error('Invalid profile ID.');
    if (!['game', 'mods', 'resourcepacks', 'shaderpacks', 'logs', 'screenshots'].includes(String(kind))) throw new Error('Unsupported folder.');
    await openProfileFolder(id, kind as Parameters<typeof openProfileFolder>[1]);
  });
  handle('resources:import', (id, kind) => {
    if (!isValidId(id)) throw new Error('Invalid profile ID.');
    if (kind !== 'resourcepacks' && kind !== 'shaderpacks') throw new Error('Unsupported pack type.');
    return importResources(id, kind);
  });
  handle('source:analyze', () => analyzeModSource());
  handle('source:build', async () => {
    if (!mainWindow) throw new Error('The app window is not available.');
    return buildModSource(progress);
  });
  handle('folders:choose-game-root', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose PRIME CLIENT game storage folder', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const settings = await saveSettings({ gameRoot: result.filePaths[0] });
    return settings.gameRoot;
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('dev.djawad1.primeclient');
  await initializeLocalStore();
  registerIPC();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  dialog.showErrorBox('PRIME CLIENT startup failed', message);
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  // Do not kill a running Minecraft process when the launcher window closes.
  void fs.mkdir(app.getPath('userData'), { recursive: true });
});

