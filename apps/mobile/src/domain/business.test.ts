import { assertPayment, remainingReturnable, saleTotal } from '../../../../packages/contracts/src/business';

describe('business transaction arithmetic',()=>{
 it('calculates cash and credit totals exactly with discounts and taxes',()=>{
  const totals=saleTotal([{quantity:'2',unitPrice:'10.25',discount:'1.00',tax:'0.50'}],'0.25','0.75');
  expect(totals).toEqual({subtotal:'20.5',discount:'1.25',tax:'1.25',total:'20.5'});
  expect(assertPayment(totals.total,'20.5',false)).toBe('0');
  expect(assertPayment(totals.total,'10',true)).toBe('10.5');
  expect(()=>assertPayment(totals.total,'10',false)).toThrow(/not authorized/);
 });
 it('allows partial returns but rejects quantities above remaining quantity',()=>{
  expect(remainingReturnable('5','2','1.5')).toBe('1.5');
  expect(()=>remainingReturnable('5','4.5','0.6')).toThrow(/exceeds/);
 });
});
