import { formatCurrency } from 'formatkit';

export function renderInvoice({ id, totalMinorUnits, currency }) {
  if (!id) throw new Error('invoice id required');
  return `${id} | ${formatCurrency({ minorUnits: totalMinorUnits, currency })}`;
}
