import type {
  BlockDeclaration,
  BlockSettingDeclaration,
} from './declaration.js';
import type { BlockRenderContext } from './render.js';
import { resolveBlockSettings } from './settings.js';

export type SampleLanguage = 'ar' | 'fr' | 'en';

const STORE: Readonly<
  Record<SampleLanguage, { name: string; direction: 'rtl' | 'ltr' }>
> = {
  ar: { name: 'دار أمينة', direction: 'rtl' },
  fr: { name: 'Dar Amina', direction: 'ltr' },
  en: { name: 'Dar Amina', direction: 'ltr' },
};

const PRODUCT_NAME: Readonly<Record<SampleLanguage, string>> = {
  ar: 'قفطان مطرز',
  fr: 'Caftan brodé',
  en: 'Embroidered kaftan',
};

/** A sample value for a setting that declares no default. */
function sampleValue(setting: BlockSettingDeclaration): unknown {
  switch (setting.type) {
    case 'string':
    case 'text':
      return { ar: 'نص تجريبي', fr: 'Texte d’exemple', en: 'Sample text' };
    case 'boolean':
      return true;
    case 'integer':
    case 'number':
      return setting.min ?? 3;
    case 'select':
      return setting.options?.[0]?.value;
    case 'color':
      return '#0b6e4f';
    case 'image':
      return 'https://cdn.tassyir.io/images/sample-banner/public';
    case 'url':
      return '/collections/all';
    case 'product':
    case 'collection':
      return '700000000000000001';
    default:
      return undefined;
  }
}

/**
 * A complete render context with sample data, for previews without a store
 * (`tassyir block preview`, the review checks, the validator's test render):
 * the store "Dar Amina", a product with a price and a compare-at price, every
 * declared setting at its default (or a sample value), and the app data you
 * pass (none by default: a block must render without its data).
 */
export function sampleBlockContext(
  declaration: BlockDeclaration = {},
  options: {
    language?: SampleLanguage;
    appData?: BlockRenderContext['appData'];
  } = {},
): BlockRenderContext {
  const language = options.language ?? 'ar';
  const settings = declaration.settings ?? [];
  const withSamples = settings.map((setting) =>
    setting.default === undefined
      ? { ...setting, default: sampleValue(setting) }
      : setting,
  );
  const context: BlockRenderContext = {
    store: {
      name: STORE[language].name,
      url: 'https://dar-amina.tassyir.io',
      locale: language,
      direction: STORE[language].direction,
      currency: 'DZD',
    },
    settings: resolveBlockSettings(withSamples, {}),
    appData: options.appData ?? {},
  };
  if (declaration.target === 'product') {
    context.product = {
      id: '700000000000000001',
      name: PRODUCT_NAME[language],
      url: '/product/embroidered-kaftan',
      price: '4500.00',
      compareAtPrice: '5200.00',
      currency: 'DZD',
      image: 'https://cdn.tassyir.io/images/sample-kaftan/public',
      available: true,
    };
  }
  return context;
}
