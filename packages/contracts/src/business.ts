import { addDecimal, compareDecimal, multiplyDecimal, subtractDecimal } from './decimal';

export interface PricedLine { quantity:string; unitPrice:string; discount?:string; tax?:string }
export function totalLine(line:PricedLine):{gross:string;discount:string;tax:string;total:string} {
  const gross=multiplyDecimal(line.quantity,line.unitPrice,4);const discount=line.discount??'0';const tax=line.tax??'0';
  if(compareDecimal(gross,'0')<0||compareDecimal(discount,'0')<0||compareDecimal(tax,'0')<0||compareDecimal(discount,gross)>0)throw new Error('Invalid sale line amount.');
  return {gross,discount,tax,total:addDecimal(subtractDecimal(gross,discount),tax,4)};
}
export function saleTotal(lines:PricedLine[],invoiceDiscount='0',invoiceTax='0') {
  let subtotal='0',lineDiscount='0',lineTax='0';for(const line of lines){const totals=totalLine(line);subtotal=addDecimal(subtotal,totals.gross,4);lineDiscount=addDecimal(lineDiscount,totals.discount,4);lineTax=addDecimal(lineTax,totals.tax,4);}
  if(compareDecimal(invoiceDiscount,'0')<0||compareDecimal(invoiceDiscount,subtractDecimal(subtotal,lineDiscount))>0||compareDecimal(invoiceTax,'0')<0)throw new Error('Invalid invoice discount or tax.');
  return {subtotal,discount:addDecimal(invoiceDiscount,lineDiscount,4),tax:addDecimal(invoiceTax,lineTax,4),total:addDecimal(subtractDecimal(subtractDecimal(subtotal,lineDiscount),invoiceDiscount),addDecimal(invoiceTax,lineTax,4),4)};
}
export function remainingReturnable(original:string,returned:string,requested:string):string {
  const remaining=subtractDecimal(original,returned);if(compareDecimal(requested,'0')<=0||compareDecimal(requested,remaining)>0)throw new Error('Return quantity exceeds the remaining returnable quantity.');return subtractDecimal(remaining,requested);
}
export function assertPayment(total:string,paid:string,creditAuthorized:boolean) {
  if(compareDecimal(paid,'0')<0||compareDecimal(paid,total)>0)throw new Error('Payment is outside the invoice total.');const due=subtractDecimal(total,paid);if(compareDecimal(due,'0')>0&&!creditAuthorized)throw new Error('Credit sale is not authorized.');return due;
}
