import { app, safeStorage, shell } from 'electron';
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}
interface XboxResponse { Token: string; DisplayClaims: { xui: Array<{ uhs?: string }> } }
interface MinecraftTokenResponse { access_token: string; expires_in: number }
interface EntitlementsResponse { items?: Array<{ name?: string; signature?: string }> }
interface MinecraftProfileResponse { id: string; name: string }
interface StoredSession {
  name: string;
  uuid: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  microsoftAccessToken: string;
}

const sessionFile = () => path.join(app.getPath('userData'), 'account-session.enc');
const tokenEndpoint = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const scopes = 'XboxLive.signin offline_access';

function encryptionReady(): boolean {
  return safeStorage.isEncryptionAvailable();
}
async function readSession(): Promise<StoredSession | null> {
  if (!encryptionReady()) return null;
  try {
    const encrypted = await fs.readFile(sessionFile(), 'utf8');
    const json = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    return JSON.parse(json) as StoredSession;
  } catch { return null; }
}
async function writeSession(session: StoredSession): Promise<void> {
  if (!encryptionReady()) throw new Error('OS credential encryption is unavailable. PRIME CLIENT will not save account tokens as plain text.');
  const encrypted = safeStorage.encryptString(JSON.stringify(session)).toString('base64');
  await fs.mkdir(path.dirname(sessionFile()), { recursive: true });
  await fs.writeFile(sessionFile(), encrypted, { encoding: 'utf8', mode: 0o600 });
}

async function requestJson<T>(url: string, body: unknown, bearer?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const parsed = payload as { errorMessage?: string; Message?: string; error?: string };
    const message = parsed.errorMessage ?? parsed.Message ?? parsed.error ?? `HTTP ${response.status}`;
    throw new Error(`Microsoft/Xbox/Minecraft authentication failed: ${String(message).slice(0, 220)}`);
  }
  return payload as T;
}
async function exchangeMicrosoftForMinecraft(msAccessToken: string, refreshToken: string): Promise<StoredSession> {
  const xbox = await requestJson<XboxResponse>('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
  });
  const userHash = xbox.DisplayClaims?.xui?.[0]?.uhs;
  if (!xbox.Token || !userHash) throw new Error('Xbox Live did not return the account claims needed for Minecraft sign-in.');
  const xsts = await requestJson<XboxResponse>('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbox.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT'
  });
  const xstsHash = xsts.DisplayClaims?.xui?.[0]?.uhs;
  if (!xsts.Token || !xstsHash) throw new Error('Xbox XSTS authorization did not return a valid token.');
  const minecraftToken = await requestJson<MinecraftTokenResponse>('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${xstsHash};${xsts.Token}`
  });
  if (!minecraftToken.access_token) throw new Error('Minecraft Services did not issue an access token.');
  const entitlementsResponse = await fetch('https://api.minecraftservices.com/entitlements/mcstore', {
    headers: { Authorization: `Bearer ${minecraftToken.access_token}` }, signal: AbortSignal.timeout(15000)
  });
  if (!entitlementsResponse.ok) throw new Error(`Could not verify Minecraft ownership (HTTP ${entitlementsResponse.status}).`);
  const entitlements = await entitlementsResponse.json() as EntitlementsResponse;
  if (!Array.isArray(entitlements.items) || entitlements.items.length === 0) {
    throw new Error('This Microsoft account has no Minecraft Java Edition entitlement returned by Minecraft Services.');
  }
  const profileResponse = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${minecraftToken.access_token}` }, signal: AbortSignal.timeout(15000)
  });
  if (!profileResponse.ok) throw new Error('Minecraft Services did not return a Java Edition profile for this account.');
  const profile = await profileResponse.json() as MinecraftProfileResponse;
  if (!profile.id || !profile.name) throw new Error('The Minecraft profile is missing its ID or player name.');
  return {
    name: profile.name,
    uuid: profile.id,
    accessToken: minecraftToken.access_token,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, minecraftToken.expires_in) * 1000,
    microsoftAccessToken: msAccessToken
  };
}

async function exchangeCodeForMicrosoft(code: string, verifier: string, redirectUri: string, clientId: string): Promise<MicrosoftTokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: scopes
  });
  const response = await fetch(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) });
  const result = await response.json() as MicrosoftTokenResponse;
  if (!response.ok || !result.access_token || !result.refresh_token) {
    throw new Error(`Microsoft token exchange failed: ${(result.error_description ?? result.error ?? `HTTP ${response.status}`).slice(0, 220)}`);
  }
  return result;
}

function base64Url(buffer: Buffer): string { return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, ''); }
function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function signInMicrosoft(clientIdInput: string): Promise<{ name: string; uuid: string; expiresAt: number }> {
  const clientId = clientIdInput.trim();
  if (!/^[0-9a-fA-F-]{20,80}$/.test(clientId)) throw new Error('Enter a valid Microsoft application Client ID in Settings → Accounts first.');
  if (!encryptionReady()) throw new Error('OS-backed credential encryption is unavailable in this session. Sign-in was stopped so tokens are not stored unencrypted.');
  const state = base64Url(randomBytes(24));
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  let settled = false;
  const codePromise = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const server = createServer((req, res) => {
    let incoming: URL;
    try { incoming = new URL(req.url ?? '/', 'http://localhost'); }
    catch { res.writeHead(400).end('Invalid callback.'); return; }
    if (incoming.pathname !== '/callback') { res.writeHead(404).end('Not found.'); return; }
    const callbackState = incoming.searchParams.get('state') ?? '';
    if (!constantTimeEqual(callbackState, state)) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('<h2>PRIME CLIENT</h2><p>Sign-in state verification failed. You can close this tab.</p>');
      if (!settled) { settled = true; rejectCode(new Error('Microsoft sign-in state verification failed.')); }
      return;
    }
    const oauthError = incoming.searchParams.get('error');
    const code = incoming.searchParams.get('code');
    if (oauthError || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('<h2>PRIME CLIENT</h2><p>Sign-in was not completed. You can close this tab.</p>');
      if (!settled) { settled = true; rejectCode(new Error(`Microsoft sign-in was not completed: ${(incoming.searchParams.get('error_description') ?? oauthError ?? 'No code returned').slice(0, 180)}`)); }
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end('<!doctype html><meta charset="utf-8"><title>PRIME CLIENT</title><h2>PRIME CLIENT</h2><p>Sign-in complete. Return to the app.</p>');
    if (!settled) { settled = true; resolveCode(code); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  }).catch((error) => { server.close(); throw error; });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Could not open a local sign-in callback.'); }
  const redirectUri = `http://localhost:${address.port}/callback`;
  const authUrl = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  }).toString();
  const timer = setTimeout(() => {
    if (!settled) { settled = true; rejectCode(new Error('Microsoft sign-in timed out after 3 minutes.')); }
  }, 180000);
  try {
    await shell.openExternal(authUrl.toString());
    const code = await codePromise;
    const microsoft = await exchangeCodeForMicrosoft(code, verifier, redirectUri, clientId);
    const stored = await exchangeMicrosoftForMinecraft(microsoft.access_token, microsoft.refresh_token as string);
    await writeSession(stored);
    return { name: stored.name, uuid: stored.uuid, expiresAt: stored.expiresAt };
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

export async function getAccountSummary(): Promise<{ name: string; uuid: string; expiresAt: number } | null> {
  const session = await readSession();
  return session ? { name: session.name, uuid: session.uuid, expiresAt: session.expiresAt } : null;
}

export async function getValidMinecraftSession(): Promise<StoredSession> {
  const session = await readSession();
  if (!session) throw new Error('Sign in with a Microsoft account that owns Minecraft: Java Edition in Accounts before launching.');
  if (session.expiresAt > Date.now() + 60000) return session;
  const { getSettings } = await import('./settings');
  const settings = await getSettings();
  if (!settings.microsoftClientId) throw new Error('Microsoft Client ID is missing. Re-enter it in Settings → Accounts and sign in again.');
  const tokenBody = new URLSearchParams({
    client_id: settings.microsoftClientId,
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
    scope: scopes
  });
  const response = await fetch(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody, signal: AbortSignal.timeout(20000) });
  const microsoft = await response.json() as MicrosoftTokenResponse;
  if (!response.ok || !microsoft.access_token) throw new Error('Microsoft session expired. Sign in again from Accounts.');
  const next = await exchangeMicrosoftForMinecraft(microsoft.access_token, microsoft.refresh_token ?? session.refreshToken);
  await writeSession(next);
  return next;
}

export async function signOutMicrosoft(): Promise<void> {
  try { await fs.rm(sessionFile(), { force: true }); } catch { /* no session file */ }
}
