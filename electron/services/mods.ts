import { dialog, shell } from 'electron';
import { constants, type Dirent, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { BuildReport, ModFile, SourceReport, TaskProgress } from '../../shared/types';
import { getProfile } from './settings';

function within(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function chooseFiles(filters: Electron.FileFilter[], title: string) {
  const result = await dialog.showOpenDialog({ title, properties: ['openFile', 'multiSelections'], filters });
  return result.canceled ? [] : result.filePaths;
}
async function uniqueDestination(dir: string, sourcePath: string): Promise<string> {
  const original = path.basename(sourcePath).replace(/[\u0000-\u001f]/g, '_');
  const ext = path.extname(original);
  const stem = path.basename(original, ext).slice(0, 150) || 'imported-file';
  let target = path.join(dir, `${stem}${ext}`);
  let index = 1;
  while (true) {
    try { await fs.access(target); target = path.join(dir, `${stem}-${index++}${ext}`); }
    catch { return target; }
  }
}

export async function listMods(profileId: string): Promise<ModFile[]> {
  const profile = await getProfile(profileId);
  const dir = path.join(profile.gameDir, 'mods');
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: ModFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || (!entry.name.toLowerCase().endsWith('.jar') && !entry.name.toLowerCase().endsWith('.jar.disabled'))) continue;
    const full = path.join(dir, entry.name);
    const stat = await fs.stat(full);
    result.push({ name: entry.name, path: full, enabled: entry.name.toLowerCase().endsWith('.jar'), size: stat.size });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function importMods(profileId: string): Promise<{ imported: number; names: string[] }> {
  const files = await chooseFiles([{ name: 'Minecraft mod JAR', extensions: ['jar'] }], 'Import Minecraft mods');
  if (!files.length) return { imported: 0, names: [] };
  const profile = await getProfile(profileId);
  const dir = path.join(profile.gameDir, 'mods');
  await fs.mkdir(dir, { recursive: true });
  const names: string[] = [];
  for (const source of files) {
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size <= 0) continue;
    if (!(await isValidZipSignature(source))) throw new Error(`${path.basename(source)} is not a structurally valid JAR/ZIP archive.`);
    const dest = await uniqueDestination(dir, source);
    if (!within(dir, dest)) throw new Error('The selected file resolved outside the profile mod directory.');
    await fs.copyFile(source, dest, constants.COPYFILE_EXCL);
    names.push(path.basename(dest));
  }
  return { imported: names.length, names };
}

export async function toggleMod(profileId: string, name: string, enabled: boolean): Promise<void> {
  if (path.basename(name) !== name || /[\\/\u0000]/.test(name)) throw new Error('Invalid mod filename.');
  const profile = await getProfile(profileId);
  const dir = path.resolve(profile.gameDir, 'mods');
  await fs.mkdir(dir, { recursive: true });
  const source = path.resolve(dir, name);
  if (!within(dir, source)) throw new Error('Invalid mod path.');
  const disabledSuffix = '.jar.disabled';
  let targetName = name;
  if (enabled && name.toLowerCase().endsWith(disabledSuffix)) targetName = name.slice(0, -'.disabled'.length);
  else if (!enabled && name.toLowerCase().endsWith('.jar')) targetName = `${name}.disabled`;
  else return;
  const target = path.resolve(dir, targetName);
  try { await fs.access(source); } catch { throw new Error('The mod file no longer exists. Refresh the list and retry.'); }
  try { await fs.access(target); throw new Error('A file with the destination name already exists.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await fs.rename(source, target);
}

export async function importResources(profileId: string, kind: 'resourcepacks' | 'shaderpacks'): Promise<{ imported: number; names: string[] }> {
  const title = kind === 'resourcepacks' ? 'Import resource packs' : 'Import shader packs';
  const files = await chooseFiles([{ name: 'ZIP pack', extensions: ['zip'] }], title);
  if (!files.length) return { imported: 0, names: [] };
  const profile = await getProfile(profileId);
  const dir = path.join(profile.gameDir, kind);
  await fs.mkdir(dir, { recursive: true });
  const names: string[] = [];
  for (const source of files) {
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size <= 0) continue;
    if (!(await isValidZipSignature(source))) throw new Error(`${path.basename(source)} is not a structurally valid ZIP archive.`);
    const target = await uniqueDestination(dir, source);
    if (!within(dir, target)) throw new Error('The selected pack resolved outside its profile directory.');
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
    names.push(path.basename(target));
  }
  return { imported: names.length, names };
}

export async function openProfileFolder(profileId: string, kind: 'game' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'logs' | 'screenshots'): Promise<string> {
  const profile = await getProfile(profileId);
  const root = path.resolve(profile.gameDir);
  const paths: Record<typeof kind, string> = {
    game: root,
    mods: path.join(root, 'mods'),
    resourcepacks: path.join(root, 'resourcepacks'),
    shaderpacks: path.join(root, 'shaderpacks'),
    logs: path.join(root, 'logs'),
    screenshots: path.join(root, 'screenshots')
  };
  const target = path.resolve(paths[kind]);
  if (!within(root, target)) throw new Error('Refusing to open a path outside the selected profile.');
  await fs.mkdir(target, { recursive: true });
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
  return target;
}

async function chooseSourceDirectory(title: string): Promise<string | null> {
  const result = await dialog.showOpenDialog({ title, properties: ['openDirectory'] });
  return result.canceled || !result.filePaths[0] ? null : path.resolve(result.filePaths[0]);
}
const ignored = new Set(['.git', '.gradle', 'node_modules', 'build', 'out', 'target', '.idea', '.vscode']);
async function walkProject(root: string, visitor: (fullPath: string, relative: string) => Promise<void>, maxFiles = 12000): Promise<number> {
  let count = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 16 || count >= maxFiles) return;
    let entries: Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (count >= maxFiles) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile()) { count++; await visitor(full, relative); }
    }
  };
  await walk(root, 0);
  return count;
}

async function analyzeDirectory(root: string): Promise<SourceReport> {
  let fileCount = 0;
  let javaCount = 0;
  let kotlinCount = 0;
  let hasGradle = false;
  let wrapperPath: string | null = null;
  const metadataFiles: string[] = [];
  const candidateLoaders = new Set<string>();
  const candidateVersions = new Set<string>();
  const warnings: string[] = [];
  const gradleVersionPatterns = [
    /(?:minecraft_version|minecraftVersion|minecraft)\s*[=:]\s*["']?(\d+\.\d+(?:\.\d+)?)/gi,
    /(?:minecraft_version|minecraftVersion)\s*[=:]\s*["']?(\d+\.\d+(?:\.\d+)?)/gi
  ];
  const count = await walkProject(root, async (full, relative) => {
    const base = path.basename(full).toLowerCase();
    if (base.endsWith('.java')) javaCount++;
    if (base.endsWith('.kt') || base.endsWith('.kts')) kotlinCount++;
    if (['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].includes(base)) hasGradle = true;
    if (['gradlew', 'gradlew.bat'].includes(base)) wrapperPath = full;
    if (['fabric.mod.json', 'mods.toml', 'neoforge.mods.toml', 'forge.mods.toml'].includes(base)) {
      metadataFiles.push(relative);
      if (base === 'fabric.mod.json') candidateLoaders.add('Fabric');
      if (base === 'mods.toml' || base === 'forge.mods.toml') candidateLoaders.add('Forge');
      if (base === 'neoforge.mods.toml') candidateLoaders.add('NeoForge');
    }
    if (['gradle.properties', 'build.gradle', 'build.gradle.kts', 'fabric.mod.json', 'mods.toml', 'neoforge.mods.toml'].includes(base)) {
      try {
        const stat = await fs.stat(full);
        if (stat.size <= 1024 * 1024) {
          const contents = await fs.readFile(full, 'utf8');
          if (base.includes('fabric') || /fabric-loom/i.test(contents)) candidateLoaders.add('Fabric');
          if (/net\.minecraftforge\.gradle|forgegradle/i.test(contents)) candidateLoaders.add('Forge');
          if (/net\.neoforged|neoforge/i.test(contents)) candidateLoaders.add('NeoForge');
          for (const pattern of gradleVersionPatterns) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(contents)) !== null) candidateVersions.add(match[1]);
          }
          const minecraftDependency = contents.match(/com\.mojang:minecraft:([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
          if (minecraftDependency) candidateVersions.add(minecraftDependency[1]);
        }
      } catch { /* inaccessible metadata is reported through other findings */ }
    }
  });
  fileCount = count;
  if (count >= 12000) warnings.push('Inspection stopped at the 12,000-file safety limit.');
  if (!hasGradle) warnings.push('No Gradle build file was found. A JAR cannot be built by this workflow without a recognized build system.');
  if (!wrapperPath) warnings.push('No Gradle Wrapper was found. Building is disabled rather than running an arbitrary globally installed Gradle version.');
  if (javaCount + kotlinCount === 0) warnings.push('No Java/Kotlin source files were found in the selected folder.');
  if (metadataFiles.length === 0) warnings.push('No common Fabric/Forge/NeoForge metadata file was found; target loader/version remains uncertain.');
  if (fileCount === 0) warnings.push('The selected folder appears empty or could not be read.');
  return { path: root, selectionType: 'directory', fileCount, javaCount, kotlinCount, hasGradle, wrapperPath, metadataFiles: [...new Set(metadataFiles)].slice(0, 100), candidateMinecraftVersions: [...candidateVersions].slice(0, 20), candidateLoaders: [...candidateLoaders], warnings };
}

async function analyzeSingleFile(filePath: string): Promise<SourceReport> {
  const base = path.basename(filePath);
  const ext = path.extname(base).toLowerCase();
  const warnings: string[] = [];
  const metadataFiles: string[] = [];
  const candidateLoaders = new Set<string>();
  const candidateVersions = new Set<string>();
  let javaCount = ext === '.java' ? 1 : 0;
  let kotlinCount = ['.kt', '.kts'].includes(ext) ? 1 : 0;
  const hasGradle = ['.gradle', '.kts'].includes(ext) || /^build\.gradle(?:\.kts)?$/i.test(base);
  let readableText = '';
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Choose a regular source or metadata file.');
  if (stat.size > 1024 * 1024) warnings.push('Text inspection was skipped because the selected file exceeds 1 MiB.');
  else if (['.java', '.kt', '.kts', '.gradle', '.groovy', '.json', '.toml', '.properties'].includes(ext)) {
    try { readableText = await fs.readFile(filePath, 'utf8'); }
    catch { warnings.push('The selected text file could not be read.'); }
  }
  if (['fabric.mod.json', 'mods.toml', 'neoforge.mods.toml', 'forge.mods.toml'].includes(base.toLowerCase())) {
    metadataFiles.push(base);
    if (base.toLowerCase() === 'fabric.mod.json') candidateLoaders.add('Fabric');
    if (['mods.toml', 'forge.mods.toml'].includes(base.toLowerCase())) candidateLoaders.add('Forge');
    if (base.toLowerCase() === 'neoforge.mods.toml') candidateLoaders.add('NeoForge');
  }
  if (/fabric-loom|fabric\.mod\.json/i.test(readableText)) candidateLoaders.add('Fabric');
  if (/net\.minecraftforge\.gradle|forgegradle|mods\.toml/i.test(readableText)) candidateLoaders.add('Forge');
  if (/net\.neoforged|neoforge/i.test(readableText)) candidateLoaders.add('NeoForge');
  for (const match of readableText.matchAll(/(?:minecraft_version|minecraftVersion|minecraft)\s*[=:]\s*["']?(\d+\.\d+(?:\.\d+)?)/gi)) candidateVersions.add(match[1]);
  const dependency = readableText.match(/com\.mojang:minecraft:([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
  if (dependency) candidateVersions.add(dependency[1]);
  if (['.jar', '.zip'].includes(ext)) warnings.push('This is a binary archive, not source code. It can be inspected as a file, but this source builder will not transform it into a mod.');
  else warnings.push('A single source/metadata file is not a complete project. Building requires the related source files, dependencies, and a valid Gradle Wrapper in a project folder.');
  if (!javaCount && !kotlinCount && !hasGradle && metadataFiles.length === 0) warnings.push('The selected file is not a recognized Java/Kotlin source, Gradle file, or common loader metadata file.');
  return {
    path: filePath,
    selectionType: 'file',
    fileCount: 1,
    javaCount,
    kotlinCount,
    hasGradle,
    wrapperPath: null,
    metadataFiles,
    candidateMinecraftVersions: [...candidateVersions].slice(0, 20),
    candidateLoaders: [...candidateLoaders],
    warnings
  };
}

export async function analyzeModSource(): Promise<SourceReport | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a mod source file or project folder',
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'Mod source and project files', extensions: ['java', 'kt', 'kts', 'gradle', 'groovy', 'json', 'toml', 'properties', 'jar', 'zip'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const selected = path.resolve(result.filePaths[0]);
  const stat = await fs.stat(selected);
  return stat.isDirectory() ? analyzeDirectory(selected) : analyzeSingleFile(selected);
}

function isValidZipSignature(fullPath: string): Promise<boolean> {
  return fs.open(fullPath, 'r').then(async (handle) => {
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 22) return false;
      const tailLength = Math.min(stat.size, 65557);
      const tail = Buffer.alloc(tailLength);
      const tailRead = await handle.read(tail, 0, tailLength, stat.size - tailLength);
      if (tailRead.bytesRead !== tailLength) return false;
      const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
      const eocd = tail.lastIndexOf(signature);
      if (eocd < 0 || eocd + 22 > tail.length) return false;
      const centralDirectorySize = tail.readUInt32LE(eocd + 12);
      const centralDirectoryOffset = tail.readUInt32LE(eocd + 16);
      if (centralDirectorySize <= 0 || centralDirectoryOffset + centralDirectorySize > stat.size) return false;
      const centralHeader = Buffer.alloc(4);
      const centralRead = await handle.read(centralHeader, 0, 4, centralDirectoryOffset);
      return centralRead.bytesRead === 4 && centralHeader.equals(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    } finally { await handle.close(); }
  }).catch(() => false);
}
async function findBuiltJars(root: string): Promise<string[]> {
  const jars: string[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > 16) return;
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['.git', '.gradle', 'node_modules', 'out', 'target'].includes(entry.name)) continue;
        if (entry.name === 'build') {
          const libs = path.join(full, 'libs');
          let built: import('node:fs').Dirent[] = [];
          try { built = await fs.readdir(libs, { withFileTypes: true }); } catch { /* module may not have an output */ }
          for (const file of built) {
            if (file.isFile() && file.name.toLowerCase().endsWith('.jar')) {
              const filePath = path.join(libs, file.name);
              if (await isValidZipSignature(filePath)) jars.push(filePath);
            }
          }
          continue;
        }
        await visit(full, depth + 1);
      }
    }
  };
  await visit(root, 0);
  return [...new Set(jars)];
}

export async function buildModSource(progress: (p: TaskProgress) => void): Promise<BuildReport | null> {
  const root = await chooseSourceDirectory('Choose a Gradle mod project to build');
  if (!root) return null;
  const report = await analyzeDirectory(root);
  if (!report.hasGradle || !report.wrapperPath) throw new Error('Build stopped: a Gradle build file and its Gradle Wrapper are both required. See Source Build inspection results.');
  const wrapper = report.wrapperPath;
  const taskId = `mod-build-${randomUUID()}`;
  emitBuild(progress, taskId, `Building mod source in ${root}`);
  const command = process.platform === 'win32' ? wrapper : wrapper;
  const child = spawn(command, ['build', '--no-daemon'], { cwd: root, windowsHide: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let finished = false;
  const append = (chunk: Buffer) => {
    const textChunk = chunk.toString('utf8');
    output = `${output}${textChunk}`.slice(-1_000_000);
    emitBuild(progress, taskId, textChunk.slice(-3000));
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const result = await new Promise<{ code: number | null; error: Error | null }>((resolve) => {
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      resolve({ code: null, error: new Error('Gradle build exceeded the 10-minute safety timeout.') });
    }, 10 * 60 * 1000);
    child.once('error', (error) => {
      if (finished) return;
      finished = true; clearTimeout(timeout); resolve({ code: null, error });
    });
    child.once('close', (code) => {
      if (finished) return;
      finished = true; clearTimeout(timeout); resolve({ code, error: null });
    });
  });
  const jars = result.code === 0 && !result.error ? await findBuiltJars(root) : [];
  const success = result.code === 0 && !result.error && jars.length > 0;
  if (result.error) output += `\n${result.error.message}`;
  if (result.code === 0 && !jars.length) output += '\nGradle exited successfully, but no valid JAR was found under any build/libs directory.';
  emitBuild(progress, taskId, success ? `Build succeeded (${jars.length} JAR file(s)).` : 'Build did not produce a confirmed JAR.', true, success ? undefined : output.slice(-1000));
  return { success, projectPath: root, jarFiles: jars, output };
}
function emitBuild(progress: (p: TaskProgress) => void, taskId: string, message: string, done = false, error?: string) {
  progress({ taskId, phase: 'mod-build', message, done, error });
}

