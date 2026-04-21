// Tests for the CivitAI URL resolver used by the Wave E import review
// step "Resolve via URL" affordance.
//
// Coverage:
//   - api/download/models/<versionId> resolves via model-versions endpoint.
//   - /models/<id>?modelVersionId=<v> resolves via model-versions endpoint.
//   - /models/<id> falls back to modelVersions[0] on the model endpoint.
//   - 404 returns null.
//   - Empty files[] returns null.
//   - Model type -> suggestedFolder mapping matches the contract.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCivitaiUrl } from '../../../src/services/models/resolveCivitai.js';

function makeVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 2222,
    modelId: 1111,
    baseModel: 'SDXL',
    files: [{
      id: 999, name: 'awesome.safetensors', sizeKB: 2048, primary: true,
      downloadUrl: 'https://civitai.com/api/download/models/2222',
    }],
    model: { type: 'LORA', name: 'Awesome Lora' },
    ...overrides,
  };
}

function makeModel(type: string, versions: Array<Record<string, unknown>>): Record<string, unknown> {
  return { id: 1111, name: 'Awesome', type, modelVersions: versions };
}

function respondOnce(handler: (url: string) => Response | Promise<Response>): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    return handler(url);
  });
}

describe('resolveCivitaiUrl', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('resolves an api/download/models/<versionId> URL via model-versions', async () => {
    respondOnce((url) => {
      expect(url).toMatch(/\/model-versions\/2222$/);
      return new Response(JSON.stringify(makeVersion()), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const out = await resolveCivitaiUrl('https://civitai.com/api/download/models/2222');
    expect(out).not.toBeNull();
    expect(out!.source).toBe('civitai');
    expect(out!.fileName).toBe('awesome.safetensors');
    expect(out!.sizeBytes).toBe(2048 * 1024);
    expect(out!.suggestedFolder).toBe('loras');
    expect(out!.civitai).toEqual({
      modelId: 1111, versionId: 2222, modelType: 'LORA', baseModel: 'SDXL',
    });
  });

  it('resolves /models/<id>?modelVersionId=<v> via model-versions', async () => {
    respondOnce((url) => {
      expect(url).toMatch(/\/model-versions\/5555$/);
      return new Response(JSON.stringify(makeVersion({ id: 5555 })), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const out = await resolveCivitaiUrl(
      'https://civitai.com/models/1111/slug?modelVersionId=5555',
    );
    expect(out).not.toBeNull();
    expect(out!.civitai?.versionId).toBe(5555);
  });

  it('falls back to modelVersions[0] on /models/<id>', async () => {
    respondOnce((url) => {
      expect(url).toMatch(/\/models\/1111$/);
      return new Response(JSON.stringify(
        makeModel('Checkpoint', [makeVersion({ id: 7777 }), makeVersion({ id: 8888 })]),
      ), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const out = await resolveCivitaiUrl('https://civitai.com/models/1111/slug');
    expect(out).not.toBeNull();
    expect(out!.civitai?.versionId).toBe(7777);
    expect(out!.suggestedFolder).toBe('checkpoints');
    // Model.type wins over version.model.type for the folder guess.
    expect(out!.civitai?.modelType).toBe('Checkpoint');
  });

  it('returns null on a 404', async () => {
    respondOnce(() => new Response('', { status: 404 }));
    const out = await resolveCivitaiUrl('https://civitai.com/api/download/models/123');
    expect(out).toBeNull();
  });

  it('returns null when the version has no files', async () => {
    respondOnce(() => new Response(JSON.stringify(makeVersion({ files: [] })), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const out = await resolveCivitaiUrl('https://civitai.com/api/download/models/123');
    expect(out).toBeNull();
  });

  it('returns null when /models/<id> has no modelVersions', async () => {
    respondOnce(() => new Response(JSON.stringify({ id: 1, name: 'x' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const out = await resolveCivitaiUrl('https://civitai.com/models/1');
    expect(out).toBeNull();
  });

  it('returns null for non-CivitAI hosts', async () => {
    const out = await resolveCivitaiUrl('https://example.com/models/1');
    expect(out).toBeNull();
  });

  it('maps model types to the right folders', async () => {
    const cases: Array<{ type: string; folder: string }> = [
      { type: 'Checkpoint', folder: 'checkpoints' },
      { type: 'LORA', folder: 'loras' },
      { type: 'TextualInversion', folder: 'embeddings' },
      { type: 'VAE', folder: 'vae' },
      { type: 'Controlnet', folder: 'controlnet' },
      { type: 'Upscaler', folder: 'upscale_models' },
    ];
    for (const c of cases) {
      respondOnce(() => new Response(
        JSON.stringify(makeModel(c.type, [makeVersion({ id: 100 })])),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));
      const out = await resolveCivitaiUrl('https://civitai.com/models/1');
      expect(out?.suggestedFolder).toBe(c.folder);
      vi.restoreAllMocks();
    }
  });
});
