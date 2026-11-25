/**
 * One way to write figures in the Weekly Sales Brief, everywhere: slides, the brief page, the facts the AI copies
 * from, and the findings. Money is "USD 37,000" (organization currency, en-US thousands separators, no ".00" for whole
 * amounts; cents only when there are any). Pure functions, no dependencies.
 */
import type { SalesMetric } from '../../db/schema-sales-brief.ts';

const grouped = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** "74000.00" → "74,000" · "1250.50" → "1,250.50" · null → "–". */
export function formatAmount(value: string | null): string {
  if (value === null) return '–';
  const [whole = '0', cents = ''] = value.split('.');
  return `${whole.startsWith('-') ? '-' : ''}${grouped(whole.replace('-', ''))}${cents && !/^0+$/.test(cents) ? `.${cents}` : ''}`;
}
/** "74000.00", "USD" → "USD 74,000". */
export const formatMoney = (value: string | null, currency: string): string => (value === null ? '–' : `${currency} ${formatAmount(value)}`);

/** "10161.94" → "10162" · "-2.5" → "-3" (half away from zero), on the decimal string, without floating point. */
function roundWhole(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', cents = ''] = value.replace('-', '').split('.');
  let digits = whole;
  if ((cents[0] ?? '0') >= '5') {
    const out: string[] = [];
    let carry = 1;
    for (let i = digits.length - 1; i >= 0; i--) {
      const d = Number(digits[i]) + carry;
      out.unshift(String(d % 10));
      carry = d >= 10 ? 1 : 0;
    }
    digits = (carry ? '1' : '') + out.join('');
  }
  return `${negative && digits !== '0' ? '-' : ''}${digits}`;
}

export function formatMetric(m: Pick<SalesMetric, 'unit' | 'value'> | undefined, currency: string): string {
  if (!m || m.value === null) return '–';
  if (m.unit === 'money') return formatMoney(m.value, currency);
  // A rate per day is an average, so it is shown whole like every other amount: "USD 10,162 / day" (half up).
  if (m.unit === 'money_per_day') return `${formatMoney(roundWhole(m.value), currency)} / day`;
  if (m.unit === 'percent') return `${m.value}%`;
  if (m.unit === 'days') return `${m.value} days`;
  return m.value;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** An instant as a calendar date in the organization's time zone: "23 Nov 2026". */
export function formatDay(iso: string, timeZone: string): string {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso))
    .split('-')
    .map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export const asOfLabel = (iso: string, timeZone: string) => `Pipeline and attention as of ${formatDay(iso, timeZone)}`;
export const VELOCITY_NOTE = 'Sales velocity uses quarter-to-date averages';
