import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { JavaInfo } from '../../shared/types';

const execFileAsync = promisify(execFile);

export function parseJavaMajor(text: string): number | null {
  const match = text.match(/version\s+"?([\d]+)(?:\.([\d]+))?/i) ?? text.match(/openjdk\s+([\d]+)(?:\.([\d]+))?/i);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2] ?? 0);
  return first === 1 && second > 0 ? second : first;
}

async function inspectJava(candidate: string): Promise<JavaInfo | null> {
  const resolved = path.resolve(candidate);
  if (!existsSync(resolved)) return null;
  try {
    const { stdout, stderr } = await execFileAsync(resolved, ['-version'], { timeout: 5000, windowsHide: true });
    const output = `${stdout}\n${stderr}`;
    const major = parseJavaMajor(output);
    if (!major) return null;
    return { path: resolved, version: output.match(/(?:openjdk|java) version\s+"?[^\s"]+/i)?.[0] ?? `Java ${major}`, major };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    const output = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    const major = parseJavaMajor(output);
    return major ? { path: resolved, version: `Java ${major}`, major } : null;
  }
}

export async function detectJava(paths: string[] = []): Promise<JavaInfo[]> {
  const candidates = new Set<string>();
  const isWindows = process.platform === 'win32';
  const exe = isWindows ? 'java.exe' : 'java';
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter);
  for (const entry of pathEntries) if (entry.trim()) candidates.add(path.join(entry, exe));
  for (const p of paths) if (p.trim()) candidates.add(p.trim());
  const home = process.env.JAVA_HOME;
  if (home) candidates.add(path.join(home, 'bin', exe));
  if (isWindows) {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (root) {
        candidates.add(path.join(root, 'Java', 'bin', exe));
        candidates.add(path.join(root, 'Eclipse Adoptium', 'jdk-21', 'bin', exe));
      }
    }
  }
  const found: JavaInfo[] = [];
  for (const candidate of candidates) {
    const info = await inspectJava(candidate);
    if (info && !found.some((item) => item.path.toLowerCase() === info.path.toLowerCase())) found.push(info);
  }
  return found.sort((a, b) => b.major - a.major);
}

export async function validateJava(pathInput: string): Promise<JavaInfo> {
  const info = await inspectJava(pathInput);
  if (!info) throw new Error('The selected file did not respond to `java -version`. Choose the Java executable, not its folder.');
  return info;
}
