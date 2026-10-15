// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, pick, reset, settle, shadow } from './dom.test-harness.js';
import './index.js';
import { sheet } from './element.js';
import { TABLE_CSS } from './table.js';
import type { TsyCard } from './card.js';
import type { TsyEmptyState } from './empty-state.js';
import type { TsyPageHeader } from './page-header.js';
import type { TsyTable } from './table.js';

afterEach(reset);

describe('<tsy-card>', () => {
  it('is a plain paper card without a heading', () => {
    const card = mount<TsyCard>('<tsy-card>Body</tsy-card>');
    const base = pick(shadow(card), '[part="base"]');
    expect(base.classList.contains('layered')).toBe(false);
    expect(pick(shadow(card), '[part="header"]').hidden).toBe(true);
  });

  it('is the layered card with a heading: an h2 by default, a count, actions', async () => {
    const card = mount<TsyCard>(`
      <tsy-card heading="Pending orders" count="12">
        <tsy-button slot="actions">Export</tsy-button>
        Body
      </tsy-card>`);
    await settle();
    const root = shadow(card);
    expect(pick(root, '[part="base"]').classList.contains('layered')).toBe(
      true,
    );
    const heading = pick(root, '[part="heading"]');
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe('Pending orders');
    expect(pick(root, '[part="count"]').textContent).toBe('12');
    expect(pick(root, '[part="actions"]').hidden).toBe(false);

    card.setAttribute('heading-level', '3');
    expect(pick(root, '[part="heading"]').tagName).toBe('H3');
    card.setAttribute('heading-level', '9');
    expect(pick(root, '[part="heading"]').tagName).toBe('H2');
  });
});

describe('<tsy-page-header>', () => {
  it('renders the page title as the one h1, with meta and actions when given', async () => {
    const header = mount<TsyPageHeader>(`
      <tsy-page-header heading="Review requests">
        <span slot="meta">12 sent this week</span>
        <tsy-button slot="actions" variant="primary">Send</tsy-button>
      </tsy-page-header>`);
    await settle();
    const root = shadow(header);
    expect(pick(root, 'h1').textContent).toBe('Review requests');
    expect(pick(root, '[part="meta"]').hidden).toBe(false);
    expect(pick(root, '[part="actions"]').hidden).toBe(false);
    expect(pick(root, '[part="back"]').hidden).toBe(true);
  });

  it('hides empty meta and actions', async () => {
    const header = mount<TsyPageHeader>(
      '<tsy-page-header heading="X"></tsy-page-header>',
    );
    await settle();
    expect(pick(shadow(header), '[part="meta"]').hidden).toBe(true);
    expect(pick(shadow(header), '[part="actions"]').hidden).toBe(true);
  });

  it('offers a back link worded in the page language', () => {
    document.documentElement.setAttribute('lang', 'ar');
    const header = mount<TsyPageHeader>(
      '<tsy-page-header heading="الطلب" back-href="/orders"></tsy-page-header>',
    );
    const back = pick<HTMLAnchorElement>(shadow(header), '[part="back"]');
    expect(back.hidden).toBe(false);
    expect(back.getAttribute('href')).toBe('/orders');
    expect(back.textContent).toBe('رجوع');
    header.setAttribute('back-label', 'All orders');
    expect(back.textContent).toBe('All orders');
  });
});

describe('<tsy-table>', () => {
  const ROWS = `
    <table>
      <thead><tr><th>Order</th><th data-align="end">Total</th></tr></thead>
      <tbody><tr><td>#00001042</td><td data-align="end">9.000 دج</td></tr></tbody>
    </table>`;

  it('styles its light-DOM table through a sheet adopted into the document', () => {
    mount(`<tsy-table heading="Orders">${ROWS}</tsy-table>`);
    expect(document.adoptedStyleSheets).toContain(sheet(TABLE_CSS));
  });

  it('adopts the sheet into the shadow root it lives in', () => {
    const host = mount('<div></div>');
    const root = host.attachShadow({ mode: 'open' });
    const table = document.createElement('tsy-table');
    table.innerHTML = ROWS;
    root.append(table);
    expect(root.adoptedStyleSheets).toContain(sheet(TABLE_CSS));
  });

  it('names the table after its heading unless the table has a name', async () => {
    const frame = mount<TsyTable>(
      `<tsy-table heading="Orders">${ROWS}</tsy-table>`,
    );
    await settle();
    const table = frame.table;
    expect(table?.getAttribute('aria-label')).toBe('Orders');
    frame.setAttribute('heading', 'Late orders');
    expect(table?.getAttribute('aria-label')).toBe('Late orders');
    frame.removeAttribute('heading');
    expect(table?.hasAttribute('aria-label')).toBe(false);

    const own = mount<TsyTable>(
      `<tsy-table heading="Orders"><table aria-label="Mine"></table></tsy-table>`,
    );
    await settle();
    expect(own.table?.getAttribute('aria-label')).toBe('Mine');
    const captioned = mount<TsyTable>(
      `<tsy-table heading="Orders"><table><caption>Today</caption></table></tsy-table>`,
    );
    await settle();
    expect(captioned.table?.hasAttribute('aria-label')).toBe(false);
  });

  it('shows the header, toolbar and footer only when they have content', async () => {
    const bare = mount<TsyTable>(`<tsy-table>${ROWS}</tsy-table>`);
    await settle();
    const root = shadow(bare);
    expect(pick(root, '[part="header"]').hidden).toBe(true);
    expect(pick(root, '[part="toolbar"]').hidden).toBe(true);
    expect(pick(root, '[part="footer"]').hidden).toBe(true);

    const full = mount<TsyTable>(`
      <tsy-table heading="Orders" count="3">
        <tsy-text-field slot="toolbar" label="Search" label-hidden></tsy-text-field>
        ${ROWS}
        <div slot="footer">1–3 of 3</div>
      </tsy-table>`);
    await settle();
    const fullRoot = shadow(full);
    expect(pick(fullRoot, '[part="header"]').hidden).toBe(false);
    expect(pick(fullRoot, '[part="count"]').textContent).toBe('3');
    expect(pick(fullRoot, '[part="toolbar"]').hidden).toBe(false);
    expect(pick(fullRoot, '[part="footer"]').hidden).toBe(false);
  });

  it("keeps its table rules in the app's cascade layer, scoped to tsy-table", () => {
    expect(TABLE_CSS.startsWith('@layer tassyir-ui{')).toBe(true);
    const selectors = TABLE_CSS.slice('@layer tassyir-ui{'.length)
      .split('}')
      .map((rule) => rule.split('{')[0]?.trim() ?? '')
      .filter((selector) => selector !== '' && !selector.startsWith('@'));
    for (const selector of selectors) {
      for (const part of selector.split(',')) {
        expect(part.trim()).toMatch(/^tsy-table(?:\[|>)/);
      }
    }
  });
});

describe('<tsy-empty-state>', () => {
  it('shows its heading, words and actions, and media only when given', async () => {
    const empty = mount<TsyEmptyState>(`
      <tsy-empty-state heading="No reviews yet">
        Reviews appear here once buyers answer.
        <tsy-button slot="actions" variant="primary">Send a request</tsy-button>
      </tsy-empty-state>`);
    await settle();
    const root = shadow(empty);
    expect(pick(root, '[part="heading"]').textContent).toBe('No reviews yet');
    expect(pick(root, '[part="media"]').hidden).toBe(true);
    expect(pick(root, '[part="actions"]').hidden).toBe(false);
    expect(pick(root, '[part="heading"]').hasAttribute('role')).toBe(false);
    empty.setAttribute('heading-level', '3');
    expect(pick(root, '[part="heading"]').getAttribute('role')).toBe('heading');
    expect(pick(root, '[part="heading"]').getAttribute('aria-level')).toBe('3');
  });
});

describe('shared styles', () => {
  it('are one sheet per text, shared by every element', () => {
    expect(sheet('a{color:red}')).toBe(sheet('a{color:red}'));
  });
});
