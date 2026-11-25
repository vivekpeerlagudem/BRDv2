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

export function formatMetric(m: Pick<SalesMetric, 'unit' | 'value'> | undefined, currency: string): string {
  if (!m || m.value === null) return '–';
  if (m.unit === 'money') return formatMoney(m.value, currency);
  if (m.unit === 'money_per_day') return `${formatMoney(m.value, currency)} / day`;
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
