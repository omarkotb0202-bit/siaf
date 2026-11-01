const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function parts(value: string): { negative: boolean; digits: bigint; scale: number } {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new Error('Enter a valid decimal number.');
  const scale = match[3]?.length ?? 0;
  return { negative: match[1] === '-', digits: BigInt(`${match[2]}${match[3] ?? ''}`), scale };
}

export function assertDecimalPrecision(value: string, precision = 10): void {
  if (parts(value).scale > precision) throw new Error(`Use no more than ${precision} decimal places.`);
}

function render(digits: bigint, scale: number): string {
  const sign = digits < 0n ? '-' : '';
  const absolute = digits < 0n ? -digits : digits;
  const raw = absolute.toString().padStart(scale + 1, '0');
  if (scale === 0) return `${sign}${raw}`;
  const integer = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/, '');
  return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
}

/** Exact base-10 multiplication with round-half-up to the requested decimal places. */
export function multiplyDecimal(left: string, right: string, precision = 10): string {
  const a = parts(left); const b = parts(right);
  const product = a.digits * b.digits;
  const divisorScale = a.scale + b.scale;
  let result = product;
  if (divisorScale > precision) {
    const divisor = 10n ** BigInt(divisorScale - precision);
    result = (product + divisor / 2n) / divisor;
  } else if (divisorScale < precision) result *= 10n ** BigInt(precision - divisorScale);
  if (a.negative !== b.negative) result = -result;
  return render(result, precision);
}

export function compareDecimal(left: string, right: string): number {
  const a = parts(left); const b = parts(right); const scale = Math.max(a.scale, b.scale);
  let av = a.digits * 10n ** BigInt(scale - a.scale); let bv = b.digits * 10n ** BigInt(scale - b.scale);
  if (a.negative) av = -av; if (b.negative) bv = -bv;
  return av < bv ? -1 : av > bv ? 1 : 0;
}

export function absoluteDecimal(value: string): string {
  return value.startsWith('-') ? value.slice(1) : value;
}

export function subtractDecimal(left: string, right: string, precision = 10): string {
  const a = parts(left); const b = parts(right); const scale = Math.max(a.scale, b.scale, precision);
  let av = a.digits * 10n ** BigInt(scale - a.scale); let bv = b.digits * 10n ** BigInt(scale - b.scale);
  if (a.negative) av = -av; if (b.negative) bv = -bv;
  return render(av - bv, scale);
}

export function addDecimal(left: string, right: string, precision = 10): string {
  const a = parts(left); const b = parts(right); const scale = Math.max(a.scale, b.scale, precision);
  let av = a.digits * 10n ** BigInt(scale - a.scale); let bv = b.digits * 10n ** BigInt(scale - b.scale);
  if (a.negative) av = -av; if (b.negative) bv = -bv;
  return render(av + bv, scale);
}

export function divideDecimal(left: string, right: string, precision = 10): string {
  const a = parts(left); const b = parts(right);
  if (b.digits === 0n) throw new Error('Cannot divide by zero.');
  const numerator = a.digits * 10n ** BigInt(b.scale + precision);
  const denominator = b.digits * 10n ** BigInt(a.scale);
  const quotient = (numerator + denominator / 2n) / denominator;
  return render(a.negative !== b.negative ? -quotient : quotient, precision);
}
