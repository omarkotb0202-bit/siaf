import * as Print from 'expo-print';
import { code39Svg } from './code39';
export async function printProductLabel(input:{name:string;sku:string;barcode:string}){
 const svg=code39Svg(input.barcode);
 const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
 return Print.printAsync({html:`<!doctype html><html dir="rtl"><meta charset="utf-8"><style>@page{size:60mm 35mm;margin:2mm}body{font-family:Arial,sans-serif;text-align:center;margin:0}.barcode{width:52mm;height:20mm;margin:1mm auto}p{font-size:10pt;margin:1mm}</style><body><p>${escape(input.name)}</p><div class="barcode">${svg}</div><p>${escape(input.barcode)} · ${escape(input.sku)}</p></body></html>`});
}
