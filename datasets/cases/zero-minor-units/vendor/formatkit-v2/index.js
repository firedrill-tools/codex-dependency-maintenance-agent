export function formatCurrency({ minorUnits, currency }) {
  if (!Number.isInteger(minorUnits) || minorUnits < 0) throw new Error('invalid minor units');
  if (!['USD', 'CAD', 'JPY'].includes(currency)) throw new Error('unsupported currency');
  const scale = currency === 'JPY' ? 1 : 100;
  const digits = currency === 'JPY' ? 0 : 2;
  return `${currency} ${(minorUnits / scale).toFixed(digits)}`;
}
