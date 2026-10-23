import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppSettings, LoaderType, Profile } from '../../shared/types';

const defaults = (): AppSettings => ({
  locale: 'en',
  theme: 'dark',
  gameRoot: path.join(app.getPath('userData'), 'instances'),
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID?.trim() ?? '',
  defaultProfileId: null,
  downloadConcurrency: 6,
  newsEnabled: false,
  telemetryEnabled: false
});

const dataPath = (file: string) => path.join(app.getPath('userData'), file);
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(dataPath(file), 'utf8')) as T;
  } catch {
    return fallback;
  }
}
async function writeJson<T>(file: string, value: T): Promise<void> {
  const target = dataPath(file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temp, target);
}

function validMemory(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(512, Math.min(65536, Math.round(value)));
}

export async function getSettings(): Promise<AppSettings> {
  const saved = await readJson<Partial<AppSettings>>('settings.json', {});
  const base = defaults();
  const locale = saved.locale === 'ar' ? 'ar' : 'en';
  const theme = saved.theme === 'light' ? 'light' : 'dark';
  return {
    ...base,
    ...saved,
    locale,
    theme,
    gameRoot: typeof saved.gameRoot === 'string' && saved.gameRoot.trim() ? path.resolve(saved.gameRoot) : base.gameRoot,
    microsoftClientId: typeof saved.microsoftClientId === 'string' ? saved.microsoftClientId.trim() : base.microsoftClientId,
    defaultProfileId: typeof saved.defaultProfileId === 'string' ? saved.defaultProfileId : null,
    downloadConcurrency: typeof saved.downloadConcurrency === 'number' ? Math.max(1, Math.min(12, Math.round(saved.downloadConcurrency))) : 6,
    newsEnabled: saved.newsEnabled === true,
    telemetryEnabled: false
  };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const existing = await getSettings();
  const next: AppSettings = { ...existing };
  if (patch.locale === 'en' || patch.locale === 'ar') next.locale = patch.locale;
  if (patch.theme === 'dark' || patch.theme === 'light') next.theme = patch.theme;
  if (typeof patch.gameRoot === 'string' && patch.gameRoot.trim()) {
    next.gameRoot = path.resolve(patch.gameRoot.trim());
    await fs.mkdir(next.gameRoot, { recursive: true });
  }
  if (typeof patch.microsoftClientId === 'string') next.microsoftClientId = patch.microsoftClientId.trim().slice(0, 256);
  if (patch.defaultProfileId === null || typeof patch.defaultProfileId === 'string') next.defaultProfileId = patch.defaultProfileId;
  if (typeof patch.downloadConcurrency === 'number' && Number.isFinite(patch.downloadConcurrency)) next.downloadConcurrency = Math.max(1, Math.min(12, Math.round(patch.downloadConcurrency)));
  if (typeof patch.newsEnabled === 'boolean') next.newsEnabled = patch.newsEnabled;
  // Telemetry is intentionally forced off until an explicit, documented service exists.
  next.telemetryEnabled = false;
  await writeJson('settings.json', next);
  return next;
}

export async function getProfiles(): Promise<Profile[]> {
  const profiles = await readJson<Profile[]>('profiles.json', []);
  return Array.isArray(profiles) ? profiles.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string') : [];
}

export async function initializeLocalStore(): Promise<void> {
  const settings = await getSettings();
  await fs.mkdir(settings.gameRoot, { recursive: true });
  let profiles = await getProfiles();
  if (!profiles.length) {
    const now = new Date().toISOString();
    const id = randomUUID();
    profiles = [{
      id,
      name: 'Default Profile',
      versionId: '',
      loader: 'vanilla',
      gameDir: path.join(settings.gameRoot, id),
      javaPath: '',
      minMemoryMb: 1024,
      maxMemoryMb: 4096,
      createdAt: now,
      updatedAt: now
    }];
    await writeJson('profiles.json', profiles);
    await saveSettings({ defaultProfileId: id });
  } else {
    for (const p of profiles) {
      if (!p.gameDir) p.gameDir = path.join(settings.gameRoot, p.id);
      if (!p.loader) p.loader = 'vanilla';
      p.minMemoryMb = validMemory(p.minMemoryMb, 1024);
      p.maxMemoryMb = validMemory(p.maxMemoryMb, 4096);
    }
    await writeJson('profiles.json', profiles);
    if (!settings.defaultProfileId || !profiles.some((p) => p.id === settings.defaultProfileId)) {
      await saveSettings({ defaultProfileId: profiles[0].id });
    }
  }
}

export async function createProfile(nameInput: string): Promise<Profile> {
  const name = String(nameInput ?? '').trim().slice(0, 48);
  if (!name) throw new Error('Enter a profile name.');
  const profiles = await getProfiles();
  if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error('A profile with that name already exists.');
  const settings = await getSettings();
  const now = new Date().toISOString();
  const id = randomUUID();
  const profile: Profile = { id, name, versionId: '', loader: 'vanilla', gameDir: path.join(settings.gameRoot, id), javaPath: '', minMemoryMb: 1024, maxMemoryMb: 4096, createdAt: now, updatedAt: now };
  await fs.mkdir(profile.gameDir, { recursive: true });
  profiles.push(profile);
  await writeJson('profiles.json', profiles);
  if (!settings.defaultProfileId) await saveSettings({ defaultProfileId: id });
  return profile;
}

const profileEditableKeys = new Set(['name', 'versionId', 'loader', 'javaPath', 'minMemoryMb', 'maxMemoryMb']);
export async function updateProfile(id: string, patch: Partial<Pick<Profile, 'name' | 'versionId' | 'loader' | 'javaPath' | 'minMemoryMb' | 'maxMemoryMb'>>): Promise<Profile> {
  const profiles = await getProfiles();
  const profile = profiles.find((p) => p.id === id);
  if (!profile) throw new Error('Profile not found.');
  for (const [key, value] of Object.entries(patch)) {
    if (!profileEditableKeys.has(key)) continue;
    if (key === 'name') {
      const name = typeof value === 'string' ? value.trim().slice(0, 48) : '';
      if (!name) throw new Error('Profile name cannot be empty.');
      if (profiles.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) throw new Error('A profile with that name already exists.');
      profile.name = name;
    } else if (key === 'versionId' && typeof value === 'string') profile.versionId = value.slice(0, 64);
    else if (key === 'loader' && ['vanilla', 'fabric', 'forge', 'neoforge'].includes(String(value))) profile.loader = value as LoaderType;
    else if (key === 'javaPath' && typeof value === 'string') profile.javaPath = value.trim().slice(0, 1024);
    else if (key === 'minMemoryMb') profile.minMemoryMb = validMemory(value, profile.minMemoryMb);
    else if (key === 'maxMemoryMb') profile.maxMemoryMb = validMemory(value, profile.maxMemoryMb);
  }
  if (profile.minMemoryMb > profile.maxMemoryMb) throw new Error('Minimum memory cannot exceed maximum memory.');
  profile.updatedAt = new Date().toISOString();
  await writeJson('profiles.json', profiles);
  return profile;
}

export async function duplicateProfile(id: string): Promise<Profile> {
  const source = (await getProfiles()).find((p) => p.id === id);
  if (!source) throw new Error('Profile not found.');
  const settings = await getSettings();
  const idNew = randomUUID();
  const copy: Profile = { ...source, id: idNew, name: `${source.name} Copy`.slice(0, 48), gameDir: path.join(settings.gameRoot, idNew), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await fs.mkdir(copy.gameDir, { recursive: true });
  const profiles = await getProfiles();
  profiles.push(copy);
  await writeJson('profiles.json', profiles);
  return copy;
}

export async function deleteProfile(id: string): Promise<void> {
  const profiles = await getProfiles();
  if (profiles.length <= 1) throw new Error('Keep at least one profile.');
  const found = profiles.find((p) => p.id === id);
  if (!found) throw new Error('Profile not found.');
  const next = profiles.filter((p) => p.id !== id);
  await writeJson('profiles.json', next);
  const settings = await getSettings();
  if (settings.defaultProfileId === id) await saveSettings({ defaultProfileId: next[0].id });
  // Intentionally preserve the profile's game directory and downloaded data.
}

export async function selectProfile(id: string): Promise<void> {
  const profiles = await getProfiles();
  if (!profiles.some((p) => p.id === id)) throw new Error('Profile not found.');
  await saveSettings({ defaultProfileId: id });
}

export async function getProfile(id: string): Promise<Profile> {
  const profile = (await getProfiles()).find((p) => p.id === id);
  if (!profile) throw new Error('Profile not found.');
  return profile;
}

export async function resolveAllowedProfilePath(id: string): Promise<string> {
  const profile = await getProfile(id);
  const resolved = path.resolve(profile.gameDir);
  if (!path.isAbsolute(resolved)) throw new Error('Invalid profile path.');
  return resolved;
}
