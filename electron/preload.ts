import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, BuildReport, JavaInfo, MinecraftVersion, ModFile, PrimeAPI, Profile, SourceReport, TaskProgress, AccountSummary } from '../shared/types';

const api: PrimeAPI = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch) as Promise<AppSettings>,
  chooseGameRoot: () => ipcRenderer.invoke('folders:choose-game-root') as Promise<string | null>,
  listProfiles: () => ipcRenderer.invoke('profiles:list') as Promise<Profile[]>,
  createProfile: (name) => ipcRenderer.invoke('profiles:create', name) as Promise<Profile>,
  updateProfile: (id, patch) => ipcRenderer.invoke('profiles:update', id, patch) as Promise<Profile>,
  duplicateProfile: (id) => ipcRenderer.invoke('profiles:duplicate', id) as Promise<Profile>,
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id) as Promise<void>,
  selectProfile: (id) => ipcRenderer.invoke('profiles:select', id) as Promise<void>,
  listVersions: (forceRefresh = false) => ipcRenderer.invoke('minecraft:versions', forceRefresh) as Promise<{ versions: MinecraftVersion[]; cached: boolean; error?: string }>,
  listInstalledVersions: (id) => ipcRenderer.invoke('minecraft:installed', id) as Promise<string[]>,
  installVersion: (profileId, versionId) => ipcRenderer.invoke('minecraft:install', profileId, versionId) as Promise<{ ok: boolean; message: string }>,
  launchGame: (id) => ipcRenderer.invoke('minecraft:launch', id) as Promise<{ ok: boolean; message: string }>,
  gameStatus: () => ipcRenderer.invoke('minecraft:status'),
  openGameLog: (id) => ipcRenderer.invoke('minecraft:open-log', id),
  detectJava: () => ipcRenderer.invoke('java:detect') as Promise<JavaInfo[]>,
  chooseJava: () => ipcRenderer.invoke('java:choose') as Promise<JavaInfo | null>,
  getAccount: () => ipcRenderer.invoke('account:get') as Promise<AccountSummary | null>,
  signInMicrosoft: () => ipcRenderer.invoke('account:sign-in') as Promise<AccountSummary>,
  signOut: () => ipcRenderer.invoke('account:sign-out') as Promise<void>,
  listMods: (id) => ipcRenderer.invoke('mods:list', id) as Promise<ModFile[]>,
  importMods: (id) => ipcRenderer.invoke('mods:import', id) as Promise<{ imported: number; names: string[] }>,
  toggleMod: (id, name, enabled) => ipcRenderer.invoke('mods:toggle', id, name, enabled),
  openFolder: (id, kind) => ipcRenderer.invoke('folders:open', id, kind),
  importResources: (id, kind) => ipcRenderer.invoke('resources:import', id, kind) as Promise<{ imported: number; names: string[] }>,
  analyzeModSource: () => ipcRenderer.invoke('source:analyze') as Promise<SourceReport | null>,
  buildModSource: () => ipcRenderer.invoke('source:build') as Promise<BuildReport | null>,
  onTaskProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: TaskProgress) => callback(value);
    ipcRenderer.on('app:progress', listener);
    return () => ipcRenderer.removeListener('app:progress', listener);
  }
};

contextBridge.exposeInMainWorld('prime', api);
