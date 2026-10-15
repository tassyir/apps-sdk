// The page's own words, in the dashboard's two languages. The page follows
// the dashboard's language (App Bridge's context), never the browser's.

export const MESSAGES = {
  en: {
    title: 'Pending orders',
    notEmbedded:
      'Open this page from the Tassyir dashboard: Apps, then this app.',
    empty: 'No pending orders',
    emptyHint: 'Orders waiting for confirmation show up here.',
    more: 'Showing the 20 newest.',
    received: (count: number) =>
      count === 1
        ? '1 new order reached this app by webhook since it was installed.'
        : `${String(count)} new orders reached this app by webhook since it was installed.`,
    order: 'Order',
    total: 'Total',
    actions: 'Actions',
    open: 'Open',
    openOrder: (number: string) => `Open order #${number}`,
    highValue: 'High value',
    settings: 'Settings',
    settingsHint: 'Kept in the app’s own storage on Tassyir Hosting.',
    highlightLabel: 'Highlight orders from (amount)',
    highlightHint: 'Leave it empty to highlight none.',
    invalidAmount: 'Enter an amount such as 5000 or 5000.50.',
    saved: 'Settings saved',
    failed: 'Something went wrong. Try again.',
  },
  ar: {
    title: 'الطلبات المعلّقة',
    notEmbedded:
      'افتح هذه الصفحة من لوحة تحكم تسيير: التطبيقات، ثم هذا التطبيق.',
    empty: 'لا توجد طلبات معلّقة',
    emptyHint: 'تظهر هنا الطلبات التي تنتظر التأكيد.',
    more: 'يُعرض أحدث 20 طلبًا.',
    received: (count: number) =>
      `عدد الطلبات الجديدة التي وصلت إلى هذا التطبيق عبر الويب هوك منذ تثبيته: ${String(count)}.`,
    order: 'الطلب',
    total: 'المجموع',
    actions: 'إجراءات',
    open: 'فتح',
    openOrder: (number: string) => `فتح الطلب #${number}`,
    highValue: 'قيمة عالية',
    settings: 'الإعدادات',
    settingsHint: 'محفوظة في التخزين الخاص بالتطبيق على استضافة تسيير.',
    highlightLabel: 'تمييز الطلبات ابتداءً من (المبلغ)',
    highlightHint: 'اتركه فارغًا لعدم تمييز أي طلب.',
    invalidAmount: 'أدخل مبلغًا مثل 5000 أو 5000.50.',
    saved: 'تم حفظ الإعدادات',
    failed: 'حدث خطأ. حاول مرة أخرى.',
  },
} as const;

export type Locale = keyof typeof MESSAGES;
export type Messages = (typeof MESSAGES)[Locale];
