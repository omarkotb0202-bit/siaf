import * as Crypto from 'expo-crypto';
import { normalizedQuantity, type Unit, type UnitConversion } from '@safa/contracts';
import { getDatabase } from './database';
import { can, nextLocalSequence, type CatalogContext } from './productRepository';

export const suggestedUnits = [
 {code:'pc',name:'قطعة',dimension:'count'},{code:'pack',name:'عبوة',dimension:'count'},{code:'ctn',name:'كرتونة',dimension:'count'},
 {code:'kg',name:'كيلوجرام',dimension:'mass'},{code:'t',name:'طن',dimension:'mass'},{code:'g',name:'جرام',dimension:'mass'},
 {code:'L',name:'لتر',dimension:'volume'},{code:'mL',name:'مليلتر',dimension:'volume'},{code:'m',name:'متر',dimension:'length'},
 {code:'roll',name:'لفة',dimension:'length'},{code:'bolt',name:'بالة قماش',dimension:'length'},
] as const;

export async function listUnits(context:CatalogContext){const db=await getDatabase();return db.getAllAsync<{id:string;code:string;name:string;dimension:Unit['dimension']}>('SELECT id,code,name,dimension FROM units WHERE organization_id=? ORDER BY name',context.organizationId);}

export async function seedSuggestedUnits(context:CatalogContext){
 if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية إعداد وحدات القياس.');
 const db=await getDatabase();await db.withTransactionAsync(async()=>{
  for(const unit of suggestedUnits){const existing=await db.getFirstAsync<{id:string}>('SELECT id FROM units WHERE organization_id=? AND code=?',context.organizationId,unit.code);if(!existing){const id=Crypto.randomUUID();await db.runAsync('INSERT INTO units(id,organization_id,code,name,dimension) VALUES (?,?,?,?,?)',id,context.organizationId,unit.code,unit.name,unit.dimension);await enqueueUnit(db,context,'catalog.unit.create',id,unit);}}
  const units=await db.getAllAsync<{id:string;code:string}>('SELECT id,code FROM units WHERE organization_id=?',context.organizationId);
  const byCode=new Map(units.map(u=>[u.code,u.id]));
  for(const [from,to,factor] of [['t','kg','1000'],['kg','g','1000'],['L','mL','1000']]){
   const a=byCode.get(from),b=byCode.get(to); if(a&&b){const existing=await db.getFirstAsync<{id:string}>('SELECT id FROM unit_conversions WHERE organization_id=? AND from_unit_id=? AND to_unit_id=? AND product_id IS NULL',context.organizationId,a,b);if(!existing){const id=Crypto.randomUUID();await db.runAsync('INSERT INTO unit_conversions(id,organization_id,from_unit_id,to_unit_id,factor,factor_decimal) VALUES (?,?,?,?,?,?)',id,context.organizationId,a,b,factor,factor);await enqueueUnit(db,context,'catalog.unit_conversion.create',id,{fromUnitId:a,toUnitId:b,factor});}}
  }
 });
}

export async function createUnit(input:{id:string;code:string;name:string;dimension:Unit['dimension']},context:CatalogContext){
 if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية إنشاء وحدات القياس.');
 const db=await getDatabase();await db.withTransactionAsync(async()=>{await db.runAsync('INSERT INTO units(id,organization_id,code,name,dimension) VALUES (?,?,?,?,?)',input.id,context.organizationId,input.code.trim(),input.name.trim(),input.dimension);await enqueueUnit(db,context,'catalog.unit.create',input.id,input);});
}

export async function saveConversion(input:{id:string;from:Unit;to:Unit;factor:string;productId?:string;justification?:string},context:CatalogContext){
 if(!can(context,'catalog.write'))throw new Error('لا تملك صلاحية إعداد تحويلات القياس.');
 normalizedQuantity({quantity:'1',enteredUnit:input.from,baseUnit:input.to,conversion:{fromUnitId:input.from.id,toUnitId:input.to.id,factor:input.factor,productId:input.productId,justification:input.justification},productId:input.productId??''});
 const db=await getDatabase();await db.withTransactionAsync(async()=>{await db.runAsync('INSERT INTO unit_conversions(id,organization_id,from_unit_id,to_unit_id,factor,factor_decimal,product_id,justification) VALUES (?,?,?,?,?,?,?,?)',input.id,context.organizationId,input.from.id,input.to.id,input.factor,input.factor,input.productId??null,input.justification?.trim()??null);await enqueueUnit(db,context,'catalog.unit_conversion.create',input.id,input);});
}

export async function conversionFor(context:CatalogContext,from:Unit,to:Unit,productId:string):Promise<UnitConversion|undefined>{
 const db=await getDatabase();
 const row=await db.getFirstAsync<{factor:string;product_id:string|null;justification:string|null}>(`SELECT factor_decimal AS factor,product_id,justification FROM unit_conversions WHERE organization_id=? AND from_unit_id=? AND to_unit_id=? AND (product_id=? OR product_id IS NULL) ORDER BY product_id IS NULL LIMIT 1`,context.organizationId,from.id,to.id,productId);
 return row?{fromUnitId:from.id,toUnitId:to.id,factor:row.factor,productId:row.product_id??undefined,justification:row.justification??undefined}:undefined;
}

async function enqueueUnit(db:Awaited<ReturnType<typeof getDatabase>>,context:CatalogContext,operationType:string,entityId:string,payload:unknown){const createdAt=new Date().toISOString(),localSequence=await nextLocalSequence(db,context),operationId=Crypto.randomUUID(),command={operationId,organizationId:context.organizationId,deviceId:context.deviceId,actorId:context.userId,operationType,entityId,schemaVersion:1,localSequence,payload,dependencies:[],createdAt};await db.runAsync('INSERT INTO outbox(operation_id,organization_id,device_id,actor_user_id,operation_type,entity_id,schema_version,local_sequence,payload,dependencies,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',operationId,context.organizationId,context.deviceId,context.userId,operationType,entityId,1,localSequence,JSON.stringify(command),'[]',createdAt);}

