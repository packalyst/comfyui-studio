import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_FILE = process.env.STUDIO_CONFIG_FILE
  || path.join(os.homedir(), '.config', 'comfyui-studio', 'config.json');

interface Settings {
  apiKeyComfyOrg?: string;
  huggingFaceToken?: string;
}

let cache: Settings | null = null;

function load(): Settings {
  if (cache) return cache;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      cache = JSON.parse(raw) as Settings;
    } else {
      cache = {};
    }
  } catch {
    cache = {};
  }
  return cache;
}

function save(settings: Settings): void {
  cache = settings;
  const dir = path.dirname(CONFIG_FILE);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* best effort */ }
}

export function getApiKey(): string | undefined {
  return load().apiKeyComfyOrg;
}

export function isApiKeyConfigured(): boolean {
  const key = getApiKey();
  return typeof key === 'string' && key.length > 0;
}

export function setApiKey(key: string): void {
  const settings = load();
  save({ ...settings, apiKeyComfyOrg: key });
}

export function clearApiKey(): void {
  const settings = load();
  const { apiKeyComfyOrg: _removed, ...rest } = settings;
  save(rest);
}

export function getHfToken(): string | undefined {
  return load().huggingFaceToken;
}

export function isHfTokenConfigured(): boolean {
  const token = getHfToken();
  return typeof token === 'string' && token.length > 0;
}

export function setHfToken(token: string): void {
  const settings = load();
  save({ ...settings, huggingFaceToken: token });
}

export function clearHfToken(): void {
  const settings = load();
  const { huggingFaceToken: _removed, ...rest } = settings;
  save(rest);
}
