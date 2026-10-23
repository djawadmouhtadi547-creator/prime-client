export type LoaderType = 'vanilla' | 'fabric' | 'forge' | 'neoforge';
export type Locale = 'en' | 'ar';

export interface Profile {
  id: string;
  name: string;
  versionId: string;
  loader: LoaderType;
  gameDir: string;
  javaPath: string;
  minMemoryMb: number;
  maxMemoryMb: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  locale: Locale;
  theme: 'dark' | 'light';
  gameRoot: string;
  microsoftClientId: string;
  defaultProfileId: string | null;
  downloadConcurrency: number;
  newsEnabled: boolean;
  telemetryEnabled: boolean;
}

export interface MinecraftVersion {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
  sha1?: string;
}

export interface AccountSummary {
  name: string;
  uuid: string;
  expiresAt: number;
}

export interface TaskProgress {
  taskId: string;
  phase: string;
  message: string;
  current?: number;
  total?: number;
  done?: boolean;
  error?: string;
}

export interface JavaInfo {
  path: string;
  version: string;
  major: number;
}

export interface ModFile {
  name: string;
  path: string;
  enabled: boolean;
  size: number;
}

export interface SourceReport {
  path: string;
  selectionType: 'file' | 'directory';
  fileCount: number;
  javaCount: number;
  kotlinCount: number;
  hasGradle: boolean;
  wrapperPath: string | null;
  metadataFiles: string[];
  candidateMinecraftVersions: string[];
  candidateLoaders: string[];
  warnings: string[];
}

export interface BuildReport {
  success: boolean;
  projectPath: string;
  jarFiles: string[];
  output: string;
}

export interface PrimeAPI {
  appInfo(): Promise<{ version: string; platform: string; userDataPath: string }>;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  chooseGameRoot(): Promise<string | null>;
  listProfiles(): Promise<Profile[]>;
  createProfile(name: string): Promise<Profile>;
  updateProfile(id: string, patch: Partial<Pick<Profile, 'name' | 'versionId' | 'loader' | 'javaPath' | 'minMemoryMb' | 'maxMemoryMb'>>): Promise<Profile>;
  duplicateProfile(id: string): Promise<Profile>;
  deleteProfile(id: string): Promise<void>;
  selectProfile(id: string): Promise<void>;
  listVersions(forceRefresh?: boolean): Promise<{ versions: MinecraftVersion[]; cached: boolean; error?: string }>;
  listInstalledVersions(profileId: string): Promise<string[]>;
  installVersion(profileId: string, versionId: string): Promise<{ ok: boolean; message: string }>;
  launchGame(profileId: string): Promise<{ ok: boolean; message: string }>;
  gameStatus(): Promise<{ running: boolean; profileId: string | null; pid: number | null }>;
  openGameLog(profileId: string): Promise<void>;
  detectJava(): Promise<JavaInfo[]>;
  chooseJava(): Promise<JavaInfo | null>;
  getAccount(): Promise<AccountSummary | null>;
  signInMicrosoft(): Promise<AccountSummary>;
  signOut(): Promise<void>;
  listMods(profileId: string): Promise<ModFile[]>;
  importMods(profileId: string): Promise<{ imported: number; names: string[] }>;
  toggleMod(profileId: string, name: string, enabled: boolean): Promise<void>;
  openFolder(profileId: string, kind: 'game' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'logs' | 'screenshots'): Promise<void>;
  importResources(profileId: string, kind: 'resourcepacks' | 'shaderpacks'): Promise<{ imported: number; names: string[] }>;
  analyzeModSource(): Promise<SourceReport | null>;
  buildModSource(): Promise<BuildReport | null>;
  onTaskProgress(callback: (progress: TaskProgress) => void): () => void;
}
