// The @tassyir/ui demo: a page an app might show in the dashboard, then a
// catalogue of every element. ?locale=ar|en and ?theme=light|dark set what
// App Bridge's context.changed would (applyDashboardContext).
import { applyDashboardContext } from '/dist/index.js';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
applyDashboardContext({
  locale,
  dir: locale === 'ar' ? 'rtl' : 'ltr',
  theme,
});

const T = {
  en: {
    title: 'Review requests',
    meta: '12 sent this week · 4 answered',
    settings: 'Settings',
    send: 'Send requests',
    infoBanner: 'Requests go out by SMS the day after delivery.',
    lowHeading: 'SMS credit is low',
    lowBody: '120 messages left. Top up before Friday.',
    topUp: 'Top up',
    failHeading: 'Could not reach 2 buyers',
    failBody: 'The carrier refused their phone numbers.',
    saved: 'Settings saved.',
    orders: 'Recent orders',
    export: 'Export',
    search: 'Search orders',
    order: 'Order',
    buyer: 'Buyer',
    total: 'Total',
    status: 'Status',
    view: 'View',
    rows: [
      [
        '#00001042',
        'Sara Bensalem',
        'Oran',
        'DZD 9,000',
        'success',
        'Delivered',
      ],
      [
        '#00001043',
        'Yacine Haddad',
        'Alger',
        'DZD 4,500',
        'warning',
        'Pending',
      ],
      [
        '#00001044',
        'Rim Belkacem',
        'Sétif',
        'DZD 12,300',
        'destructive',
        'Returned',
      ],
      [
        '#00001045',
        'Leila Mansouri',
        'Constantine',
        'DZD 6,750',
        'info',
        'In transit',
      ],
    ],
    pager: '1–4 of 4',
    previous: 'Previous',
    next: 'Next',
    form: 'Request settings',
    sender: 'Sender name',
    senderHint: 'Shown at the top of the SMS.',
    minimum: 'Minimum order total',
    currency: 'DZD',
    delay: 'Send after',
    delays: ['1 day', '2 days', '3 days'],
    wilaya: 'Wilaya',
    allWilayas: 'All wilayas',
    phone: 'Phone for replies',
    phoneError: 'Enter a phone number of 10 digits.',
    message: 'Message',
    messageValue: 'How was your order? Reply with a number from 1 to 5.',
    channel: 'Channel',
    whatsappHint: 'Needs a connected number',
    email: 'Email',
    skip: 'Skip buyers who returned an order',
    weekends: 'Send on weekends',
    archived: 'Include archived stores',
    save: 'Save',
    reset: 'Reset',
    empty: 'Answers',
    emptyHeading: 'No answers yet',
    emptyBody: 'Answers appear here once buyers reply to a request.',
    test: 'Send a test request',
    catalogue: 'Catalogue',
    buttons: 'Buttons',
    primary: 'Primary',
    outline: 'Outline',
    ghost: 'Ghost',
    destructive: 'Delete',
    small: 'Small',
    large: 'Large',
    loading: 'Saving',
    disabled: 'Disabled',
    asLink: 'As a link',
    more: 'More actions',
    pills: 'Status pills',
    tones: [
      'Neutral',
      'Delivered',
      'Pending',
      'Cancelled',
      'In transit',
      'Custom field',
    ],
    customStatus: 'Called twice',
    locked: 'Locked',
    links: 'Links',
    help: 'Read the guide',
    docs: 'Developer docs',
    linkSentence: 'Questions? %s, or open the %s.',
    loadingTitle: 'Loading',
    spinners: 'Spinners',
    language: 'العربية',
    light: 'Light',
    dark: 'Dark',
  },
  ar: {
    title: 'طلبات التقييم',
    meta: '12 طلبًا هذا الأسبوع · 4 ردود',
    settings: 'الإعدادات',
    send: 'أرسل الطلبات',
    infoBanner: 'تُرسَل الطلبات برسالة نصية في اليوم التالي للتسليم.',
    lowHeading: 'رصيد الرسائل منخفض',
    lowBody: 'بقيت 120 رسالة. اشحن الرصيد قبل الجمعة.',
    topUp: 'اشحن الرصيد',
    failHeading: 'تعذّر الوصول إلى مشتريَين',
    failBody: 'رفض المزوّد رقمَي هاتفيهما.',
    saved: 'تم حفظ الإعدادات.',
    orders: 'الطلبيات الأخيرة',
    export: 'تصدير',
    search: 'ابحث في الطلبيات',
    order: 'الطلبية',
    buyer: 'الزبون',
    total: 'المجموع',
    status: 'الحالة',
    view: 'عرض',
    rows: [
      [
        '#00001042',
        'سارة بن سالم',
        'وهران',
        '9.000 دج',
        'success',
        'تم التسليم',
      ],
      [
        '#00001043',
        'ياسين حداد',
        'الجزائر',
        '4.500 دج',
        'warning',
        'قيد الانتظار',
      ],
      ['#00001044', 'ريم بلقاسم', 'سطيف', '12.300 دج', 'destructive', 'مرتجع'],
      ['#00001045', 'ليلى منصوري', 'قسنطينة', '6.750 دج', 'info', 'في الطريق'],
    ],
    pager: '1–4 من 4',
    previous: 'السابق',
    next: 'التالي',
    form: 'إعدادات الطلب',
    sender: 'اسم المرسل',
    senderHint: 'يظهر في أعلى الرسالة.',
    minimum: 'أدنى مبلغ للطلبية',
    currency: 'دج',
    delay: 'الإرسال بعد',
    delays: ['يوم واحد', 'يومين', '3 أيام'],
    wilaya: 'الولاية',
    allWilayas: 'كل الولايات',
    phone: 'هاتف الردود',
    phoneError: 'أدخل رقم هاتف من 10 أرقام.',
    message: 'الرسالة',
    messageValue: 'كيف كانت طلبيتك؟ أجب برقم من 1 إلى 5.',
    channel: 'القناة',
    whatsappHint: 'يتطلب رقمًا مربوطًا',
    email: 'البريد الإلكتروني',
    skip: 'تجاوز الزبائن الذين أرجعوا طلبية',
    weekends: 'الإرسال في عطلة نهاية الأسبوع',
    archived: 'تضمين المتاجر المؤرشفة',
    save: 'حفظ',
    reset: 'إعادة تعيين',
    empty: 'الردود',
    emptyHeading: 'لا توجد ردود بعد',
    emptyBody: 'تظهر الردود هنا عندما يجيب الزبائن على الطلب.',
    test: 'أرسل طلبًا تجريبيًا',
    catalogue: 'الكتالوج',
    buttons: 'الأزرار',
    primary: 'رئيسي',
    outline: 'محدد',
    ghost: 'شفاف',
    destructive: 'حذف',
    small: 'صغير',
    large: 'كبير',
    loading: 'جارٍ الحفظ',
    disabled: 'معطّل',
    asLink: 'كرابط',
    more: 'إجراءات أخرى',
    pills: 'شارات الحالة',
    tones: [
      'محايد',
      'تم التسليم',
      'قيد الانتظار',
      'ملغاة',
      'في الطريق',
      'حقل مخصص',
    ],
    customStatus: 'اتصلنا مرتين',
    locked: 'مقفل',
    links: 'الروابط',
    help: 'اقرأ الدليل',
    docs: 'وثائق المطورين',
    linkSentence: 'أسئلة؟ %s، أو افتح %s.',
    loadingTitle: 'التحميل',
    spinners: 'مؤشرات التحميل',
    language: 'English',
    light: 'فاتح',
    dark: 'داكن',
  },
}[locale];

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const dots =
  '<svg slot="media" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"/></svg>';
const lock =
  '<svg slot="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const dotsMenu =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>';

const otherLocale = locale === 'ar' ? 'en' : 'ar';
const link = (query, label) =>
  `<tsy-link href="?${esc(query)}">${esc(label)}</tsy-link>`;

const rows = T.rows
  .map(
    ([number, buyer, wilaya, total, tone, status]) => `
      <tr>
        <td><span class="mono">${esc(number)}</span></td>
        <td><span class="buyer"><span>${esc(buyer)}</span><span>${esc(wilaya)}</span></span></td>
        <td data-align="end">${esc(total)}</td>
        <td><tsy-status-pill tone="${esc(tone)}">${esc(status)}</tsy-status-pill></td>
        <td data-align="end"><tsy-link href="#${esc(number.slice(1))}">${esc(T.view)}</tsy-link></td>
      </tr>`,
  )
  .join('');

const sentence = T.linkSentence
  .replace('%s', `<tsy-link href="#guide">${esc(T.help)}</tsy-link>`)
  .replace(
    '%s',
    `<tsy-link href="https://developers.tassyir.io" external>${esc(T.docs)}</tsy-link>`,
  );

const html = `
<nav class="switch" aria-label="Demo">
  ${link(`locale=${otherLocale}&theme=${theme}`, T.language)}
  ${link(`locale=${locale}&theme=light`, T.light)}
  ${link(`locale=${locale}&theme=dark`, T.dark)}
</nav>

<tsy-page-header heading="${esc(T.title)}" back-href="#apps">
  <span slot="meta">${esc(T.meta)}</span>
  <tsy-button slot="actions">${esc(T.settings)}</tsy-button>
  <tsy-button slot="actions" variant="primary">${esc(T.send)}</tsy-button>
</tsy-page-header>

<div class="stack">
  <tsy-banner>${esc(T.infoBanner)}</tsy-banner>
  <tsy-banner tone="warning" heading="${esc(T.lowHeading)}" dismissible>
    ${esc(T.lowBody)}
    <tsy-button slot="actions" size="sm">${esc(T.topUp)}</tsy-button>
  </tsy-banner>
  <tsy-banner tone="critical" heading="${esc(T.failHeading)}">${esc(T.failBody)}</tsy-banner>
  <tsy-banner tone="success" dismissible>${esc(T.saved)}</tsy-banner>
</div>

<tsy-table heading="${esc(T.orders)}" count="${T.rows.length}">
  <tsy-button slot="actions" variant="ghost" size="sm">${esc(T.export)}</tsy-button>
  <tsy-text-field slot="toolbar" type="search" label="${esc(T.search)}" label-hidden placeholder="${esc(T.search)}"></tsy-text-field>
  <table>
    <thead><tr><th>${esc(T.order)}</th><th>${esc(T.buyer)}</th><th data-align="end">${esc(T.total)}</th><th>${esc(T.status)}</th><th><span class="sr-only">${esc(T.view)}</span></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div slot="footer" class="row pager">
    <span class="label">${esc(T.pager)}</span>
    <span class="row"><tsy-button size="sm" disabled>${esc(T.previous)}</tsy-button><tsy-button size="sm" disabled>${esc(T.next)}</tsy-button></span>
  </div>
</tsy-table>

<div class="columns">
  <tsy-card heading="${esc(T.form)}">
    <form class="form" id="settings">
      <tsy-text-field name="sender" label="${esc(T.sender)}" value="Dar Amina" hint="${esc(T.senderHint)}" required></tsy-text-field>
      <tsy-text-field name="minimum" type="number" min="0" label="${esc(T.minimum)}" value="2500" suffix="${esc(T.currency)}" inputmode="numeric"></tsy-text-field>
      <tsy-select name="delay" label="${esc(T.delay)}" value="2">
        ${T.delays.map((label, i) => `<option value="${i + 1}">${esc(label)}</option>`).join('')}
      </tsy-select>
      <tsy-select name="wilaya" label="${esc(T.wilaya)}" placeholder="${esc(T.allWilayas)}">
        <option value="16">16 · ${esc(T.rows[1][2])}</option>
        <option value="31">31 · ${esc(T.rows[0][2])}</option>
      </tsy-select>
      <tsy-text-field name="phone" type="tel" label="${esc(T.phone)}" value="0555 12" error="${esc(T.phoneError)}"></tsy-text-field>
      <tsy-text-field name="message" label="${esc(T.message)}" multiline rows="3" value="${esc(T.messageValue)}"></tsy-text-field>
      <tsy-radio-group name="channel" label="${esc(T.channel)}" value="sms">
        <tsy-radio value="sms">SMS</tsy-radio>
        <tsy-radio value="whatsapp" hint="${esc(T.whatsappHint)}">WhatsApp</tsy-radio>
        <tsy-radio value="email" disabled>${esc(T.email)}</tsy-radio>
      </tsy-radio-group>
      <div>
        <tsy-checkbox name="skip" checked>${esc(T.skip)}</tsy-checkbox>
        <tsy-checkbox name="weekends">${esc(T.weekends)}</tsy-checkbox>
        <tsy-checkbox name="archived" disabled>${esc(T.archived)}</tsy-checkbox>
      </div>
      <div class="form-actions">
        <tsy-button type="reset" variant="ghost">${esc(T.reset)}</tsy-button>
        <tsy-button type="submit">${esc(T.save)}</tsy-button>
      </div>
    </form>
  </tsy-card>

  <div class="stack">
    <tsy-card heading="${esc(T.empty)}" flush>
      <tsy-empty-state heading="${esc(T.emptyHeading)}">
        ${dots}
        ${esc(T.emptyBody)}
        <tsy-button slot="actions">${esc(T.test)}</tsy-button>
      </tsy-empty-state>
    </tsy-card>

    <tsy-card heading="${esc(T.loadingTitle)}" aria-busy="true">
      <div class="stack tight">
        <div class="row"><tsy-skeleton shape="circle"></tsy-skeleton><tsy-skeleton lines="2" class="grow"></tsy-skeleton></div>
        <tsy-skeleton shape="block"></tsy-skeleton>
        <tsy-skeleton lines="3"></tsy-skeleton>
      </div>
    </tsy-card>
  </div>
</div>

<tsy-card heading="${esc(T.catalogue)}">
  <div class="stack">
    <section>
      <p class="label">${esc(T.buttons)}</p>
      <div class="row">
        <tsy-button variant="primary">${esc(T.primary)}</tsy-button>
        <tsy-button>${esc(T.outline)}</tsy-button>
        <tsy-button variant="ghost">${esc(T.ghost)}</tsy-button>
        <tsy-button variant="destructive">${esc(T.destructive)}</tsy-button>
        <tsy-button size="sm">${esc(T.small)}</tsy-button>
        <tsy-button size="lg">${esc(T.large)}</tsy-button>
        <tsy-button variant="primary" loading>${esc(T.loading)}</tsy-button>
        <tsy-button disabled>${esc(T.disabled)}</tsy-button>
        <tsy-button href="#link">${esc(T.asLink)}</tsy-button>
        <tsy-button square aria-label="${esc(T.more)}">${dotsMenu}</tsy-button>
      </div>
    </section>
    <section>
      <p class="label">${esc(T.pills)}</p>
      <div class="row">
        ${['neutral', 'success', 'warning', 'destructive', 'info', 'purple']
          .map(
            (tone, i) =>
              `<tsy-status-pill tone="${tone}">${esc(T.tones[i])}</tsy-status-pill>`,
          )
          .join('')}
        <tsy-status-pill color="#e11d48">${esc(T.customStatus)}</tsy-status-pill>
        <tsy-status-pill tone="warning" size="md">${lock}${esc(T.locked)}</tsy-status-pill>
      </div>
    </section>
    <section>
      <p class="label">${esc(T.links)}</p>
      <p class="plain">${sentence}</p>
    </section>
    <section>
      <p class="label">${esc(T.spinners)}</p>
      <div class="row"><tsy-spinner size="sm"></tsy-spinner><tsy-spinner></tsy-spinner><tsy-spinner size="lg"></tsy-spinner></div>
    </section>
  </div>
</tsy-card>
`;

// The page requires Trusted Types (scripts/demo-server.mjs): the demo's own
// markup goes through a policy. @tassyir/ui never writes HTML.
const policy = window.trustedTypes?.createPolicy('tassyir-ui-demo', {
  createHTML: (text) => text,
});
const app = document.querySelector('#app');
app.innerHTML = policy ? policy.createHTML(html) : html;
app.removeAttribute('aria-busy');

document.querySelector('#settings').addEventListener('submit', (event) => {
  event.preventDefault();
});
