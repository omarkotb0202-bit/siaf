import { compareDecimal, multiplyDecimal } from '../../../packages/contracts/src/decimal';
import { cutRoll, movementDelta, normalizedQuantity, transferDispatchMovements, transferReceiptMovements, type Unit } from '../../../packages/contracts/src/inventory';
const unit=(id:string,dimension:Unit['dimension']):Unit=>({id,code:id,dimension});

describe('inventory domain invariants',()=>{
 it('converts metric ton to kilograms exactly',()=>{
  expect(normalizedQuantity({quantity:'1',enteredUnit:unit('t','mass'),baseUnit:unit('kg','mass'),conversion:{fromUnitId:'t',toUnitId:'kg',factor:'1000'},productId:'p'}).quantity).toBe('1000');
 });
 it('converts configured carton quantities',()=>{
  expect(normalizedQuantity({quantity:'2.5',enteredUnit:unit('ctn','count'),baseUnit:unit('pc','count'),conversion:{fromUnitId:'ctn',toUnitId:'pc',factor:'24'},productId:'p'}).quantity).toBe('60');
 });
 it('rejects implicit mass-volume conversion',()=>{
  const data={quantity:'1',enteredUnit:unit('kg','mass'),baseUnit:unit('L','volume'),conversion:{fromUnitId:'kg',toUnitId:'L',factor:'0.8'},productId:'soap'};
  expect(()=>normalizedQuantity(data)).toThrow(/product-specific/);
  expect(()=>normalizedQuantity({...data,conversion:{...data.conversion,productId:'other',justification:'specification'}})).toThrow(/product-specific/);
  expect(normalizedQuantity({...data,conversion:{...data.conversion,productId:'soap',justification:'Product density specification'}}).quantity).toBe('0.8');
 });
 it('rejects an over-cut and keeps exact fractional remainder',()=>{
  expect(cutRoll('18.75','2.5')).toBe('16.25');expect(()=>cutRoll('1.2','1.2001')).toThrow(/exceeds/);
 });
 it('moves transfers through transit without doubling warehouse stock',()=>{
  expect(transferDispatchMovements('12').map(m=>m.delta)).toEqual(['-12','12']);
  expect(transferReceiptMovements('12').map(m=>m.delta)).toEqual(['-12','12']);
  expect(movementDelta('opening','50')).toBe('50');expect(movementDelta('transfer_out','12')).toBe('-12');
  expect(multiplyDecimal('50','1')).toBe('50');expect(compareDecimal('38','38')).toBe(0);
 });
});
