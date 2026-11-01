import * as Crypto from 'expo-crypto';
import { absoluteDecimal, addDecimal, assertDecimalPrecision, compareDecimal, cutRoll, movementDelta, multiplyDecimal, normalizedQuantity, subtractDecimal, type Unit } from '@safa/contracts';
import { getDatabase } from './database';
import { conversionFor } from './unitRepository';
import { can, canAtWarehouse, nextLocalSequence, type CatalogContext } from './productRepository';

export interface StockBalance { productId:string; warehouseId:string; quantity:string; lastMovementAt:string|null }
export interface MovementInput { productId:string; warehouseId:string; quantity:string; unitId:string; kind:'opening'|'receipt'|'issue'; reference:string }

export async function getStockBalance(context:CatalogContext,productId:string,warehouseId:string):Promise<StockBalance>{
 if(!canAtWarehouse(context,warehouseId,'inventory.read'))throw new Error('المخزن غير متاح لهذه العضوية.');
 const db=await getDatabase();const rows=await db.getAllAsync<{movement_type:string;normalized_quantity:string;occurred_at:string}>(`SELECT movement_type,normalized_quantity,occurred_at FROM stock_movements WHERE organization_id=? AND product_id=? AND warehouse_id=? ORDER BY occurred_at`,context.organizationId,productId,warehouseId);
 let quantity='0';for(const row of rows)quantity=addDecimal(quantity,movementDelta(row.movement_type as Parameters<typeof movementDelta>[0],row.normalized_quantity));
 return {productId,warehouseId,quantity,lastMovementAt:rows.length?rows[rows.length-1]!.occurred_at:null};
}

export async function listLowStock(context:CatalogContext,warehouseId:string){
 if(!canAtWarehouse(context,warehouseId,'inventory.read'))throw new Error('المخزن غير متاح لهذه العضوية.');
 const db=await getDatabase();const products=await db.getAllAsync<{id:string;sku:string;name:string;minimumStock:string;baseUnitId:string|null}>(`SELECT id,sku,name,minimum_stock AS minimumStock,base_unit_id AS baseUnitId FROM products WHERE organization_id=? AND deleted_at IS NULL AND active=1 AND inventory_tracked=1`,context.organizationId);
 const rows=[];for(const product of products){if(compareDecimal(product.minimumStock,'0')<=0)continue;const balance=await getStockBalance(context,product.id,warehouseId);if(compareDecimal(balance.quantity,product.minimumStock)<=0)rows.push({...product,quantity:balance.quantity,lastMovementAt:balance.lastMovementAt});}
 return rows;
}
export async function listMovementHistory(context:CatalogContext,warehouseId:string,limit=50){if(!canAtWarehouse(context,warehouseId,'inventory.read'))throw new Error('المخزن غير متاح لهذه العضوية.');const db=await getDatabase();return db.getAllAsync<{id:string;productName:string;kind:string;quantity:string;unitName:string;occurredAt:string;reference:string}>('SELECT m.id,p.name AS productName,m.movement_type AS kind,m.entered_quantity AS quantity,u.name AS unitName,m.occurred_at AS occurredAt,d.reference FROM stock_movements m JOIN products p ON p.organization_id=m.organization_id AND p.id=m.product_id JOIN units u ON u.organization_id=m.organization_id AND u.id=m.entered_unit_id JOIN stock_documents d ON d.organization_id=m.organization_id AND d.id=m.document_id WHERE m.organization_id=? AND m.warehouse_id=? ORDER BY m.occurred_at DESC LIMIT ?',context.organizationId,warehouseId,limit);}

export async function listWarehouseInventory(context:CatalogContext,warehouseId:string){
 if(!canAtWarehouse(context,warehouseId,'inventory.read'))throw new Error('المخزن غير متاح لهذه العضوية.');
 const db=await getDatabase();const products=await db.getAllAsync<{id:string;sku:string;name:string;minimumStock:string;baseUnitId:string|null}>('SELECT id,sku,name,minimum_stock AS minimumStock,base_unit_id AS baseUnitId FROM products WHERE organization_id=? AND deleted_at IS NULL AND active=1 AND inventory_tracked=1 ORDER BY name COLLATE NOCASE',context.organizationId);
 const results=[];for(const product of products){const balance=await getStockBalance(context,product.id,warehouseId);results.push({...product,...balance});}return results;
}

export async function listTransfers(context:CatalogContext){const allowed=context.warehouseIds.filter(id=>canAtWarehouse(context,id,'inventory.transfer'));if(!allowed.length)return [];const db=await getDatabase();return db.getAllAsync<{id:string;reference:string;status:string;source_warehouse_id:string;destination_warehouse_id:string;created_at:string}>(`SELECT id,reference,status,source_warehouse_id,destination_warehouse_id,created_at FROM stock_documents WHERE organization_id=? AND document_type='transfer' AND (source_warehouse_id IN (${allowed.map(()=>'?').join(',')}) OR destination_warehouse_id IN (${allowed.map(()=>'?').join(',')})) ORDER BY created_at DESC LIMIT 100`,context.organizationId,...allowed,...allowed);}
export async function getTransferLines(context:CatalogContext,transferId:string){const db=await getDatabase();return db.getAllAsync<{id:string;product_id:string;normalized_quantity:string;received_quantity:string}>('SELECT id,product_id,normalized_quantity,received_quantity FROM stock_document_lines WHERE organization_id=? AND document_id=?',context.organizationId,transferId);}
export async function listFabricRolls(context:CatalogContext,warehouseId:string){if(!canAtWarehouse(context,warehouseId,'inventory.read'))throw new Error('المخزن غير متاح لهذه العضوية.');const db=await getDatabase();return db.getAllAsync<{id:string;product_id:string;roll_code:string;remaining_length:string;original_length:string;unit_id:string;status:string;lot_code:string|null}>('SELECT id,product_id,roll_code,remaining_length,original_length,unit_id,status,lot_code FROM fabric_rolls WHERE organization_id=? AND warehouse_id=? AND status IN (\'available\',\'depleted\') ORDER BY created_at DESC',context.organizationId,warehouseId);}

export async function postMovement(input:MovementInput,context:CatalogContext,now=new Date().toISOString()){
 assertContext(context);if(!canAtWarehouse(context,input.warehouseId,'inventory.write'))throw new Error('لا تملك صلاحية الحركة في هذا المخزن.');const db=await getDatabase();
 const product=await db.getFirstAsync<{base_unit_id:string|null;inventory_tracked:number}>('SELECT base_unit_id,inventory_tracked FROM products WHERE id=? AND organization_id=? AND deleted_at IS NULL',input.productId,context.organizationId);
 if(!product)throw new Error('Product is unavailable in this organization.');if(!product.inventory_tracked)throw new Error('Inventory tracking is disabled for this product.');if(!product.base_unit_id)throw new Error('Set the product base unit first.');
 const units=await db.getAllAsync<{id:string;code:string;dimension:Unit['dimension']}>('SELECT id,code,dimension FROM units WHERE organization_id=? AND id IN (?,?)',context.organizationId,input.unitId,product.base_unit_id);
 const entered=units.find(u=>u.id===input.unitId);const base=units.find(u=>u.id===product.base_unit_id);if(!entered||!base)throw new Error('Unit is unavailable in this organization.');
 const conversion=await conversionFor(context,entered,base,input.productId);const normalized=normalizedQuantity({quantity:input.quantity,enteredUnit:entered,baseUnit:base,conversion,productId:input.productId});
 const documentId=Crypto.randomUUID(),movementId=Crypto.randomUUID();
 await db.withTransactionAsync(async()=>{
  if(input.kind==='issue'){const balance=await getStockBalance(context,input.productId,input.warehouseId);if(compareDecimal(balance.quantity,normalized.quantity)<0)throw new Error('Insufficient available stock.');}
  await db.runAsync('INSERT INTO stock_documents(id,organization_id,document_type,reference,status,source_warehouse_id,created_at,updated_at,metadata) VALUES (?,?,?,?,?,?,?,?,?)',documentId,context.organizationId,input.kind,input.reference||documentId,'posted',input.warehouseId,now,now,'{}');
  await db.runAsync('INSERT INTO stock_movements(id,organization_id,document_id,product_id,warehouse_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',movementId,context.organizationId,documentId,input.productId,input.warehouseId,input.kind,input.quantity,input.unitId,normalized.factor,normalized.quantity,now,'{}');
  await enqueue(db,context,{operationType:`inventory.${input.kind}`,entityId:documentId,payload:{documentId,movementId,...input,...normalized},createdAt:now});
 });
 return {documentId,movementId,normalizedQuantity:normalized.quantity};
}

export interface TransferLineInput { productId:string; quantity:string; unitId:string }
export async function createTransfer(input:{id:string;reference:string;fromWarehouseId:string;toWarehouseId:string;lines:TransferLineInput[]},context:CatalogContext,now=new Date().toISOString()){
 if(!canAtWarehouse(context,input.fromWarehouseId,'inventory.transfer')||!canAtWarehouse(context,input.toWarehouseId,'inventory.transfer'))throw new Error('لا تملك صلاحية النقل بين هذه المخازن.');
 if(input.fromWarehouseId===input.toWarehouseId)throw new Error('Choose two different warehouses.');if(input.lines.length===0)throw new Error('Add at least one transfer line.');
 const db=await getDatabase();await db.withTransactionAsync(async()=>{
  await db.runAsync("INSERT INTO stock_documents(id,organization_id,document_type,reference,status,source_warehouse_id,destination_warehouse_id,created_at,updated_at) VALUES (?,?, 'transfer',?,'draft',?,?,?,?)",input.id,context.organizationId,input.reference,input.fromWarehouseId,input.toWarehouseId,now,now);
  for(const line of input.lines){const conversion=await resolveProductConversion(context,line.productId,line.unitId);const amount=normalizedQuantity({quantity:line.quantity,enteredUnit:conversion.entered,baseUnit:conversion.base,conversion:conversion.rule,productId:line.productId});await db.runAsync('INSERT INTO stock_document_lines(id,organization_id,document_id,product_id,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity) VALUES (?,?,?,?,?,?,?,?)',Crypto.randomUUID(),context.organizationId,input.id,line.productId,line.quantity,line.unitId,amount.factor,amount.quantity);}
  await enqueue(db,context,{operationType:'inventory.transfer.create',entityId:input.id,payload:input,createdAt:now});
 });
}

export async function approveTransfer(id:string,context:CatalogContext,now=new Date().toISOString()){
 if(!can(context,'inventory.transfer.approve'))throw new Error('لا تملك صلاحية اعتماد النقل.');
 const db=await getDatabase();await db.withTransactionAsync(async()=>{
  const doc=await db.getFirstAsync<{status:string;source_warehouse_id:string;destination_warehouse_id:string}>('SELECT status,source_warehouse_id,destination_warehouse_id FROM stock_documents WHERE id=? AND organization_id=? AND document_type=\'transfer\'',id,context.organizationId);if(!doc||doc.status!=='draft')throw new Error('Only draft transfers can be approved.');if(!canAtWarehouse(context,doc.source_warehouse_id,'inventory.transfer.approve')||!canAtWarehouse(context,doc.destination_warehouse_id,'inventory.transfer.approve'))throw new Error('Transfer includes a warehouse outside this membership.');
  const changed=await db.runAsync("UPDATE stock_documents SET status='approved',updated_at=? WHERE id=? AND status='draft'",now,id);if(!changed.changes)throw new Error('Transfer state changed; reload and retry.');
  await enqueue(db,context,{operationType:'inventory.transfer.approve',entityId:id,payload:{id},createdAt:now});
 });
}

export async function dispatchTransfer(id:string,context:CatalogContext,now=new Date().toISOString()){
 if(!can(context,'inventory.transfer.dispatch'))throw new Error('لا تملك صلاحية صرف النقل.');
 const db=await getDatabase();const doc=await db.getFirstAsync<{status:string;source_warehouse_id:string}>('SELECT status,source_warehouse_id FROM stock_documents WHERE id=? AND organization_id=? AND document_type=\'transfer\'',id,context.organizationId);if(!doc||doc.status!=='approved')throw new Error('Transfer must be approved before dispatch.');if(!canAtWarehouse(context,doc.source_warehouse_id,'inventory.transfer.dispatch'))throw new Error('Source warehouse is outside this membership.');
 const lines=await db.getAllAsync<{id:string;product_id:string;entered_quantity:string;entered_unit_id:string;conversion_factor:string;normalized_quantity:string}>('SELECT * FROM stock_document_lines WHERE document_id=? AND organization_id=?',id,context.organizationId);
 await db.withTransactionAsync(async()=>{
  const changed=await db.runAsync("UPDATE stock_documents SET status='dispatched',updated_at=? WHERE id=? AND organization_id=? AND status='approved'",now,id,context.organizationId);if(!changed.changes)throw new Error('Transfer state changed; reload and retry.');
  for(const line of lines){const balance=await getStockBalance(context,line.product_id,doc.source_warehouse_id);if(compareDecimal(balance.quantity,line.normalized_quantity)<0)throw new Error('Insufficient stock to dispatch this transfer.');await insertTransferMovement(db,context,id,line,doc.source_warehouse_id,'transfer_out',now);await insertTransferMovement(db,context,id,line,null,'transit_in',now);}
  await enqueue(db,context,{operationType:'inventory.transfer.dispatch',entityId:id,payload:{id},createdAt:now});
 });
}

export async function receiveTransfer(id:string,receipts:Array<{lineId:string;quantity:string}>,context:CatalogContext,now=new Date().toISOString()){
 if(!can(context,'inventory.transfer.receive'))throw new Error('لا تملك صلاحية استلام النقل.');
 if(!receipts.length)throw new Error('أدخل كمية للاستلام.');
 if(new Set(receipts.map(item=>item.lineId)).size!==receipts.length)throw new Error('استعمل سطراً واحداً لكل صنف في الاستلام.');
 const db=await getDatabase();const doc=await db.getFirstAsync<{status:string;destination_warehouse_id:string}>('SELECT status,destination_warehouse_id FROM stock_documents WHERE id=? AND organization_id=? AND document_type=\'transfer\'',id,context.organizationId);if(!doc||!['dispatched','partially_received'].includes(doc.status))throw new Error('Transfer is not awaiting receipt.');if(!canAtWarehouse(context,doc.destination_warehouse_id,'inventory.transfer.receive'))throw new Error('Destination warehouse is outside this membership.');
 const lines=await db.getAllAsync<{id:string;product_id:string;entered_quantity:string;entered_unit_id:string;conversion_factor:string;normalized_quantity:string;received_quantity:string}>('SELECT * FROM stock_document_lines WHERE document_id=? AND organization_id=?',id,context.organizationId);
 for(const receipt of receipts){assertDecimalPrecision(receipt.quantity);const line=lines.find(row=>row.id===receipt.lineId);if(!line)throw new Error('Transfer line not found.');const unreceived=subtractDecimal(line.normalized_quantity,line.received_quantity);const receivedNormalized=multiplyDecimal(receipt.quantity,line.conversion_factor);if(compareDecimal(receipt.quantity,'0')<=0||compareDecimal(receivedNormalized,unreceived)>0)throw new Error('Receipt exceeds the quantity still in transit.');}
 await db.withTransactionAsync(async()=>{
  for(const receipt of receipts){const line=lines.find(row=>row.id===receipt.lineId)!;const amount=multiplyDecimal(receipt.quantity,line.conversion_factor);const received=addDecimal(line.received_quantity,amount);const changed=await db.runAsync('UPDATE stock_document_lines SET received_quantity=? WHERE id=? AND received_quantity=?',received,line.id,line.received_quantity);if(!changed.changes)throw new Error('Transfer receipt changed concurrently; reload and retry.');const movementLine={...line,entered_quantity:receipt.quantity,normalized_quantity:amount};await insertTransferMovement(db,context,id,movementLine,null,'transit_out',now);await insertTransferMovement(db,context,id,movementLine,doc.destination_warehouse_id,'transfer_in',now);line.received_quantity=received;}
  const currentLines=await db.getAllAsync<{received_quantity:string;normalized_quantity:string}>('SELECT received_quantity,normalized_quantity FROM stock_document_lines WHERE document_id=? AND organization_id=?',id,context.organizationId);
  const complete=currentLines.every(line=>compareDecimal(line.received_quantity,line.normalized_quantity)===0);
  await db.runAsync('UPDATE stock_documents SET status=?,updated_at=? WHERE id=? AND status IN (\'dispatched\',\'partially_received\')',complete?'received':'partially_received',now,id);
  await enqueue(db,context,{operationType:'inventory.transfer.receive',entityId:id,payload:{id,receipts},createdAt:now});
 });
}

export async function cancelTransfer(id:string,context:CatalogContext,now=new Date().toISOString()){
 if(!can(context,'inventory.transfer.cancel'))throw new Error('لا تملك صلاحية إلغاء النقل.');
 const db=await getDatabase();const doc=await db.getFirstAsync<{status:string;source_warehouse_id:string;destination_warehouse_id:string}>('SELECT status,source_warehouse_id,destination_warehouse_id FROM stock_documents WHERE id=? AND organization_id=? AND document_type=\'transfer\'',id,context.organizationId);if(!doc||!['draft','approved'].includes(doc.status))throw new Error('A dispatched transfer cannot be cancelled; record a return movement.');if(!canAtWarehouse(context,doc.source_warehouse_id,'inventory.transfer.cancel')||!canAtWarehouse(context,doc.destination_warehouse_id,'inventory.transfer.cancel'))throw new Error('Transfer includes a warehouse outside this membership.');
 await db.withTransactionAsync(async()=>{const changed=await db.runAsync("UPDATE stock_documents SET status='cancelled',updated_at=? WHERE id=? AND organization_id=? AND status IN ('draft','approved')",now,id,context.organizationId);if(!changed.changes)throw new Error('Transfer state changed; reload and retry.');await enqueue(db,context,{operationType:'inventory.transfer.cancel',entityId:id,payload:{id},createdAt:now});});
}

export async function approveStockCount(input:{id:string;reference:string;productId:string;warehouseId:string;countedQuantity:string},context:CatalogContext,now=new Date().toISOString()){
 if(!canAtWarehouse(context,input.warehouseId,'inventory.count.approve'))throw new Error('لا تملك صلاحية اعتماد الجرد في هذا المخزن.');assertDecimalPrecision(input.countedQuantity);if(compareDecimal(input.countedQuantity,'0')<0)throw new Error('الكمية المعدودة لا يمكن أن تكون سالبة.');
 const product=await (await getDatabase()).getFirstAsync<{base_unit_id:string|null}>('SELECT base_unit_id FROM products WHERE id=? AND organization_id=?',input.productId,context.organizationId);if(!product?.base_unit_id)throw new Error('حدد الوحدة الأساسية للمنتج.');const db=await getDatabase();let systemQuantity='0';let difference='0';const docId=Crypto.randomUUID();
 await db.withTransactionAsync(async()=>{
  const current=await getStockBalance(context,input.productId,input.warehouseId);systemQuantity=current.quantity;difference=subtractDecimal(input.countedQuantity,systemQuantity);
  await db.runAsync("INSERT INTO stock_documents(id,organization_id,document_type,reference,status,source_warehouse_id,created_at,updated_at,metadata) VALUES (?,?, 'count',?,'posted',?,?,?,?)",docId,context.organizationId,input.reference,input.warehouseId,now,now,JSON.stringify({systemQuantity}));
  await db.runAsync('INSERT INTO stock_counts(id,organization_id,document_id,warehouse_id,product_id,counted_quantity,unit_id,approved_by,approved_at) VALUES (?,?,?,?,?,?,?,?,?)',Crypto.randomUUID(),context.organizationId,docId,input.warehouseId,input.productId,input.countedQuantity,product.base_unit_id,context.userId,now);
  if(compareDecimal(difference,'0')!==0){const positive=compareDecimal(difference,'0')>0;const magnitude=absoluteDecimal(difference);await db.runAsync('INSERT INTO stock_movements(id,organization_id,document_id,product_id,warehouse_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at,created_by,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',Crypto.randomUUID(),context.organizationId,docId,input.productId,input.warehouseId,positive?'receipt':'issue',magnitude,product.base_unit_id,'1',magnitude,now,context.userId,JSON.stringify({reason:'approved_stock_count'}));}
  await enqueue(db,context,{operationType:'inventory.stock_count.approve',entityId:docId,payload:{...input,systemQuantity:current.quantity},createdAt:now});
 });return {documentId:docId,systemQuantity,difference};
}

export async function createFabricRoll(input:{id:string;rollCode:string;productId:string;warehouseId:string;length:string;unitId:string;reference:string;lotCode?:string},context:CatalogContext,now=new Date().toISOString()){
 if(!canAtWarehouse(context,input.warehouseId,'inventory.write'))throw new Error('لا تملك صلاحية تسجيل لفة في هذا المخزن.');
 const db=await getDatabase();const conversion=await resolveProductConversion(context,input.productId,input.unitId);if(conversion.entered.dimension!=='length'||conversion.base.dimension!=='length')throw new Error('Fabric roll length must use a length unit.');const amount=normalizedQuantity({quantity:input.length,enteredUnit:conversion.entered,baseUnit:conversion.base,conversion:conversion.rule,productId:input.productId});
 await db.withTransactionAsync(async()=>{
  const docId=Crypto.randomUUID();await db.runAsync("INSERT INTO stock_documents(id,organization_id,document_type,reference,status,source_warehouse_id,created_at,updated_at,metadata) VALUES (?,?, 'opening',?,'posted',?,?,?,?)",docId,context.organizationId,input.reference,input.warehouseId,now,now,'{}');
  await db.runAsync('INSERT INTO fabric_rolls(id,organization_id,product_id,lot_code,roll_code,warehouse_id,original_length,remaining_length,unit_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',input.id,context.organizationId,input.productId,input.lotCode??null,input.rollCode,input.warehouseId,amount.quantity,amount.quantity,conversion.base.id,now);
  await db.runAsync('INSERT INTO stock_movements(id,organization_id,document_id,product_id,warehouse_id,roll_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at) VALUES (?,?,?,?,?,? ,\'opening\',?,?,?,?,?)',Crypto.randomUUID(),context.organizationId,docId,input.productId,input.warehouseId,input.id,input.length,input.unitId,amount.factor,amount.quantity,now);
  await enqueue(db,context,{operationType:'inventory.fabric_roll.create',entityId:input.id,payload:input,createdAt:now});
 });
}

export async function cutFabricRoll(input:{sourceRollId:string;cutId:string;resultRollId:string;resultRollCode:string;length:string;reference:string},context:CatalogContext,now=new Date().toISOString()){
 if(!can(context,'inventory.write'))throw new Error('لا تملك صلاحية قص لفات القماش.');
 const db=await getDatabase();const source=await db.getFirstAsync<{product_id:string;warehouse_id:string;remaining_length:string;unit_id:string;status:string}>('SELECT product_id,warehouse_id,remaining_length,unit_id,status FROM fabric_rolls WHERE id=? AND organization_id=?',input.sourceRollId,context.organizationId);if(!source||source.status!=='available')throw new Error('Source roll is not available.');if(!canAtWarehouse(context,source.warehouse_id,'inventory.write'))throw new Error('Source roll is outside this membership.');
 const remaining=cutRoll(source.remaining_length,input.length);const docId=Crypto.randomUUID();
 await db.withTransactionAsync(async()=>{
  await db.runAsync("INSERT INTO stock_documents(id,organization_id,document_type,reference,status,source_warehouse_id,created_at,updated_at) VALUES (?,?, 'fabric_cut',?,'posted',?,?,?)",docId,context.organizationId,input.reference,source.warehouse_id,now,now);
  const changed=await db.runAsync('UPDATE fabric_rolls SET remaining_length=?,status=? WHERE id=? AND organization_id=? AND remaining_length=? AND status=\'available\'',remaining,compareDecimal(remaining,'0')===0?'depleted':'available',input.sourceRollId,context.organizationId,source.remaining_length);if(!changed.changes)throw new Error('Roll balance changed; reload and retry the cut.');
  await db.runAsync('INSERT INTO fabric_rolls(id,organization_id,product_id,roll_code,parent_roll_id,warehouse_id,original_length,remaining_length,unit_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',input.resultRollId,context.organizationId,source.product_id,input.resultRollCode,input.sourceRollId,source.warehouse_id,input.length,input.length,source.unit_id,now);
  await db.runAsync('INSERT INTO fabric_cuts(id,organization_id,document_id,source_roll_id,result_roll_id,cut_length,unit_id,created_at) VALUES (?,?,?,?,?,?,?,?)',input.cutId,context.organizationId,docId,input.sourceRollId,input.resultRollId,input.length,source.unit_id,now);
  for(const [rollId,kind] of [[input.sourceRollId,'fabric_cut_out'],[input.resultRollId,'fabric_cut_in']] as const)await db.runAsync('INSERT INTO stock_movements(id,organization_id,document_id,product_id,warehouse_id,roll_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at) VALUES (?,?,?,?,?,?,?, ?,?,\'1\',?,?)',Crypto.randomUUID(),context.organizationId,docId,source.product_id,source.warehouse_id,rollId,kind,input.length,source.unit_id,input.length,now);
  await enqueue(db,context,{operationType:'inventory.fabric_roll.cut',entityId:input.sourceRollId,payload:input,createdAt:now});
 });return remaining;
}

async function resolveProductConversion(context:CatalogContext,productId:string,unitId:string){
 const db=await getDatabase();const product=await db.getFirstAsync<{base_unit_id:string|null}>('SELECT base_unit_id FROM products WHERE id=? AND organization_id=?',productId,context.organizationId);if(!product?.base_unit_id)throw new Error('Set the product base unit first.');
 const units=await db.getAllAsync<Unit>('SELECT id,code,dimension FROM units WHERE organization_id=? AND id IN (?,?)',context.organizationId,unitId,product.base_unit_id);const entered=units.find(u=>u.id===unitId),base=units.find(u=>u.id===product.base_unit_id);if(!entered||!base)throw new Error('Unit is unavailable.');
 return {entered,base,rule:await conversionFor(context,entered,base,productId)};
}

async function insertTransferMovement(db:Awaited<ReturnType<typeof getDatabase>>,context:CatalogContext,transferId:string,line:{id:string;product_id:string;entered_quantity:string;entered_unit_id:string;conversion_factor:string;normalized_quantity:string},warehouseId:string|null,kind:string,now:string){
 await db.runAsync('INSERT INTO stock_movements(id,organization_id,document_id,product_id,warehouse_id,transfer_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',Crypto.randomUUID(),context.organizationId,transferId,line.product_id,warehouseId,transferId,kind,line.entered_quantity,line.entered_unit_id,line.conversion_factor,line.normalized_quantity,now);
}
async function enqueue(db:Awaited<ReturnType<typeof getDatabase>>,context:CatalogContext,command:{operationType:string;entityId:string;payload:unknown;createdAt:string}){
 const localSequence=await nextLocalSequence(db,context),operationId=Crypto.randomUUID(),body={operationId,organizationId:context.organizationId,deviceId:context.deviceId,actorId:context.userId,operationType:command.operationType,entityId:command.entityId,schemaVersion:1,localSequence,payload:command.payload,dependencies:[],createdAt:command.createdAt};
 await db.runAsync('INSERT INTO outbox(operation_id,organization_id,device_id,actor_user_id,operation_type,entity_id,schema_version,local_sequence,payload,dependencies,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',operationId,context.organizationId,context.deviceId,context.userId,command.operationType,command.entityId,1,localSequence,JSON.stringify(body),'[]',command.createdAt);
}
function assertContext(context:CatalogContext){if(!context.organizationId||!context.deviceId||!context.userId)throw new Error('An authorized organization, user and registered device are required.');}
