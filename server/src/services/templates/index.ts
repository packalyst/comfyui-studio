// Barrel for the templates service split. Callers import this as
// `services/templates/index.js`; the module re-exports everything the old
// single-file templates.ts used to expose so router code stays unchanged.

export type { TemplateData, FormInputData } from './types.js';
export {
  loadTemplatesFromComfyUI,
  getTemplates,
  getTemplate,
  getTemplateNames,
  seedTemplatesOnce,
} from './templates.service.js';
export { extractDeps } from './depExtract.js';
export type { ExtractedDeps } from './depExtract.js';
export { refreshTemplates } from './refresh.js';
export type { RefreshResult } from './refresh.js';
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
