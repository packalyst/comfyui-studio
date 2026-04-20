// Readiness integration: verify that the event bus hooks in
// `services/templates/eventSubscribers.ts` correctly flip the `installed`
// flag on the templates repo in response to model/plugin lifecycle events.
//
// We stub the models + plugins catalog loaders by monkey-patching the
// relevant services with lightweight in-memory sets, so no disk I/O is
// needed — the only real component under test is the event wiring and the
// recomputeReadinessFor() reconciliation path.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as bus from '../../src/lib/events.js';
import * as repo from '../../src/lib/db/templates.repo.js';
import { rewireForTests } from '../../src/services/templates/eventSubscribers.js';
import { useFreshDb } from '../lib/db/_helpers.js';

// vi.hoisted keeps the shared state visible to both the factory and the
// test body, surviving the top-of-file mock hoisting that vitest does.
const state = vi.hoisted(() => ({
  models: new Set<string>(),
  plugins: new Set<string>(),
}));

vi.mock('../../src/services/models/models.service.js', () => ({
  scanAndRefresh: async () =>
    Array.from(state.models).map((fn) => ({
      filename: fn, name: fn, installed: true,
    })),
  toWireEntry: (m: { filename: string; name: string; installed: boolean }) => m,
}));

vi.mock('../../src/services/plugins/cache.service.js', () => ({
  getAllPlugins: () =>
    Array.from(state.plugins).map((id) => ({
      id, installed: true, disabled: false, repository: '', github: '',
    })),
}));

async function waitForReadinessUpdate(): Promise<void> {
  // Event handlers are fire-and-forget; microtask flush + a tick is enough
  // for the recompute promise chain to settle in unit tests.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 0));
}

describe('template readiness (event-driven)', () => {
  useFreshDb();

  beforeEach(() => {
    state.models.clear();
    state.plugins.clear();
    bus.resetForTests();
    rewireForTests();
  });

  afterEach(() => {
    bus.resetForTests();
  });

  it('flips installed=1 for a template after its required model is installed', async () => {
    repo.upsertTemplate(
      {
        name: 't1', displayName: 'T1', category: 'Image',
        description: '', source: 'open', tags_json: '[]', installed: false,
      },
      { models: ['needed.safetensors'], plugins: [] },
    );
    expect(repo.getInstalledFlag('t1')).toBe(false);

    state.models.add('needed.safetensors');
    bus.emit('model:installed', { filename: 'needed.safetensors' });
    await waitForReadinessUpdate();

    expect(repo.getInstalledFlag('t1')).toBe(true);
  });

  it('flips installed=0 when a required model is removed', async () => {
    state.models.add('needed.safetensors');
    repo.upsertTemplate(
      {
        name: 't1', displayName: 'T1', category: 'Image',
        description: '', source: 'open', tags_json: '[]', installed: false,
      },
      { models: ['needed.safetensors'], plugins: [] },
    );
    // Seed as ready (simulate it was already computed).
    repo.setInstalledForTemplates(['t1'], true);
    expect(repo.getInstalledFlag('t1')).toBe(true);

    state.models.delete('needed.safetensors');
    bus.emit('model:removed', { filename: 'needed.safetensors' });
    await waitForReadinessUpdate();
    expect(repo.getInstalledFlag('t1')).toBe(false);
  });

  it('flips installed=1 for a template after its required plugin is installed', async () => {
    repo.upsertTemplate(
      {
        name: 't2', displayName: 'T2', category: 'Tools',
        description: '', source: 'open', tags_json: '[]', installed: false,
      },
      { models: [], plugins: ['alice/some-pack'] },
    );
    expect(repo.getInstalledFlag('t2')).toBe(false);

    state.plugins.add('alice/some-pack');
    bus.emit('plugin:installed', { pluginId: 'alice/some-pack' });
    await waitForReadinessUpdate();
    expect(repo.getInstalledFlag('t2')).toBe(true);
  });

  it('flips installed=0 when a required plugin is disabled', async () => {
    state.plugins.add('alice/some-pack');
    repo.upsertTemplate(
      {
        name: 't2', displayName: 'T2', category: 'Tools',
        description: '', source: 'open', tags_json: '[]', installed: true,
      },
      { models: [], plugins: ['alice/some-pack'] },
    );
    expect(repo.getInstalledFlag('t2')).toBe(true);
    bus.emit('plugin:disabled', { pluginId: 'alice/some-pack' });
    await waitForReadinessUpdate();
    expect(repo.getInstalledFlag('t2')).toBe(false);
  });

  it('only recomputes templates that actually reference the changed dep', async () => {
    repo.upsertTemplate(
      {
        name: 'a', displayName: 'A', category: 'Image',
        description: '', source: 'open', tags_json: '[]', installed: true,
      },
      { models: ['a.safetensors'], plugins: [] },
    );
    repo.upsertTemplate(
      {
        name: 'b', displayName: 'B', category: 'Image',
        description: '', source: 'open', tags_json: '[]', installed: true,
      },
      { models: ['b.safetensors'], plugins: [] },
    );
    // Remove a.safetensors -> only template 'a' should flip.
    bus.emit('model:removed', { filename: 'a.safetensors' });
    await waitForReadinessUpdate();
    expect(repo.getInstalledFlag('a')).toBe(false);
    expect(repo.getInstalledFlag('b')).toBe(true);
  });
});
