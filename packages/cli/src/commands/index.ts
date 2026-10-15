import type { Command } from '../command.js';
import { appCreateCommand, appInitCommand, appListCommand } from './app.js';
import { loginCommand, logoutCommand, whoamiCommand } from './auth.js';
import { devCommand, logsCommand, submitCommand } from './later.js';
import {
  appVersionCommand,
  deployCommand,
  validateCommand,
} from './manifest.js';
import {
  secretsCreateCommand,
  secretsListCommand,
  secretsRevokeCommand,
  secretsRotateCommand,
} from './secrets.js';
import { storeCreateCommand, storeListCommand } from './store.js';
import {
  webhookDeliveriesCommand,
  webhookReplayCommand,
  webhookTriggerCommand,
} from './webhook.js';

/** Every command, in the order `tassyir --help` lists them. */
export const COMMANDS: readonly Command[] = Object.freeze([
  loginCommand,
  logoutCommand,
  whoamiCommand,
  appInitCommand,
  appCreateCommand,
  appListCommand,
  appVersionCommand,
  validateCommand,
  deployCommand,
  secretsListCommand,
  secretsCreateCommand,
  secretsRotateCommand,
  secretsRevokeCommand,
  storeListCommand,
  storeCreateCommand,
  webhookTriggerCommand,
  webhookDeliveriesCommand,
  webhookReplayCommand,
  devCommand,
  logsCommand,
  submitCommand,
]);

/** The words that take a subcommand (`tassyir app create`). */
export const GROUPS: readonly string[] = Object.freeze([
  ...new Set(
    COMMANDS.filter((command) => command.name.includes(' ')).map(
      (command) => command.name.split(' ')[0] ?? '',
    ),
  ),
]);
