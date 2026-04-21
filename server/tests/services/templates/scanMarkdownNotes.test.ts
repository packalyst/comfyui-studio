// Tests for the MarkdownNote / Note URL scraper.
//
// Coverage:
//   - API format (dict keyed by node id with `class_type`).
//   - UI/LiteGraph format (`{ nodes: [...] }`).
//   - Nested subgraph.nodes recursion.
//   - Filters non-HF/Civit URLs.
//   - Dedupes across multiple notes.

import { describe, expect, it } from 'vitest';
import { extractModelUrlsFromWorkflow } from '../../../src/services/templates/scanMarkdownNotes.js';

describe('extractModelUrlsFromWorkflow', () => {
  it('pulls HF + CivitAI URLs from API-format MarkdownNote widgets', () => {
    const wf = {
      '1': {
        class_type: 'MarkdownNote',
        widgets_values: [
          'Download from https://huggingface.co/org/repo/blob/main/a.safetensors then unpack.',
        ],
      },
      '2': {
        class_type: 'KSampler',
        widgets_values: ['not a url'],
      },
    };
    const out = extractModelUrlsFromWorkflow(wf);
    expect(out).toEqual([
      'https://huggingface.co/org/repo/blob/main/a.safetensors',
    ]);
  });

  it('pulls URLs from UI-format Note nodes', () => {
    const wf = {
      nodes: [
        { id: 1, type: 'Note', widgets_values: ['civitai: https://civitai.com/models/123'] },
        { id: 2, type: 'Note', widgets_values: ['also https://civitai.com/api/download/models/456 and https://huggingface.co/a/b/resolve/main/f.safetensors'] },
        { id: 3, type: 'KSampler', widgets_values: ['nope'] },
      ],
    };
    const out = extractModelUrlsFromWorkflow(wf);
    expect(out.sort()).toEqual([
      'https://civitai.com/api/download/models/456',
      'https://civitai.com/models/123',
      'https://huggingface.co/a/b/resolve/main/f.safetensors',
    ]);
  });

  it('recurses into subgraph nodes', () => {
    const wf = {
      nodes: [
        {
          id: 1,
          type: 'Subgraph',
          subgraph: {
            nodes: [
              { id: 2, type: 'MarkdownNote', widgets_values: ['https://huggingface.co/a/b/blob/main/c.safetensors'] },
            ],
          },
        },
      ],
    };
    const out = extractModelUrlsFromWorkflow(wf);
    expect(out).toEqual(['https://huggingface.co/a/b/blob/main/c.safetensors']);
  });

  it('filters out arbitrary hosts', () => {
    const wf = {
      nodes: [
        { id: 1, type: 'MarkdownNote', widgets_values: [
          'https://example.com/foo https://cdn.random.net/file.bin https://huggingface.co/a/b/blob/main/c.safetensors',
        ] },
      ],
    };
    const out = extractModelUrlsFromWorkflow(wf);
    expect(out).toEqual(['https://huggingface.co/a/b/blob/main/c.safetensors']);
  });

  it('dedupes identical URLs across notes and strips trailing punctuation', () => {
    const wf = {
      nodes: [
        { id: 1, type: 'MarkdownNote', widgets_values: [
          'See https://huggingface.co/a/b/blob/main/c.safetensors, which is needed.',
        ] },
        { id: 2, type: 'MarkdownNote', widgets_values: [
          'Mirror (https://huggingface.co/a/b/blob/main/c.safetensors).',
        ] },
      ],
    };
    const out = extractModelUrlsFromWorkflow(wf);
    expect(out).toEqual(['https://huggingface.co/a/b/blob/main/c.safetensors']);
  });

  it('returns [] for empty / malformed workflows', () => {
    expect(extractModelUrlsFromWorkflow(null)).toEqual([]);
    expect(extractModelUrlsFromWorkflow({})).toEqual([]);
    expect(extractModelUrlsFromWorkflow({ nodes: [] })).toEqual([]);
  });

  it('reads URLs from the `inputs` block of API-format notes', () => {
    const wf = {
      '1': {
        class_type: 'Note',
        inputs: { body: 'please fetch https://civitai.com/models/99' },
      },
    };
    const out = extractModelUrlsFromWorkflow(wf);
    expect(out).toEqual(['https://civitai.com/models/99']);
  });
});
