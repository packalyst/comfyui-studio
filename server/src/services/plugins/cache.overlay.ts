// Helpers extracted from `cache.service.ts` so both the in-memory cache and
// the tests can import the pure-function pieces without dragging in the
// sqlite connection. Nothing here touches disk.

import type { getAllInstalledPlugins } from './info.service.js';

export interface CatalogPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  repository: string;
  version: string;
  latest_version?: unknown;
  versions?: unknown[];
  publisher?: unknown;
  status: string;
  status_detail: string;
  rating: number;
  downloads: number;
  github_stars: number;
  icon: string;
  banner_url: string;
  category: string;
  license: string;
  tags: string[];
  dependencies?: string[];
  supported_accelerators?: unknown;
  supported_comfyui_frontend_version?: string;
  supported_comfyui_version?: string;
  supported_os?: unknown;
  created_at: string;
  installed: boolean;
  installedOn?: string;
  disabled: boolean;
  install_type: string;
  stars: number;
  github: string;
}

export function entryToCatalogPlugin(info: Record<string, unknown>): CatalogPlugin {
  const latest = info.latest_version as { version?: string } | undefined;
  return {
    id: String(info.id ?? ''),
    name: String(info.name ?? ''),
    description: String(info.description ?? ''),
    author: String(info.author ?? ''),
    repository: String(info.repository ?? ''),
    version: latest?.version || 'nv-4',
    latest_version: info.latest_version,
    versions: Array.isArray(info.versions) ? info.versions : [],
    publisher: info.publisher,
    status: String(info.status ?? 'NodeStatusActive'),
    status_detail: String(info.status_detail ?? ''),
    rating: Number(info.rating ?? 0),
    downloads: Number(info.downloads ?? 0),
    github_stars: Number(info.github_stars ?? 0),
    icon: String(info.icon ?? ''),
    banner_url: String(info.banner_url ?? ''),
    category: String(info.category ?? ''),
    license: String(info.license ?? '{}'),
    tags: Array.isArray(info.tags) ? info.tags as string[] : [],
    dependencies: Array.isArray((latest as Record<string, unknown> | undefined)?.dependencies)
      ? (latest as Record<string, unknown>).dependencies as string[] : [],
    supported_accelerators: info.supported_accelerators,
    supported_comfyui_frontend_version: String(info.supported_comfyui_frontend_version ?? ''),
    supported_comfyui_version: String(info.supported_comfyui_version ?? ''),
    supported_os: info.supported_os,
    created_at: typeof info.created_at === 'string' ? info.created_at : new Date().toISOString(),
    installed: false,
    disabled: false,
    install_type: 'git_clone',
    stars: Number(info.github_stars ?? 0),
    github: String(info.repository ?? ''),
  };
}

function normalizeGithubUrl(url: string): string {
  return (url || '').toLowerCase()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

export function overlayInstalled(
  source: CatalogPlugin[],
  installed: ReturnType<typeof getAllInstalledPlugins>,
): CatalogPlugin[] {
  const byId = new Map<string, (typeof installed)[number]>();
  const byUrl = new Map<string, (typeof installed)[number]>();
  for (const p of installed) {
    byId.set(p.id.toLowerCase(), p);
    const u = normalizeGithubUrl(p.repository || '');
    if (u) byUrl.set(u, p);
  }
  const merged = source.map((p) => {
    const local = byId.get(p.id.toLowerCase())
      ?? byUrl.get(normalizeGithubUrl(p.repository || p.github || ''));
    if (!local) return { ...p, github: p.repository || p.github };
    return {
      ...p,
      installed: true,
      installedOn: local.installedOn || p.installedOn,
      disabled: local.disabled ?? p.disabled ?? false,
      version: local.version || p.version,
      name: local.name || p.name,
      description: local.description || p.description,
      repository: local.repository || p.repository || p.github,
      github: local.repository || p.repository || p.github,
      stars: p.github_stars || p.stars,
    };
  });
  for (const local of installed) {
    const seen = merged.some((p) => p.id.toLowerCase() === local.id.toLowerCase()
      || normalizeGithubUrl(p.repository || p.github || '') === normalizeGithubUrl(local.repository || ''));
    if (!seen) {
      merged.push({
        ...entryToCatalogPlugin(local as unknown as Record<string, unknown>),
        installed: true,
        installedOn: local.installedOn,
        disabled: local.disabled,
      });
    }
  }
  return merged;
}
