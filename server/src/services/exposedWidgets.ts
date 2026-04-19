// Per-template record of which raw-node widgets the user has opted to surface
// in the Advanced Settings panel. One file per template so a single template's
// config can be read/written without touching unrelated ones.
//
// Disk layout:
//   ~/.config/comfyui-studio/exposed_widgets/<templateName>.json
//   { "exposed": [ { "nodeId": "3", "widgetName": "steps" }, ... ] }

import fs from 'fs';
import path from 'path';
import os from 'os';

const STORE_DIR = process.env.STUDIO_EXPOSED_WIDGETS_DIR
  || path.join(os.homedir(), '.config', 'comfyui-studio', 'exposed_widgets');

export interface ExposedWidget {
  nodeId: string;
  widgetName: string;
}

function safeFilename(templateName: string): string {
  // Restrict to characters we know are safe; reject empty / traversal attempts.
  const cleaned = templateName.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!cleaned) throw new Error('invalid template name');
  return cleaned + '.json';
}

function filePathFor(templateName: string): string {
  return path.join(STORE_DIR, safeFilename(templateName));
}

export function getForTemplate(templateName: string): ExposedWidget[] {
  const fp = filePathFor(templateName);
  if (!fs.existsSync(fp)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8')) as { exposed?: ExposedWidget[] };
    if (!Array.isArray(raw.exposed)) return [];
    return raw.exposed.filter(
      e => e && typeof e.nodeId === 'string' && typeof e.widgetName === 'string'
    );
  } catch {
    return [];
  }
}

export function setForTemplate(templateName: string, exposed: ExposedWidget[]): ExposedWidget[] {
  const fp = filePathFor(templateName);
  fs.mkdirSync(path.dirname(fp), { recursive: true, mode: 0o700 });
  // Normalize + dedupe.
  const seen = new Set<string>();
  const clean: ExposedWidget[] = [];
  for (const e of exposed) {
    if (!e || typeof e.nodeId !== 'string' || typeof e.widgetName !== 'string') continue;
    const key = `${e.nodeId}|${e.widgetName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ nodeId: e.nodeId, widgetName: e.widgetName });
  }
  fs.writeFileSync(fp, JSON.stringify({ exposed: clean }, null, 2), { mode: 0o600 });
  return clean;
}

/** Quick check: is (nodeId, widgetName) in the saved set for this template? */
export function isExposed(templateName: string, nodeId: string, widgetName: string): boolean {
  const saved = getForTemplate(templateName);
  return saved.some(e => e.nodeId === nodeId && e.widgetName === widgetName);
}
