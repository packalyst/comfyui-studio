import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

/**
 * Maps ComfyUI models/<subdir> layout to shared hub folder names (same as extra_model_paths.yaml).
 */
export const COMFY_DIR_TO_HUB_SUBDIR: Record<string, string> = {
  checkpoints: 'main',
  loras: 'lora',
  vae: 'vae',
  embeddings: 'embeddings',
  hypernetworks: 'hypernetworks',
  clip: 'clip',
  clip_vision: 'clip_vision',
  controlnet: 'controlnet',
  inpaint: 'inpaint',
  upscale_models: 'upscale_models',
  ipadapter: 'ipadapter',
  unet: 'unet',
  style_models: 'style_models',
  facerestore_models: 'facerestore_models',
  diffusion_models: 'diffusion_models',
  text_encoders: 'text_encoders',
};

/** Host path where the shared model tree is mounted (see Deployment volume modellib-hub). */
export function getSharedModelHubRoot(): string {
  return (process.env.SHARED_MODEL_HUB_PATH || config.sharedModelHubPath || '/mnt/olares-shared-model').trim();
}

export function hubSubdirForComfyTopDir(topDir: string): string {
  return COMFY_DIR_TO_HUB_SUBDIR[topDir] || topDir;
}

/**
 * Resolve a model file: try local ComfyUI models tree first, then shared hub.
 */
export function resolveModelFilePath(modelsRoot: string, dirRelative: string, outFile: string): string | null {
  const local = path.join(modelsRoot, dirRelative, outFile);
  if (fs.existsSync(local)) return local;

  const hubRoot = getSharedModelHubRoot();
  if (!hubRoot || !fs.existsSync(hubRoot)) return null;

  const segments = dirRelative.split(/[/\\]/).filter(Boolean);
  if (segments.length === 0) return null;
  const top = segments[0];
  const rest = segments.slice(1);
  const hubTop = hubSubdirForComfyTopDir(top);
  const hubPath = path.join(hubRoot, hubTop, ...rest, outFile);
  if (fs.existsSync(hubPath)) return hubPath;
  return null;
}

/** Distinct hub subdirectories to scan for installed files (one path per hub folder). */
function uniqueHubSubdirs(): string[] {
  return [...new Set(Object.values(COMFY_DIR_TO_HUB_SUBDIR))];
}

/** Existing hub directories to deep-scan (same layout as ComfyUI extra paths). */
export function getExistingHubScanDirs(): string[] {
  const hubRoot = getSharedModelHubRoot();
  if (!hubRoot || !fs.existsSync(hubRoot)) return [];
  return uniqueHubSubdirs()
    .map((s) => path.join(hubRoot, s))
    .filter((p) => fs.existsSync(p));
}
