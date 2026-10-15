import * as z from 'zod';
import { laterTool } from '../tool.js';

// The tools that wait for the platform. Each is listed under its planned
// name, so an agent learns it exists and why it cannot run, and answers
// TOOL_NOT_AVAILABLE with what to do instead. When its platform side ships,
// it becomes a defineTool with its real input.
//   validate_block     storefront blocks, Phase 2 (the marketplace)
//   tail_logs          Tassyir Hosting (AP-B1.14 to AP-B1.16)
//   run_review_checks  the review of public apps, Phase 2, and hosted uploads' scans

export const validateBlock = laterTool({
  name: 'validate_block',
  title: 'Validate a storefront block',
  description:
    "It will check a storefront block's template against the rules a block upload must pass.",
  input: z.looseObject({}),
  reason:
    'storefront blocks arrive with the marketplace (Phase 2); until then the manifest refuses [[storefront.blocks]] and the write_storefront scope',
  fix: 'Build what your app needs with an embedded page ([admin] page) and webhooks for now: fetch_doc { "slug": "embedded-pages" }.',
});

export const tailLogs = laterTool({
  name: 'tail_logs',
  title: "Tail a hosted app's logs",
  description: 'It will stream the logs of an app running on Tassyir Hosting.',
  input: z.looseObject({}),
  reason: 'it reads the logs of apps on Tassyir Hosting, which is not open yet',
  fix: 'Your app runs on your own server: read its own output. For webhook deliveries, run `tassyir webhook deliveries --json` (the delivery log of the last 30 days).',
});

export const runReviewChecks = laterTool({
  name: 'run_review_checks',
  title: 'Run the review checks',
  description:
    'It will run the automated checks a version must pass before review (manifest against code, scopes, outside hosts, banned APIs).',
  input: z.looseObject({}),
  reason:
    'the checks come with the review of public apps (Phase 2) and the scans of Tassyir Hosting uploads',
  fix: 'Custom apps need no review today: run validate_manifest and your own tests, then `tassyir deploy`.',
});
