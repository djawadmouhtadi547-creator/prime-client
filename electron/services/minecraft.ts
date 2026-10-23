import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import extractZip from 'extract-zip';
import type { MinecraftVersion, Profile, TaskProgress } from '../../shared/types';
import { getProfile, getProfiles, getSettings } from './settings';
import { detectJava, validateJava } from './java';
import { getValidMinecraftSession } from './microsoft-auth';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const USER_AGENT = 'PRIME-CLIENT/1.0.0 (by djawad1)';
const running = new Map<string, { process: ChildProcess; pid: number | null; logPath: string }>();
type Rule = { action: 'allow' | 'disallow'; os?: { name?: string; arch?: string; version?: string }; features?: Record<string, boolean> };
type DownloadInfo = { url: string; sha1?: string; size?: number; path?: string };
type Library = { name: string; url?: string; rules?: Rule[]; downloads?: { artifact?: DownloadInfo; classifiers?: Record<string, DownloadInfo> }; natives?: Record<string, string> };
type VersionInfo = {
  id: string; type?: string; mainClass: string; javaVersion?: { component?: string; majorVersion?: number };
  downloads?: { client?: DownloadInfo }; libraries?: Library[];
  assetIndex?: { id: string; url: string; sha1?: string; size?: number; totalSize?: number }; assets?: string;
  arguments?: { game?: Array<string | { rules?: Rule[]; value: string | string[] }>; jvm?: Array<string | { rules?: Rule[]; value: string | string[] }> };
  minecraftArguments?: string;
  logging?: { client?: { argument?: string; file?: DownloadInfo } };
};
type Manifest = { latest: { release: string; snapshot: string }; versions: MinecraftVersion[] };

function emit(progress: (p: TaskProgress) => void, taskId: string, phase: string, message: string, current?: number, total?: number, extra: Partial<TaskProgress> = {}) {
  progress({ taskId, phase, message, current, total, ...extra });
}
function safeVersionId(input: string): string {
  if (!/^[\w.-]{1,100}$/.test(input)) throw new Error('Invalid Minecraft version identifier.');
  return input;
}
function hash(data: Buffer): string { return createHash('sha1').update(data).digest('hex'); }
function assertHttps(value: string): void {
  if (new URL(value).protocol !== 'https:') throw new Error('Blocked a non-HTTPS download URL.');
}
async function fetchBuffer(url: string): Promise<Buffer> {
  assertHttps(url);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (response.url) assertHttps(response.url);
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}) from ${new URL(url).host}.`);
  return Buffer.from(await response.arrayBuffer());
}
async function fetchJson<T>(url: string): Promise<T> {
  const buffer = await fetchBuffer(url);
  try { return JSON.parse(buffer.toString('utf8')) as T; }
  catch { throw new Error(`Invalid JSON returned by ${new URL(url).host}.`); }
}
async function atomicWrite(target: string, data: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, target);
}
function safeJoin(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const rel = path.relative(path.resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('An official metadata path resolved outside the game directory.');
  return target;
}
async function downloadVerified(info: DownloadInfo, target: string): Promise<void> {
  if (!info.url) throw new Error(`Missing download URL for ${path.basename(target)}.`);
  try {
    const existing = await fs.readFile(target);
    if (!info.sha1 || hash(existing).toLowerCase() === info.sha1.toLowerCase()) {
      if (!info.size || info.size === existing.length) return;
    }
  } catch { /* download below */ }
  const data = await fetchBuffer(info.url);
  if (info.sha1 && hash(data).toLowerCase() !== info.sha1.toLowerCase()) throw new Error(`SHA-1 verification failed for ${path.basename(target)}.`);
  if (info.size && info.size !== data.length) throw new Error(`File size verification failed for ${path.basename(target)}.`);
  await atomicWrite(target, data);
}

export async function listVersions(forceRefresh = false): Promise<{ versions: MinecraftVersion[]; cached: boolean; error?: string }> {
  const cachePath = path.join(app.getPath('userData'), 'version-manifest-cache.json');
  if (!forceRefresh) {
    try {
      const cache = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Manifest;
      if (Array.isArray(cache.versions) && cache.versions.length) return { versions: cache.versions, cached: true };
    } catch { /* cache miss */ }
  }
  try {
    const manifest = await fetchJson<Manifest>(MANIFEST_URL);
    if (!Array.isArray(manifest.versions) || !manifest.versions.length) throw new Error('The official Mojang manifest contains no versions.');
    await atomicWrite(cachePath, JSON.stringify(manifest, null, 2));
    return { versions: manifest.versions, cached: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed.';
    try {
      const cache = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Manifest;
      if (Array.isArray(cache.versions) && cache.versions.length) return { versions: cache.versions, cached: true, error: message };
    } catch { /* no usable cache */ }
    return { versions: [], cached: false, error: message };
  }
}
function osName(): string { return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'; }
function osArch(): string { return process.arch === 'x64' ? 'x86_64' : process.arch === 'ia32' ? 'x86' : process.arch; }
function rulesAllow(rules?: Rule[]): boolean {
  if (!rules?.length) return true;
  let allowed = false;
  for (const rule of rules) {
    let matches = true;
    if (rule.os?.name && rule.os.name !== osName()) matches = false;
    if (rule.os?.arch && osArch() !== rule.os.arch) matches = false;
    if (rule.os?.version) {
      const version = process.platform === 'win32' ? app.getSystemVersion() : process.platform;
      try { if (!new RegExp(rule.os.version).test(version)) matches = false; } catch { matches = false; }
    }
    if (rule.features && Object.values(rule.features).some(Boolean)) matches = false;
    if (matches) allowed = rule.action === 'allow';
  }
  return allowed;
}
function mavenPath(coordinate: string): string {
  const [group, artifact, version, classifier] = coordinate.split(':');
  if (!group || !artifact || !version) throw new Error(`Unsupported Maven library coordinate: ${coordinate}`);
  return `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`;
}
function nativeClassifier(library: Library): string | null {
  const template = library.natives?.[osName()];
  if (!template) return null;
  const arch = process.arch === 'x64' ? '64' : process.arch === 'ia32' ? '32' : process.arch === 'arm64' ? 'arm64' : '64';
  return template.replaceAll('${arch}', arch);
}
async function copyNativeFiles(source: string, target: string, relative = ''): Promise<void> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(relative, entry.name);
    const normalized = rel.replaceAll('\\', '/').toUpperCase();
    if (normalized === 'META-INF' || normalized.startsWith('META-INF/')) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, rel);
    if (entry.isDirectory()) await copyNativeFiles(from, target, rel);
    else { await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to); }
  }
}
async function downloadLibraries(libraries: Library[], root: string, versionDir: string, progress: (p: TaskProgress) => void, taskId: string): Promise<void> {
  const selected = libraries.filter((library) => rulesAllow(library.rules));
  const natives: string[] = [];
  for (let i = 0; i < selected.length; i++) {
    const library = selected[i];
    const artifact = library.downloads?.artifact;
    if (artifact?.path && artifact.url) {
      await downloadVerified(artifact, safeJoin(path.join(root, 'libraries'), artifact.path));
    } else if (library.name && !library.natives) {
      const relative = mavenPath(library.name);
      const base = library.url ?? 'https://libraries.minecraft.net/';
      const url = new URL(relative, base.endsWith('/') ? base : `${base}/`).toString();
      await downloadVerified({ url }, safeJoin(path.join(root, 'libraries'), relative));
    }
    const classifier = nativeClassifier(library);
    const nativeArtifact = classifier ? library.downloads?.classifiers?.[classifier] : undefined;
    if (nativeArtifact?.path && nativeArtifact.url) {
      const nativePath = safeJoin(path.join(root, 'libraries'), nativeArtifact.path);
      await downloadVerified(nativeArtifact, nativePath);
      natives.push(nativePath);
    }
    emit(progress, taskId, 'libraries', `Preparing libraries (${i + 1}/${selected.length})`, i + 1, selected.length);
  }
  const nativeDir = path.join(versionDir, 'natives');
  await fs.mkdir(nativeDir, { recursive: true });
  for (const nativeJar of natives) {
    const temporary = path.join(versionDir, `.native-${randomUUID()}`);
    await fs.mkdir(temporary, { recursive: true });
    try {
      await extractZip(nativeJar, { dir: temporary });
      await copyNativeFiles(temporary, nativeDir);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }
}
async function downloadAssets(info: VersionInfo, root: string, progress: (p: TaskProgress) => void, taskId: string): Promise<void> {
  if (!info.assetIndex?.url || !info.assetIndex.id) return;
  const assetsRoot = path.join(root, 'assets');
  const indexTarget = path.join(assetsRoot, 'indexes', `${info.assetIndex.id}.json`);
  await downloadVerified({ url: info.assetIndex.url, sha1: info.assetIndex.sha1, size: info.assetIndex.size }, indexTarget);
  const index = JSON.parse(await fs.readFile(indexTarget, 'utf8')) as { objects?: Record<string, { hash: string; size?: number }> };
  const objects = Object.values(index.objects ?? {});
  const settings = await getSettings();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < objects.length) {
      const item = objects[next++];
      if (!/^[a-f0-9]{40}$/i.test(item.hash)) throw new Error('Invalid asset hash in version metadata.');
      const target = path.join(assetsRoot, 'objects', item.hash.slice(0, 2), item.hash);
      await downloadVerified({ url: `https://resources.download.minecraft.net/${item.hash.slice(0, 2)}/${item.hash}`, sha1: item.hash, size: item.size }, target);
      done++;
      if (done % 25 === 0 || done === objects.length) emit(progress, taskId, 'assets', `Downloading assets (${done}/${objects.length})`, done, objects.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(settings.downloadConcurrency, Math.max(1, objects.length)) }, worker));
}

export async function listInstalledVersions(profileId: string): Promise<string[]> {
  const profile = await getProfile(profileId);
  const folder = path.join(profile.gameDir, 'versions');
  const installed: string[] = [];
  try {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[\w.-]{1,100}$/.test(entry.name)) continue;
      try { await fs.access(path.join(folder, entry.name, `${entry.name}.json`)); await fs.access(path.join(folder, entry.name, `${entry.name}.jar`)); await fs.access(path.join(folder, entry.name, '.prime-install-complete')); installed.push(entry.name); } catch { /* incomplete or unmanaged install */ }
    }
  } catch { /* no versions directory yet */ }
  return installed.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

export async function installMinecraftVersion(profileId: string, inputId: string, progress: (p: TaskProgress) => void): Promise<void> {
  const id = safeVersionId(inputId);
  const profile = await getProfile(profileId);
  if (profile.loader !== 'vanilla') throw new Error('This build installs vanilla versions only; Fabric, Forge, and NeoForge require dedicated installers.');
  const catalog = await listVersions(false);
  const entry = catalog.versions.find((version) => version.id === id);
  if (!entry) throw new Error(`Minecraft version ${id} was not found in the official manifest. Refresh the catalog and try again.`);
  const taskId = `install-${randomUUID()}`;
  const root = path.resolve(profile.gameDir);
  const versionDir = path.join(root, 'versions', id);
  await fs.mkdir(versionDir, { recursive: true });
  await fs.rm(path.join(versionDir, '.prime-install-complete'), { force: true });
  emit(progress, taskId, 'metadata', `Fetching official metadata for ${id}`, 0, 1);
  const metadata = await fetchJson<VersionInfo>(entry.url);
  if (metadata.id !== id || !metadata.mainClass) throw new Error('Official version metadata is missing its ID or main class.');
  if (!metadata.downloads?.client?.url) throw new Error('This release does not provide an official client download in its metadata.');
  await atomicWrite(path.join(versionDir, `${id}.json`), JSON.stringify(metadata, null, 2));
  emit(progress, taskId, 'client', `Downloading Minecraft ${id} client`, 0, 1);
  await downloadVerified(metadata.downloads.client, path.join(versionDir, `${id}.jar`));
  await downloadLibraries(metadata.libraries ?? [], root, versionDir, progress, taskId);
  await downloadAssets(metadata, root, progress, taskId);
  if (metadata.logging?.client?.file?.url && metadata.logging.client.file.path) {
    const fileName = path.basename(metadata.logging.client.file.path);
    await downloadVerified(metadata.logging.client.file, path.join(root, 'assets', 'log_configs', fileName));
  }
  await fs.access(path.join(versionDir, `${id}.json`));
  await fs.access(path.join(versionDir, `${id}.jar`));
  await atomicWrite(path.join(versionDir, '.prime-install-complete'), JSON.stringify({ version: id, installedAt: new Date().toISOString() }));
  emit(progress, taskId, 'complete', `Minecraft ${id} installed and checked`, 1, 1, { done: true });
}

function evaluateArgs(items?: Array<string | { rules?: Rule[]; value: string | string[] }>): string[] {
  const args: string[] = [];
  for (const item of items ?? []) {
    if (typeof item === 'string') args.push(item);
    else if (rulesAllow(item.rules)) args.push(...(Array.isArray(item.value) ? item.value : [item.value]));
  }
  return args;
}
function splitLegacyArgs(value: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(value)) !== null) args.push((found[1] ?? found[2] ?? found[3]).replaceAll('\\"', '"'));
  return args;
}
function substitute(args: string[], values: Record<string, string>): string[] {
  return args.map((arg) => arg.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (whole, key: string) => values[key] ?? whole));
}

export async function launchMinecraft(profileId: string, progress: (p: TaskProgress) => void): Promise<{ pid: number; logPath: string }> {
  if ([...running.values()].some((entry) => entry.process.exitCode === null && entry.process.signalCode === null)) throw new Error('Minecraft is already running from PRIME CLIENT.');
  const profile = await getProfile(profileId);
  if (profile.loader !== 'vanilla') throw new Error('This build can launch vanilla profiles only.');
  if (!profile.versionId) throw new Error('Select a Minecraft version for this profile first.');
  const id = safeVersionId(profile.versionId);
  const root = path.resolve(profile.gameDir);
  const versionDir = path.join(root, 'versions', id);
  const jsonPath = path.join(versionDir, `${id}.json`);
  const jarPath = path.join(versionDir, `${id}.jar`);
  try { await fs.access(jsonPath); await fs.access(jarPath); await fs.access(path.join(versionDir, '.prime-install-complete')); }
  catch { throw new Error(`Minecraft ${id} is not completely installed in this PRIME CLIENT profile. Install it from Versions first.`); }
  const metadata = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as VersionInfo;
  const account = await getValidMinecraftSession();
  const java = profile.javaPath ? await validateJava(profile.javaPath) : (await detectJava())[0];
  if (!java) throw new Error('No Java runtime detected. Install the runtime required by this Minecraft version or select its executable in Performance.');
  const requiredJava = metadata.javaVersion?.majorVersion;
  if (requiredJava && java.major < requiredJava) throw new Error(`Minecraft ${id} requires Java ${requiredJava} or newer, but Java ${java.major} was selected.`);
  const libraryPaths: string[] = [];
  for (const lib of metadata.libraries ?? []) {
    if (!rulesAllow(lib.rules)) continue;
    if (lib.downloads?.artifact?.path) {
      if (!lib.downloads.artifact.path.split('/').some((part) => part.includes('natives-'))) libraryPaths.push(safeJoin(path.join(root, 'libraries'), lib.downloads.artifact.path));
    } else if (lib.name && !lib.natives) libraryPaths.push(safeJoin(path.join(root, 'libraries'), mavenPath(lib.name)));
  }
  const classpath = [...libraryPaths, jarPath].join(path.delimiter);
  const nativesDir = path.join(versionDir, 'natives');
  const assetsDir = path.join(root, 'assets');
  const values: Record<string, string> = {
    auth_player_name: account.name, version_name: id, game_directory: root, assets_root: assetsDir,
    assets_index_name: metadata.assetIndex?.id ?? metadata.assets ?? '', auth_uuid: account.uuid.replaceAll('-', ''),
    auth_access_token: account.accessToken, user_type: 'msa', version_type: metadata.type ?? 'release',
    launcher_name: 'PRIME CLIENT', launcher_version: app.getVersion(), classpath, natives_directory: nativesDir,
    library_directory: path.join(root, 'libraries'), classpath_separator: path.delimiter, user_properties: '{}',
    auth_xuid: '', clientid: '', resolution_width: '1280', resolution_height: '720'
  };
  let jvm = evaluateArgs(metadata.arguments?.jvm);
  let game = evaluateArgs(metadata.arguments?.game);
  if (!metadata.arguments && metadata.minecraftArguments) game = splitLegacyArgs(metadata.minecraftArguments);
  if (!jvm.length) jvm = ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'];
  if (!jvm.some((arg) => arg.startsWith('-Xmx'))) jvm.push(`-Xmx${profile.maxMemoryMb}M`);
  if (!jvm.some((arg) => arg.startsWith('-Xms'))) jvm.push(`-Xms${profile.minMemoryMb}M`);
  if (metadata.logging?.client?.argument && metadata.logging.client.file?.path) {
    const logConfig = path.join(assetsDir, 'log_configs', path.basename(metadata.logging.client.file.path));
    jvm.push(metadata.logging.client.argument.replace('${path}', logConfig));
  }
  const args = [...substitute(jvm, values), metadata.mainClass, ...substitute(game, values)];
  await fs.mkdir(path.join(root, 'logs', 'prime-client'), { recursive: true });
  const logPath = path.join(root, 'logs', 'prime-client', `launch-${new Date().toISOString().replaceAll(':', '-')}.log`);
  const log = createWriteStream(logPath, { flags: 'a' });
  const child = spawn(java.path, args, { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (data: Buffer) => log.write(data));
  child.stderr?.on('data', (data: Buffer) => log.write(data));
  child.on('error', (error) => { log.write(`\n[PRIME CLIENT] Java spawn error: ${error.message}\n`); log.end(); });
  child.on('exit', (code, signal) => {
    log.write(`\n[PRIME CLIENT] Minecraft exited: code=${code ?? 'null'}, signal=${signal ?? 'none'}\n`);
    log.end(); running.delete(profileId);
    emit(progress, `launch-${profileId}`, 'launch', 'Minecraft has stopped', undefined, undefined, { done: true });
  });
  const spawned = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), 500);
    child.once('spawn', () => { clearTimeout(timer); resolve(true); });
    child.once('error', () => { clearTimeout(timer); resolve(false); });
  });
  if (!spawned || !child.pid) { running.delete(profileId); throw new Error('Java could not start. Check the profile Java path and launch log.'); }
  running.set(profileId, { process: child, pid: child.pid, logPath });
  emit(progress, `launch-${profileId}`, 'launch', `Minecraft ${id} started (PID ${child.pid})`, 1, 1, { done: true });
  return { pid: child.pid, logPath };
}

export async function getGameStatus(): Promise<{ running: boolean; profileId: string | null; pid: number | null }> {
  for (const [profileId, entry] of running) if (entry.process.exitCode === null && entry.process.signalCode === null) return { running: true, profileId, pid: entry.pid };
  return { running: false, profileId: null, pid: null };
}
export async function openLatestGameLog(profileId: string): Promise<string | null> {
  const inMemory = running.get(profileId);
  if (inMemory?.logPath) return inMemory.logPath;
  const profile = await getProfile(profileId);
  const dir = path.join(profile.gameDir, 'logs', 'prime-client');
  try {
    const logs = (await fs.readdir(dir)).filter((name) => name.endsWith('.log')).sort().reverse();
    return logs[0] ? path.join(dir, logs[0]) : null;
  } catch { return null; }
}
export async function defaultProfile(): Promise<Profile | null> {
  const settings = await getSettings();
  const profiles = await getProfiles();
  return profiles.find((profile) => profile.id === settings.defaultProfileId) ?? profiles[0] ?? null;
}
