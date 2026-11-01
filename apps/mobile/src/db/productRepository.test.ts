const mockRunAsync=jest.fn(async()=>({changes:1}));
const mockGetFirstAsync=jest.fn(async()=>null);
const mockWithTransactionAsync=jest.fn(async(callback:(db:unknown)=>Promise<void>)=>callback({}));
jest.mock('./database',()=>({getDatabase:async()=>({runAsync:mockRunAsync,getFirstAsync:mockGetFirstAsync,withTransactionAsync:mockWithTransactionAsync})}));
jest.mock('expo-crypto',()=>({randomUUID:()=>`uuid-${Math.random()}`}));

import { createCategory, saveProduct, type CatalogContext } from './productRepository';
const context:CatalogContext={organizationId:'org-1',deviceId:'device-1',userId:'user-1',membershipId:'membership-1',permissions:['catalog.read','catalog.write'],warehouseIds:[],warehousePermissions:{}};

describe('offline catalog writes',()=>{
 beforeEach(()=>{mockRunAsync.mockClear();mockGetFirstAsync.mockClear();mockWithTransactionAsync.mockClear();});
 it('creates arbitrary category names without schema-specific code',async()=>{
  await createCategory({id:'category-1',organizationId:'org-1',name:'Future materials'},context,'2026-01-01T00:00:00.000Z');
  expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
  expect(mockRunAsync.mock.calls.map(call=>call[0])).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO product_categories'),expect.stringContaining('INSERT INTO outbox')]));
 });
 it('commits a product write and its outbox operation inside one local transaction',async()=>{
  await saveProduct({id:'product-1',organizationId:'org-1',sku:'SKU-1',name:'Future category item',baseUnitId:'unit-1',cost:'1.2500',defaultSalesPrice:'2.5000',minimumStock:'0',inventoryTracked:true},context,'2026-01-01T00:00:00.000Z');
  expect(mockWithTransactionAsync).toHaveBeenCalledTimes(1);
  expect(mockRunAsync.mock.calls.map(call=>call[0])).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO products'),expect.stringContaining('INSERT INTO outbox')]));
 });
});
