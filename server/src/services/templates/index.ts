// Barrel for the templates service split. Callers import this as
// `services/templates/index.js`; the module re-exports everything the old
// single-file templates.ts used to expose so router code stays unchanged.

export type { TemplateData, FormInputData, TemplatePluginEntry } from './types.js';
export {
  loadTemplatesFromComfyUI,
  getTemplates,
  getTemplate,
  getTemplateNames,
  seedTemplatesOnce,
} from './templates.service.js';
export { extractDeps, extractNodeTypes } from './depExtract.js';
export type { ExtractedDeps } from './depExtract.js';
export {
  extractDepsWithPluginResolution,
  resolutionsToRepoKeys,
} from './extractDepsAsync.js';
export type {
  ExtractedDepsAsync,
  PluginResolution,
} from './extractDepsAsync.js';
export { refreshTemplates } from './refresh.js';
export type { RefreshResult } from './refresh.js';
export { installMissingPluginsForTemplate } from './installMissingPlugins.js';
export type { InstallMissingResult } from './installMissingPlugins.js';
export { isReady, recomputeReadinessFor } from './readiness.js';
export {
  saveUserWorkflow,
  listUserWorkflows,
  deleteUserWorkflow,
  isUserWorkflow,
  getUserWorkflowJson,
  slugifyTemplateName,
} from './userTemplates.js';
export type { SaveWorkflowInput } from './userTemplates.js';
export {
  getStaging,
  abortStaging,
  toManifest,
  looksLikeLitegraph,
} from './importStaging.js';
export type {
  StagedImport,
  StagedImportManifest,
  StagedWorkflowEntry,
  ImportSource,
} from './importStaging.js';
export { stageFromZip, stageFromJson } from './importZip.js';
export {
  stageFromRemoteUrl,
  stageFromPastedJson,
  normaliseGithubUrl,
} from './importRemote.js';
export { commitStaging } from './importCommit.js';
export type { CommitSelection, CommitResult } from './importCommit.js';
export {
  extractWorkflowIo,
  deriveMediaType,
  mediaTypeToStudioCategory,
} from './metadata.js';
