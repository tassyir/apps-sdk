// create-tassyir-app: starts a Tassyir app from a template, as
// `npm create tassyir-app@latest` (src/cli.ts) or from code (an agent's tool).
// One template today, `external` (the developer's own server); `hosted`
// (Tassyir Hosting) waits for AP-B1.14 to AP-B1.16.

export { createProject, handleFromFolder, nameFromHandle } from './create.js';
export type { CreateProjectOptions, CreateProjectResult } from './create.js';

export { CreateError, isCreateError } from './errors.js';
export type { CreateErrorCode, CreateProblem } from './errors.js';

export {
  TEMPLATE_DEPENDENCIES,
  TEMPLATES,
  templateDirectory,
} from './templates.js';
export type { TemplateInfo, TemplateName } from './templates.js';
