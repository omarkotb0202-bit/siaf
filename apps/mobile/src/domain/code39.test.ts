import { code39Svg } from '../barcodes/code39';
describe('internal Code 39 labels',()=>{
 it('encodes generated internal IDs as SVG bars and keeps their data text',()=>{
  const svg=code39Svg('SAFA-AB12CD34');expect(svg).toContain('<svg');expect(svg).toContain('aria-label="SAFA-AB12CD34"');expect(svg).toContain('<rect');
 });
 it('rejects characters outside the supported barcode alphabet',()=>{
  expect(()=>code39Svg('manufacturer_123')).toThrow(/cannot be encoded/);
 });
});
