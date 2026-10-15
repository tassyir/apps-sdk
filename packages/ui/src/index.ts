/**
 * @tassyir/ui: web components that make an app's page inside the Tassyir
 * dashboard look like the dashboard. Importing this module defines every
 * element (in a browser; on a server it only exports).
 */
import { TsyBanner } from './banner.js';
import { TsyButton } from './button.js';
import { TsyCard } from './card.js';
import { TsyCheckbox } from './checkbox.js';
import { define } from './element.js';
import { TsyEmptyState } from './empty-state.js';
import { TsyLink } from './link.js';
import { TsyPageHeader } from './page-header.js';
import { TsyRadio, TsyRadioGroup } from './radio.js';
import { TsySelect } from './select.js';
import { TsySkeleton } from './skeleton.js';
import { TsySpinner } from './spinner.js';
import { TsyStatusPill } from './status-pill.js';
import { TsyTable } from './table.js';
import { TsyTextField } from './text-field.js';

/** Every element this package defines, by tag name. */
export const ELEMENTS = {
  'tsy-button': TsyButton,
  'tsy-link': TsyLink,
  'tsy-text-field': TsyTextField,
  'tsy-select': TsySelect,
  'tsy-checkbox': TsyCheckbox,
  'tsy-radio-group': TsyRadioGroup,
  'tsy-radio': TsyRadio,
  'tsy-card': TsyCard,
  'tsy-page-header': TsyPageHeader,
  'tsy-table': TsyTable,
  'tsy-status-pill': TsyStatusPill,
  'tsy-banner': TsyBanner,
  'tsy-empty-state': TsyEmptyState,
  'tsy-skeleton': TsySkeleton,
  'tsy-spinner': TsySpinner,
} as const;

for (const [name, element] of Object.entries(ELEMENTS)) {
  define(name, element);
}

declare global {
  interface HTMLElementTagNameMap {
    'tsy-button': TsyButton;
    'tsy-link': TsyLink;
    'tsy-text-field': TsyTextField;
    'tsy-select': TsySelect;
    'tsy-checkbox': TsyCheckbox;
    'tsy-radio-group': TsyRadioGroup;
    'tsy-radio': TsyRadio;
    'tsy-card': TsyCard;
    'tsy-page-header': TsyPageHeader;
    'tsy-table': TsyTable;
    'tsy-status-pill': TsyStatusPill;
    'tsy-banner': TsyBanner;
    'tsy-empty-state': TsyEmptyState;
    'tsy-skeleton': TsySkeleton;
    'tsy-spinner': TsySpinner;
  }
}

export {
  TsyBanner,
  TsyButton,
  TsyCard,
  TsyCheckbox,
  TsyEmptyState,
  TsyLink,
  TsyPageHeader,
  TsyRadio,
  TsyRadioGroup,
  TsySelect,
  TsySkeleton,
  TsySpinner,
  TsyStatusPill,
  TsyTable,
  TsyTextField,
};
export { BANNER_TONES, type BannerTone } from './banner.js';
export {
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  type ButtonSize,
  type ButtonVariant,
} from './button.js';
export {
  applyDashboardContext,
  followDashboardContext,
  type DashboardContext,
  type DashboardContextSource,
} from './context.js';
export { SKELETON_SHAPES, type SkeletonShape } from './skeleton.js';
export { SPINNER_SIZES, type SpinnerSize } from './spinner.js';
export { PILL_TONES, type PillTone } from './status-pill.js';
export { TEXT_FIELD_TYPES, type TextFieldType } from './text-field.js';
export {
  breakpoints,
  colors,
  COLOR_TOKENS,
  cssVariable,
  fonts,
  fontSizes,
  fontWeights,
  lineHeights,
  radii,
  shadows,
  space,
  tokensCss,
  type ColorToken,
  type Theme,
} from './tokens.js';
