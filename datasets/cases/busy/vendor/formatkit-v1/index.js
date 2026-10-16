export function formatMoney(cents, currency) {
  if (!Number.isInteger(cents) || cents < 0) throw new Error('invalid cents');
  return `${currency} ${(cents / 100).toFixed(2)}`;
}
