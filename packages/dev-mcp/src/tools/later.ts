import * as z from 'zod';
import { laterTool } from '../tool.js';

// The tools that wait for the platform. Each is listed under its planned
// name, so an agent learns it exists and why it cannot run, and answers
// TOOL_NOT_AVAILABLE with what to do instead. When its platform side ships,
// it becomes a defineTool with its real input.
//   tail_logs  the log stream of apps on Tassyir Hosting

export const tailLogs = laterTool({
  name: 'tail_logs',
  title: "Tail a hosted app's logs",
  description: 'It will stream the logs of an app running on Tassyir Hosting.',
  input: z.looseObject({}),
  reason: 'it reads the logs of apps on Tassyir Hosting, which is not open yet',
  fix: 'Your app runs on your own server: read its own output. For webhook deliveries, run `tassyir webhook deliveries --json` (the delivery log of the last 30 days).',
});
