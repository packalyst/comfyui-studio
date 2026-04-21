// Tests for the LoadImage/PreviewImage/SaveImage rename rewriter invoked
// at commit time after reference images are copied under their slug prefix.
//
// Coverage:
//   - API format (node keyed by id, class_type, inputs).
//   - UI/LiteGraph format (`{ nodes: [...] }`, widgets_values).
//   - Empty mapping -> deep clone, no changes.
//   - Filenames not in the mapping stay untouched.
//   - Input is not mutated (deep clone guarantee).

import { describe, expect, it } from 'vitest';
import { rewriteLoadImageReferences } from '../../../src/services/templates/rewriteLoadImage.js';

describe('rewriteLoadImageReferences', () => {
  it('rewrites LoadImage widgets in UI format', () => {
    const wf = {
      nodes: [
        { id: 1, type: 'LoadImage', widgets_values: ['preview.png', 'image'] },
        { id: 2, type: 'KSampler', widgets_values: ['preview.png'] },
      ],
    };
    const out = rewriteLoadImageReferences(wf, {
      'preview.png': 'slug__preview.png',
    }) as typeof wf;
    expect(out.nodes[0].widgets_values[0]).toBe('slug__preview.png');
    // KSampler widget values are not touched even if they happen to match.
    expect(out.nodes[1].widgets_values[0]).toBe('preview.png');
  });

  it('rewrites LoadImage inputs in API format', () => {
    const wf = {
      '1': { class_type: 'LoadImage', inputs: { image: 'preview.png' } },
      '2': { class_type: 'SaveImage', inputs: { filename_prefix: 'preview.png' } },
    };
    const out = rewriteLoadImageReferences(wf, {
      'preview.png': 'slug__preview.png',
    }) as Record<string, Record<string, Record<string, string>>>;
    expect(out['1'].inputs.image).toBe('slug__preview.png');
    expect(out['2'].inputs.filename_prefix).toBe('slug__preview.png');
  });

  it('returns a deep clone for an empty mapping', () => {
    const wf = {
      nodes: [{ id: 1, type: 'LoadImage', widgets_values: ['x.png'] }],
    };
    const out = rewriteLoadImageReferences(wf, {}) as typeof wf;
    expect(out).toEqual(wf);
    expect(out).not.toBe(wf);
    expect(out.nodes).not.toBe(wf.nodes);
  });

  it('leaves filenames that are not in the mapping untouched', () => {
    const wf = {
      nodes: [
        { id: 1, type: 'LoadImage', widgets_values: ['a.png'] },
        { id: 2, type: 'LoadImage', widgets_values: ['b.png'] },
      ],
    };
    const out = rewriteLoadImageReferences(wf, { 'a.png': 'slug__a.png' }) as typeof wf;
    expect(out.nodes[0].widgets_values[0]).toBe('slug__a.png');
    expect(out.nodes[1].widgets_values[0]).toBe('b.png');
  });

  it('does not mutate the input workflow', () => {
    const wf = {
      nodes: [{ id: 1, type: 'LoadImage', widgets_values: ['p.png'] }],
    };
    const snapshot = JSON.parse(JSON.stringify(wf));
    rewriteLoadImageReferences(wf, { 'p.png': 'slug__p.png' });
    expect(wf).toEqual(snapshot);
  });

  it('rewrites LoadImage inside a nested subgraph', () => {
    const wf = {
      nodes: [{
        id: 1,
        type: 'Subgraph',
        subgraph: {
          nodes: [{ id: 2, type: 'LoadImage', widgets_values: ['p.png'] }],
        },
      }],
    };
    const out = rewriteLoadImageReferences(wf, { 'p.png': 'slug__p.png' }) as {
      nodes: Array<{ subgraph: { nodes: Array<{ widgets_values: string[] }> } }>;
    };
    expect(out.nodes[0].subgraph.nodes[0].widgets_values[0]).toBe('slug__p.png');
  });

  it('rewrites PreviewImage + SaveImage in UI format too', () => {
    const wf = {
      nodes: [
        { id: 1, type: 'PreviewImage', widgets_values: ['p.png'] },
        { id: 2, type: 'SaveImage', widgets_values: ['p.png'] },
      ],
    };
    const out = rewriteLoadImageReferences(wf, { 'p.png': 'x' }) as typeof wf;
    expect(out.nodes[0].widgets_values[0]).toBe('x');
    expect(out.nodes[1].widgets_values[0]).toBe('x');
  });
});
