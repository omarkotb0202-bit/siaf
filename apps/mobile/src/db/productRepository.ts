import { getDatabase } from './database';
import * as Crypto from 'expo-crypto';
import type { OfflineCommand } from '@safa/contracts';
import { compareDecimal } from '@safa/contracts';

export interface ProductInput {
  id: string; organizationId: string; categoryId?: string | null; sku: string; name: string;
  description?: string; baseUnitId: string; purchaseUnitId?: string; salesUnitId?: string;
  cost: string; defaultSalesPrice: string; minimumStock: string; inventoryTracked: boolean;
  attributes?: Record<string, unknown>; imageUri?:string; barcode?: string; barcodeType?: 'manufacturer' | 'internal';
}
export interface ProductRow extends Omit<ProductInput,'inventoryTracked'|'attributes'|'barcode'|'barcodeType'> { inventoryTracked:number; active: number; updatedAt: string; attributes:string }
export interface CategoryInput { id:string; organizationId:string; name:string; parentId?:string|null }
export interface CatalogContext { organizationId:string; deviceId:string; warehouseId?:string; userId:string; membershipId:string; permissions:string[]; warehouseIds:string[]; warehousePermissions:Record<string,string[]> }

export async function getLocalCatalogContext():Promise<CatalogContext|null>{
 const db=await getDatabase();const values=await db.getAllAsync<{key:string;value:string}>('SELECT key,value FROM app_settings WHERE key IN (\'active_organization_id\',\'active_user_id\',\'registered_device_id\',\'active_warehouse_id\')');const settings=Object.fromEntries(values.map(row=>[row.key,row.value]));
 if(!settings.active_organization_id||!settings.active_user_id||!settings.registered_device_id)return null;
 const membership=await db.getFirstAsync<{id:string;permissions:string}>(`SELECT m.id,r.permissions FROM memberships m JOIN roles r ON r.organization_id=m.organization_id AND r.id=m.role_id JOIN users u ON u.id=m.user_id AND u.active=1 JOIN registered_devices d ON d.organization_id=m.organization_id AND d.user_id=m.user_id WHERE m.organization_id=? AND m.user_id=? AND m.active=1 AND d.id=? AND d.revoked_at IS NULL`,settings.active_organization_id,settings.active_user_id,settings.registered_device_id);
 if(!membership)return null;
 const warehouseRows=await db.getAllAsync<{warehouse_id:string;permissions:string}>('SELECT warehouse_id,permissions FROM membership_warehouses WHERE organization_id=? AND membership_id=?',settings.active_organization_id,membership.id);
 const warehouseIds=warehouseRows.map(row=>row.warehouse_id);
 const warehousePermissions=Object.fromEntries(warehouseRows.map(row=>[row.warehouse_id,JSON.parse(row.permissions) as string[]]));
 if(settings.active_warehouse_id&&!warehouseIds.includes(settings.active_warehouse_id))delete settings.active_warehouse_id;
 return {organizationId:settings.active_organization_id,deviceId:settings.registered_device_id,userId:settings.active_user_id,membershipId:membership.id,warehouseId:settings.active_warehouse_id,permissions:JSON.parse(membership.permissions) as string[],warehouseIds,warehousePermissions};
}
export function can(context:CatalogContext,permission:string){return context.permissions.includes('*')||context.permissions.includes(permission);}
export function canAtWarehouse(context:CatalogContext,warehouseId:string,permission:string){const allowed=context.warehousePermissions[warehouseId]??[];return context.warehouseIds.includes(warehouseId)&&can(context,permission)&&(allowed.includes('*')||allowed.includes(permission));}
export async function listPermittedWarehouses(context:CatalogContext){if(!context.warehouseIds.length)return [];const db=await getDatabase();return db.getAllAsync<{id:string;name:string;branchName:string}>('SELECT w.id,w.name,b.name AS branchName FROM warehouses w JOIN branches b ON b.organization_id=w.organization_id AND b.id=w.branch_id WHERE w.organization_id=? AND w.id IN ('+context.warehouseIds.map(()=>'?').join(',')+') ORDER BY b.name,w.name',context.organizationId,...context.warehouseIds);}
export async function setActiveWarehouse(context:CatalogContext,warehouseId:string){if(!context.warehouseIds.includes(warehouseId))throw new Error('Warehouse is not authorized for this membership.');const db=await getDatabase();await db.runAsync('INSERT INTO app_settings(key,value) VALUES (\'active_warehouse_id\',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',warehouseId);}

export async function listProducts(context:CatalogContext, query='', limit=40, offset=0, filters:{categoryId?:string;includeArchived?:boolean;archivedOnly?:boolean}={}):Promise<ProductRow[]> {
  if(!can(context,'catalog.read'))return [];
  const db=await getDatabase(); const term=`%${query.trim()}%`;
  return db.getAllAsync<ProductRow>(`SELECT p.id,p.organization_id AS organizationId,p.category_id AS categoryId,p.sku,p.name,p.description,
   p.base_unit_id AS baseUnitId,p.purchase_unit_id AS purchaseUnitId,p.sales_unit_id AS salesUnitId,p.cost,p.default_sales_price AS defaultSalesPrice,p.image_uri AS imageUri,
   p.minimum_stock AS minimumStock,p.inventory_tracked AS inventoryTracked,p.attributes,p.active,p.updated_at AS updatedAt
   FROM products p WHERE p.organization_id=? AND (?=1 OR p.deleted_at IS NULL) AND (?=0 OR p.deleted_at IS NOT NULL) AND (? IS NULL OR p.category_id=?) AND (p.name LIKE ? OR p.sku LIKE ? OR EXISTS(SELECT 1 FROM product_barcodes b LEFT JOIN product_variants v ON v.organization_id=b.organization_id AND v.id=b.variant_id WHERE b.organization_id=p.organization_id AND (b.product_id=p.id OR v.product_id=p.id) AND b.barcode LIKE ?))
   ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?`,context.organizationId,filters.includeArchived?1:0,filters.archivedOnly?1:0,filters.categoryId??null,filters.categoryId??null,term,term,term,limit,offset);
}

export async function findProductByCode(context:CatalogContext, code:string):Promise<ProductRow|null> {
  if(!can(context,'catalog.read'))return null;
  const db=await getDatabase();
  return (await db.getFirstAsync<ProductRow>(`SELECT p.id,p.organization_id AS organizationId,p.category_id AS categoryId,p.sku,p.name,p.description,p.base_unit_id AS baseUnitId,p.purchase_unit_id AS purchaseUnitId,p.sales_unit_id AS salesUnitId,p.cost,p.default_sales_price AS defaultSalesPrice,p.image_uri AS imageUri,p.minimum_stock AS minimumStock,p.inventory_tracked AS inventoryTracked,p.attributes,p.active,p.updated_at AS updatedAt FROM products p WHERE p.organization_id=? AND p.deleted_at IS NULL AND (p.sku=? OR EXISTS(SELECT 1 FROM product_barcodes b LEFT JOIN product_variants v ON v.organization_id=b.organization_id AND v.id=b.variant_id WHERE b.organization_id=p.organization_id AND (b.product_id=p.id OR v.product_id=p.id) AND b.barcode=?)) LIMIT 1`,context.organizationId,code,code))??null;
}

export async function saveProduct(product:ProductInput, context:CatalogContext, now=new Date().toISOString()):Promise<void>{
  if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية تعديل دليل المنتجات.');
  if(product.organizationId!==context.organizationId) throw new Error('The product must belong to the active organization.');
  if(!product.name.trim()||!product.sku.trim()||!product.baseUnitId)throw new Error('Name, SKU and base unit are required.');
  for(const [label,value,precision] of [['cost',product.cost,4],['default sales price',product.defaultSalesPrice,4],['minimum stock',product.minimumStock,6]] as const){if(!new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`).test(value)||compareDecimal(value,'0')<0)throw new Error(`Invalid ${label}.`);}
  const db=await getDatabase();
  await db.withTransactionAsync(async()=>{
    const existing=await db.getFirstAsync<{organization_id:string}>('SELECT organization_id FROM products WHERE id=?',product.id);
    if(existing&&existing.organization_id!==product.organizationId) throw new Error('Product ID is already used by another organization.');
  await db.runAsync(`INSERT INTO products(id,organization_id,category_id,sku,name,description,base_unit_id,purchase_unit_id,sales_unit_id,cost,default_sales_price,image_uri,minimum_stock,inventory_tracked,attributes,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,sku=excluded.sku,name=excluded.name,description=excluded.description,base_unit_id=excluded.base_unit_id,purchase_unit_id=excluded.purchase_unit_id,sales_unit_id=excluded.sales_unit_id,cost=excluded.cost,default_sales_price=excluded.default_sales_price,image_uri=excluded.image_uri,minimum_stock=excluded.minimum_stock,inventory_tracked=excluded.inventory_tracked,attributes=excluded.attributes,updated_at=excluded.updated_at`,
      product.id,product.organizationId,product.categoryId??null,product.sku.trim(),product.name.trim(),product.description?.trim()??null,product.baseUnitId??null,product.purchaseUnitId??null,product.salesUnitId??null,product.cost,product.defaultSalesPrice,product.imageUri?.trim()??null,product.minimumStock,product.inventoryTracked?1:0,JSON.stringify(product.attributes??{}),now);
  if(product.barcode?.trim()) await db.runAsync('INSERT INTO product_barcodes(id,organization_id,product_id,barcode,barcode_type) VALUES (?,?,?,?,?)',Crypto.randomUUID(),product.organizationId,product.id,product.barcode.trim(),product.barcodeType??'manufacturer');
  await enqueue(db,context,{operationType:'catalog.product.upsert',entityId:product.id,payload:product,createdAt:now});
  });
}

export async function archiveProduct(id:string,context:CatalogContext,now=new Date().toISOString()):Promise<void>{
 if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية أرشفة المنتجات.');
 const db=await getDatabase(); await db.withTransactionAsync(async()=>{
   const result=await db.runAsync('UPDATE products SET active=0,deleted_at=?,updated_at=? WHERE id=? AND organization_id=? AND deleted_at IS NULL',now,now,id,context.organizationId);
   if(!result.changes) throw new Error('Product was not found in this organization.');
   await enqueue(db,context,{operationType:'catalog.product.archive',entityId:id,payload:{id},createdAt:now});
 });
}
export async function restoreProduct(id:string,context:CatalogContext,now=new Date().toISOString()){if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية استعادة المنتجات.');const db=await getDatabase();await db.withTransactionAsync(async()=>{const result=await db.runAsync('UPDATE products SET active=1,deleted_at=NULL,updated_at=? WHERE id=? AND organization_id=? AND deleted_at IS NOT NULL',now,id,context.organizationId);if(!result.changes)throw new Error('المنتج ليس مؤرشفاً في المؤسسة الحالية.');await enqueue(db,context,{operationType:'catalog.product.restore',entityId:id,payload:{id},createdAt:now});});}

export async function createCategory(category:CategoryInput,context:CatalogContext,now=new Date().toISOString()):Promise<void>{
 if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية تعديل الفئات.');
 if(category.organizationId!==context.organizationId)throw new Error('Category must belong to the active organization.');
 const db=await getDatabase(); await db.withTransactionAsync(async()=>{
  await db.runAsync('INSERT INTO product_categories(id,organization_id,name,parent_id) VALUES (?,?,?,?)',category.id,category.organizationId,category.name.trim(),category.parentId??null);
  await enqueue(db,context,{operationType:'catalog.category.create',entityId:category.id,payload:category,createdAt:now});
 });
}

export async function listCategories(context:CatalogContext){if(!can(context,'catalog.read'))return [];const db=await getDatabase();return db.getAllAsync<{id:string;name:string;parentId:string|null}>('SELECT id,name,parent_id AS parentId FROM product_categories WHERE organization_id=? AND active=1 ORDER BY name COLLATE NOCASE',context.organizationId);}
export async function getCategory(context:CatalogContext,id:string){if(!can(context,'catalog.read'))return null;const db=await getDatabase();return db.getFirstAsync<{id:string;name:string;parentId:string|null}>('SELECT id,name,parent_id AS parentId FROM product_categories WHERE organization_id=? AND id=? AND active=1',context.organizationId,id);}
export async function updateCategory(input:CategoryInput,context:CatalogContext,now=new Date().toISOString()){if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية تعديل الفئات.');if(input.organizationId!==context.organizationId)throw new Error('Category must belong to the active organization.');const db=await getDatabase();await db.withTransactionAsync(async()=>{const result=await db.runAsync('UPDATE product_categories SET name=?,parent_id=?,updated_at=? WHERE id=? AND organization_id=? AND active=1',input.name.trim(),input.parentId??null,now,input.id,context.organizationId);if(!result.changes)throw new Error('الفئة غير موجودة في المؤسسة الحالية.');await enqueue(db,context,{operationType:'catalog.category.update',entityId:input.id,payload:input,createdAt:now});});}
export async function archiveCategory(id:string,context:CatalogContext,now=new Date().toISOString()){if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية أرشفة الفئات.');const db=await getDatabase();await db.withTransactionAsync(async()=>{const result=await db.runAsync('UPDATE product_categories SET active=0 WHERE id=? AND organization_id=? AND active=1',id,context.organizationId);if(!result.changes)throw new Error('الفئة غير موجودة.');await enqueue(db,context,{operationType:'catalog.category.archive',entityId:id,payload:{id},createdAt:now});});}
export async function getProduct(context:CatalogContext,id:string){if(!can(context,'catalog.read'))return null;const db=await getDatabase();return db.getFirstAsync<ProductRow>('SELECT id,organization_id AS organizationId,category_id AS categoryId,sku,name,description,base_unit_id AS baseUnitId,purchase_unit_id AS purchaseUnitId,sales_unit_id AS salesUnitId,cost,default_sales_price AS defaultSalesPrice,image_uri AS imageUri,minimum_stock AS minimumStock,inventory_tracked AS inventoryTracked,attributes,active,updated_at AS updatedAt FROM products WHERE organization_id=? AND id=?',context.organizationId,id);}
export async function upsertVariant(input:{id:string;productId:string;organizationId:string;sku:string;attributes:Record<string,string>},context:CatalogContext){if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية تعديل المنتجات.');if(input.organizationId!==context.organizationId)throw new Error('Variant must belong to the active organization.');if(!input.sku.trim())throw new Error('Variant SKU is required.');const db=await getDatabase();await db.withTransactionAsync(async()=>{const existing=await db.getFirstAsync<{organization_id:string;product_id:string}>('SELECT organization_id,product_id FROM product_variants WHERE id=?',input.id);if(existing&&existing.organization_id!==input.organizationId)throw new Error('Variant ID is already used by another organization.');if(existing&&existing.product_id!==input.productId)throw new Error('A variant cannot be moved to a different parent product.');const parent=await db.getFirstAsync<{id:string}>('SELECT id FROM products WHERE organization_id=? AND id=? AND deleted_at IS NULL',input.organizationId,input.productId);if(!parent)throw new Error('Parent product is unavailable.');const productSku=await db.getFirstAsync<{id:string}>('SELECT id FROM products WHERE organization_id=? AND sku=? AND id<>?',input.organizationId,input.sku.trim(),input.productId);if(productSku)throw new Error('Variant SKU is already used by a product.');await db.runAsync('INSERT INTO product_variants(id,organization_id,product_id,sku,attributes) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,attributes=excluded.attributes,updated_at=CURRENT_TIMESTAMP',input.id,input.organizationId,input.productId,input.sku.trim(),JSON.stringify(input.attributes));await enqueue(db,context,{operationType:'catalog.variant.upsert',entityId:input.id,payload:input,createdAt:new Date().toISOString()});});}
export async function listVariants(context:CatalogContext,productId:string){if(!can(context,'catalog.read'))return [];const db=await getDatabase();return db.getAllAsync<{id:string;sku:string;attributes:string}>('SELECT id,sku,attributes FROM product_variants WHERE organization_id=? AND product_id=? AND active=1 ORDER BY sku',context.organizationId,productId);}
export async function listProductBarcodes(context:CatalogContext,productId:string){if(!can(context,'catalog.read'))return [];const db=await getDatabase();return db.getAllAsync<{barcode:string;barcodeType:string;variantId:string|null}>('SELECT b.barcode,b.barcode_type AS barcodeType,b.variant_id AS variantId FROM product_barcodes b LEFT JOIN product_variants v ON v.organization_id=b.organization_id AND v.id=b.variant_id WHERE b.organization_id=? AND (b.product_id=? OR v.product_id=?) ORDER BY b.barcode_type,b.barcode',context.organizationId,productId,productId);}

export async function addBarcode(input:{id:string;organizationId:string;productId?:string;variantId?:string;barcode:string;type:'manufacturer'|'internal'},context:CatalogContext):Promise<void>{
 if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية تعديل رموز المنتجات.');
 const db=await getDatabase();await db.withTransactionAsync(async()=>{
  if(input.organizationId!==context.organizationId) throw new Error('Barcode must belong to the active organization.');
  if(!input.productId&&!input.variantId)throw new Error('Barcode must be linked to a product or variant.');
  await db.runAsync('INSERT INTO product_barcodes(id,organization_id,product_id,variant_id,barcode,barcode_type) VALUES (?,?,?,?,?,?)',input.id,input.organizationId,input.productId??null,input.variantId??null,input.barcode.trim(),input.type);
  await enqueue(db,context,{operationType:'catalog.barcode.add',entityId:input.productId??input.variantId!,payload:input,createdAt:new Date().toISOString()});
 });
}

type CommandInput={operationType:string;entityId:string;payload:unknown;createdAt:string};
async function enqueue(db:Awaited<ReturnType<typeof getDatabase>>,context:CatalogContext,operation:CommandInput){
 const localSequence=await nextLocalSequence(db,context);
 const command:OfflineCommand={operationId:Crypto.randomUUID(),deviceId:context.deviceId,organizationId:context.organizationId,actorId:context.userId,operationType:operation.operationType,entityId:operation.entityId,schemaVersion:1,localSequence,payload:operation.payload,dependencies:[],createdAt:operation.createdAt};
 await db.runAsync('INSERT INTO outbox(operation_id,organization_id,device_id,actor_user_id,operation_type,entity_id,schema_version,local_sequence,payload,dependencies,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',command.operationId,command.organizationId,command.deviceId,context.userId,command.operationType,command.entityId,command.schemaVersion,localSequence,JSON.stringify(command),JSON.stringify([]),command.createdAt);
}

export async function nextLocalSequence(db:Awaited<ReturnType<typeof getDatabase>>,context:CatalogContext){const row=await db.getFirstAsync<{next:number}>('SELECT COALESCE(MAX(local_sequence),0)+1 AS next FROM outbox WHERE organization_id=? AND device_id=?',context.organizationId,context.deviceId);return row?.next??1;}
