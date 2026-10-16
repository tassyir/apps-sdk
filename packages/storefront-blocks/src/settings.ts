import { blockSettingVariable } from './css/theme-variables.js';
import type { BlockSettingDeclaration } from './declaration.js';
import { isStoredImage, linkKind } from './urls.js';

/** A colour, as the manifest declares one: `#rrggbb`. */
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const ID = /^\d{1,20}$/;
const DEFAULT_MAX_LENGTH = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** A text value: a string, or `{ ar, fr, en }` strings (read with `| t`). */
function textValue(value: unknown, maxLength: number): unknown {
  if (typeof value === 'string')
    return value.length <= maxLength ? value : undefined;
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const language of ['ar', 'fr', 'en']) {
    const text = value[language];
    if (text === undefined) continue;
    if (typeof text !== 'string' || text.length > maxLength) return undefined;
    out[language] = text;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function inRange(n: number, setting: BlockSettingDeclaration): boolean {
  return (
    (setting.min === undefined || n >= setting.min) &&
    (setting.max === undefined || n <= setting.max)
  );
}

/** One value checked against its setting, or undefined when it does not fit. */
function checkSetting(
  setting: BlockSettingDeclaration,
  value: unknown,
): unknown {
  switch (setting.type) {
    case 'string':
    case 'text':
      return textValue(value, setting.max_length ?? DEFAULT_MAX_LENGTH);
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'integer':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        inRange(value, setting)
        ? value
        : undefined;
    case 'number':
      return typeof value === 'number' &&
        Number.isFinite(value) &&
        inRange(value, setting)
        ? value
        : undefined;
    case 'select':
      return typeof value === 'string' &&
        (setting.options ?? []).some((o) => o.value === value)
        ? value
        : undefined;
    case 'color':
      return typeof value === 'string' && COLOR.test(value)
        ? value.toLowerCase()
        : undefined;
    case 'image':
      return typeof value === 'string' && isStoredImage(value)
        ? value
        : undefined;
    case 'url':
      return typeof value === 'string' && linkKind(value) !== null
        ? value
        : undefined;
    case 'product':
    case 'collection':
      return typeof value === 'string' && ID.test(value) ? value : undefined;
    default:
      // A type this version does not know (a later phase's): a plain value.
      return typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
        ? value
        : undefined;
  }
}

/**
 * The values a block renders with: for every declared setting, the merchant's
 * value when it fits the declaration, else the declared default (checked the
 * same way), else nil. Undeclared values are dropped. Use it on every render:
 * a version update can change a setting's rules after the merchant saved.
 */
export function resolveBlockSettings(
  settings: readonly BlockSettingDeclaration[],
  values: unknown,
): Record<string, unknown> {
  const given = isRecord(values) ? values : {};
  const resolved: Record<string, unknown> = {};
  for (const setting of settings) {
    const own = Object.hasOwn(given, setting.key)
      ? checkSetting(setting, given[setting.key])
      : undefined;
    resolved[setting.key] =
      own ?? checkSetting(setting, setting.default) ?? null;
  }
  return resolved;
}

/**
 * The CSS variables the block's section carries, so the stylesheet can use a
 * colour the merchant picked: `accent_color` → `--block-accent-color: #c0392b`.
 * Colour settings only; values already checked by `resolveBlockSettings`.
 * builder-core sets these on the section, never inside the block's HTML.
 */
export function blockCssVariables(
  settings: readonly BlockSettingDeclaration[],
  resolved: Record<string, unknown>,
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const setting of settings) {
    const value = resolved[setting.key];
    if (
      setting.type === 'color' &&
      typeof value === 'string' &&
      COLOR.test(value)
    ) {
      variables[blockSettingVariable(setting.key)] = value;
    }
  }
  return variables;
}
