import { cleanRenderedText } from '../characters.js';
import { BLOCK_LIMITS } from '../limits.js';
import { isBlockImageSource, linkKind } from '../urls.js';
import type { AttributeRule } from './allowlist.js';

const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
const DATETIME = /^[0-9][0-9TZ:+\-. ]{3,39}$/;
const INTEGER = /^-?\d{1,7}$/;
const NUMBER = /^-?\d{1,9}(?:\.\d{1,6})?$/;
const CLASS_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const SVG_LENGTH = /^-?(?:\d{1,6}(?:\.\d{1,6})?|\.\d{1,6})(?:%|px|em|rem)?$/;
const SVG_PATH = /^[0-9eE.,+\-\sMmLlHhVvCcSsQqTtAaZz]*$/;
const SVG_POINTS = /^[0-9eE.,+\-\s]*$/;
const SVG_VIEWBOX = /^-?[0-9.]+(?:[\s,]+-?[0-9.]+){3}$/;
const SVG_PAINT =
  /^(?:none|currentcolor|transparent|#[0-9A-Fa-f]{3,8}|[A-Za-z]{3,20}|(?:rgba?|hsla?)\([0-9.,%\s]{1,60}\))$/i;
const SVG_TRANSFORM =
  /^\s*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([0-9eE.,+\-\s]{0,120}\)\s*)*$/;
const SVG_DASHARRAY = /^(?:none|[0-9.,\s%]{1,120})$/;
const SVG_ASPECT =
  /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?: (?:meet|slice))?$/;

/**
 * An attribute value checked against its rule: the value to write (decoded,
 * cleaned of control and bidi characters, not escaped yet), or null to drop
 * the attribute. `value` is already decoded.
 */
export function checkAttributeValue(
  rule: AttributeRule,
  value: string,
): string | null {
  if (value.length > BLOCK_LIMITS.attributeLength) return null;
  switch (rule.kind) {
    case 'text':
      return cleanRenderedText(value);
    case 'boolean':
      return '';
    case 'fixed':
      return value === rule.value ? value : null;
    case 'enum':
      return rule.values.includes(value) ? value : null;
    case 'integer': {
      if (!INTEGER.test(value)) return null;
      const n = Number(value);
      return n >= rule.min && n <= rule.max ? String(n) : null;
    }
    case 'number':
      return NUMBER.test(value) ? value : null;
    case 'classes': {
      const tokens = value
        .split(/[ \t\n\f\r]+/)
        .filter((token) => CLASS_TOKEN.test(token))
        .slice(0, 20);
      return tokens.length === 0 ? null : tokens.join(' ');
    }
    case 'link':
      return linkKind(value) === null ? null : value;
    case 'image':
      return isBlockImageSource(value) ? value : null;
    case 'language':
      return LANGUAGE.test(value) ? value : null;
    case 'datetime':
      return DATETIME.test(value) ? value : null;
    case 'svg-length':
      return SVG_LENGTH.test(value) ? value : null;
    case 'svg-path':
      return SVG_PATH.test(value) ? value : null;
    case 'svg-points':
      return SVG_POINTS.test(value) ? value : null;
    case 'svg-viewbox':
      return SVG_VIEWBOX.test(value) ? value : null;
    case 'svg-paint':
      return SVG_PAINT.test(value) ? value : null;
    case 'svg-transform':
      return SVG_TRANSFORM.test(value) ? value : null;
    case 'svg-dasharray':
      return SVG_DASHARRAY.test(value) ? value : null;
    case 'svg-aspect':
      return SVG_ASPECT.test(value) ? value : null;
  }
}
