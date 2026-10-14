import { lines, stringValue, table } from '../command.js';
import type { Command } from '../command.js';
import { usageError } from '../errors.js';

// store list | create: dev stores (tassyir/backend docs/api/apps/dev-stores.md),
// businesses made to build and test apps on, seeded with synthetic data, with
// every outside party and cost switched off. `store create` is the plan's
// `store seed`: a new dev store comes seeded unless --empty.

const DASHBOARD = 'https://app.tassyir.io/en';

export const storeListCommand: Command = {
  name: 'store list',
  summary: 'Your dev stores',
  usage: 'tassyir store list [options]',
  options: {},
  async run(context) {
    const { api } = await context.api();
    const stores = (await api.listDevStores()).data;
    return {
      data: { stores },
      text:
        stores.length === 0
          ? lines('No dev store yet: `tassyir store create`.')
          : lines(
              table(
                ['ID', 'NAME', 'CREATED', 'DASHBOARD'],
                stores.map((store) => [
                  store.id,
                  store.name,
                  store.createdAt,
                  `${DASHBOARD}${store.dashboardPath}`,
                ]),
              ),
            ),
    };
  },
};

export const storeCreateCommand: Command = {
  name: 'store create',
  summary: 'Create a dev store, seeded with products, orders and customers',
  usage: 'tassyir store create [options]',
  description: [
    'One store, ~30 products with variants, 200 orders in every state over the 58 wilayas,',
    'and buyers with fake phones. Nothing it does reaches a carrier, a customer or a payment',
    'provider. You own it, so your custom apps install there. At most 3 per developer, for',
    'good: a dev store cannot be deleted yet.',
  ].join('\n'),
  options: {
    name: {
      type: 'string',
      value: 'name',
      description: 'Default "Dev store".',
    },
    empty: {
      type: 'boolean',
      description: 'No seed data: one store, no products or orders.',
    },
  },
  async run(context, { values }) {
    const name = stringValue(values['name'])?.trim();
    if (
      name !== undefined &&
      (name === '' || name.length > 60 || /[\r\n]/.test(name))
    ) {
      throw usageError(
        '--name takes 1-60 characters on one line',
        'store create',
      );
    }
    const { api } = await context.api();
    const store = (
      await api.createDevStore({
        ...(name === undefined ? {} : { name }),
        ...(values['empty'] === true ? { seed: false } : {}),
      })
    ).data;
    const seed = store.seed;
    return {
      data: { store },
      text: lines(
        `✓ Created the dev store ${store.name} (${store.id}).`,
        `  Dashboard: ${DASHBOARD}${store.dashboardPath}`,
        store.store && `  Storefront subdomain: ${store.store.subdomain}`,
        seed &&
          `  Seeded: ${Object.entries(seed)
            .map(([key, count]) => `${String(count)} ${key}`)
            .join(', ')}.`,
        store.seedError &&
          `  ! Seeding failed (${store.seedError}): the dev store is usable, but empty.`,
        `  Install your app there from the developer console, then \`tassyir webhook trigger <topic>\`.`,
      ),
    };
  },
};
