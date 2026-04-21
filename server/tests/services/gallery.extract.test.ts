// Unit tests for the gallery metadata extractor.
//
// Covers the defensive cases required by Wave F:
//  - Full KSampler workflow → every field populated.
//  - Missing CLIPTextEncode → falls back to longest text encoder / null.
//  - Missing KSampler → all sampler fields null, prompt still resolves via
//    "longest CLIPTextEncode" heuristic.
//  - Empty/unknown input → all null, no throw.

import { describe, expect, it } from 'vitest';
import {
  extractMetadata,
  randomizeSeeds,
  type ApiPrompt,
} from '../../src/services/gallery.extract.js';

describe('extractMetadata', () => {
  it('returns all-null for empty/invalid input', () => {
    expect(extractMetadata(null)).toEqual({
      promptText: null, negativeText: null, seed: null, model: null,
      sampler: null, steps: null, cfg: null, width: null, height: null,
    });
    expect(extractMetadata(undefined)).toEqual(extractMetadata(null));
    expect(extractMetadata({} as ApiPrompt)).toEqual(extractMetadata(null));
  });

  it('extracts full metadata from a canonical SD1.5 workflow', () => {
    const prompt: ApiPrompt = {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'sd-v1-5.safetensors' },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'a corgi riding a skateboard', clip: ['1', 1] },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'blurry, ugly', clip: ['1', 1] },
      },
      '4': {
        class_type: 'EmptyLatentImage',
        inputs: { width: 512, height: 768, batch_size: 1 },
      },
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed: 123456789,
          steps: 20,
          cfg: 7.5,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1.0,
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
      },
    };
    const meta = extractMetadata(prompt);
    expect(meta.promptText).toBe('a corgi riding a skateboard');
    expect(meta.negativeText).toBe('blurry, ugly');
    expect(meta.seed).toBe(123456789);
    expect(meta.model).toBe('sd-v1-5.safetensors');
    expect(meta.sampler).toBe('euler');
    expect(meta.steps).toBe(20);
    expect(meta.cfg).toBe(7.5);
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(768);
  });

  it('falls back to longest CLIPTextEncode when there is no KSampler', () => {
    const prompt: ApiPrompt = {
      '1': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'short' },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'a much longer positive prompt describing the scene' },
      },
    };
    const meta = extractMetadata(prompt);
    expect(meta.promptText).toBe('a much longer positive prompt describing the scene');
    expect(meta.seed).toBeNull();
    expect(meta.sampler).toBeNull();
  });

  it('handles missing CLIPTextEncode entries on the sampler wires', () => {
    // The KSampler references nodes that don't exist / aren't text encoders
    // (e.g. a CLIPTextEncodeSDXL node). Positive text should fall back to
    // the longest text encoder; negative should be null-safe (empty string).
    const prompt: ApiPrompt = {
      '10': {
        class_type: 'SomeCustomPromptNode',
        inputs: { text: 'will not resolve' },
      },
      '11': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'fallback prompt via longest' },
      },
      '99': {
        class_type: 'KSampler',
        inputs: {
          seed: 42, steps: 10, cfg: 5.0, sampler_name: 'dpm++',
          positive: ['10', 0],
          negative: ['12', 0],
        },
      },
    };
    const meta = extractMetadata(prompt);
    expect(meta.promptText).toBe('fallback prompt via longest');
    expect(meta.negativeText).toBe('');
    expect(meta.seed).toBe(42);
    expect(meta.sampler).toBe('dpm++');
  });

  it('supports KSamplerAdvanced noise_seed and UNETLoader fallback', () => {
    const prompt: ApiPrompt = {
      '1': {
        class_type: 'UNETLoader',
        inputs: { unet_name: 'flux-dev.safetensors' },
      },
      '2': {
        class_type: 'KSamplerAdvanced',
        inputs: {
          noise_seed: 77,
          steps: 4,
          cfg: 1.0,
          sampler_name: 'euler_ancestral',
        },
      },
    };
    const meta = extractMetadata(prompt);
    expect(meta.seed).toBe(77);
    expect(meta.model).toBe('flux-dev.safetensors');
    expect(meta.steps).toBe(4);
  });
});

describe('randomizeSeeds', () => {
  it('mutates seed and noise_seed widgets on KSampler variants', () => {
    const prompt: ApiPrompt = {
      '1': {
        class_type: 'KSampler',
        inputs: { seed: 1, steps: 1, cfg: 1, sampler_name: 'euler' },
      },
      '2': {
        class_type: 'KSamplerAdvanced',
        inputs: { noise_seed: 2, steps: 1, cfg: 1, sampler_name: 'euler' },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'hi', seed: 3 }, // unrelated; must not be touched.
      },
    };
    const before3Seed = prompt['3']!.inputs!.seed;
    randomizeSeeds(prompt);
    expect(prompt['1']!.inputs!.seed).not.toBe(1);
    expect(prompt['2']!.inputs!.noise_seed).not.toBe(2);
    expect(prompt['3']!.inputs!.seed).toBe(before3Seed);
  });
});
