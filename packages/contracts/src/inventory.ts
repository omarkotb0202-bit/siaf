import { assertDecimalPrecision, compareDecimal, multiplyDecimal, subtractDecimal } from './decimal';

export type UnitDimension = 'count' | 'mass' | 'volume' | 'length' | 'custom';
export interface Unit { id: string; code: string; dimension: UnitDimension }
export interface UnitConversion { fromUnitId: string; toUnitId: string; factor: string; productId?: string; justification?: string }

export function normalizedQuantity(input: { quantity: string; enteredUnit: Unit; baseUnit: Unit; conversion?: UnitConversion; productId: string }): { factor: string; quantity: string } {
  assertDecimalPrecision(input.quantity);if(input.conversion)assertDecimalPrecision(input.conversion.factor);
  if (compareDecimal(input.quantity, '0') <= 0) throw new Error('Quantity must be greater than zero.');
  if (input.enteredUnit.id === input.baseUnit.id) return { factor: '1', quantity: multiplyDecimal(input.quantity, '1') };
  const rule = input.conversion;
  if (!rule || rule.fromUnitId !== input.enteredUnit.id || rule.toUnitId !== input.baseUnit.id) throw new Error('An explicit conversion to the product base unit is required.');
  const isMassVolume = (input.enteredUnit.dimension === 'mass' && input.baseUnit.dimension === 'volume') || (input.enteredUnit.dimension === 'volume' && input.baseUnit.dimension === 'mass');
  if (isMassVolume && (rule.productId !== input.productId || !rule.justification?.trim())) throw new Error('Mass and volume conversion requires a justified product-specific rule.');
  if (!isMassVolume && input.enteredUnit.dimension !== input.baseUnit.dimension) throw new Error('Units with different dimensions cannot be converted.');
  if (compareDecimal(rule.factor, '0') <= 0) throw new Error('Conversion factor must be greater than zero.');
  return { factor: rule.factor, quantity: multiplyDecimal(input.quantity, rule.factor) };
}

export type MovementKind = 'opening' | 'receipt' | 'issue' | 'transfer_out' | 'transfer_in' | 'transit_in' | 'transit_out' | 'adjustment' | 'fabric_cut_out' | 'fabric_cut_in';
export function movementDelta(kind: MovementKind, quantity: string): string {
  if (['opening', 'receipt', 'transfer_in', 'transit_in', 'fabric_cut_in'].includes(kind)) return quantity;
  return `-${quantity}`;
}

export function cutRoll(remaining: string, requested: string): string {
  assertDecimalPrecision(remaining);assertDecimalPrecision(requested);
  if (compareDecimal(requested, '0') <= 0) throw new Error('Cut length must be greater than zero.');
  if (compareDecimal(requested, remaining) > 0) throw new Error('Cut length exceeds the remaining roll length.');
  return subtractDecimal(remaining, requested);
}

export function transferDispatchMovements(quantity: string) {
  return [{ location: 'warehouse' as const, kind: 'transfer_out' as const, delta: `-${quantity}` }, { location: 'transit' as const, kind: 'transit_in' as const, delta: quantity }];
}
export function transferReceiptMovements(quantity: string) {
  return [{ location: 'transit' as const, kind: 'transit_out' as const, delta: `-${quantity}` }, { location: 'warehouse' as const, kind: 'transfer_in' as const, delta: quantity }];
}
