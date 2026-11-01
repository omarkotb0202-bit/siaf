import { getDatabase } from './database';
import type { CatalogContext } from './productRepository';

const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1_000;
const SCHEMA_VERSION = 1;

type OutboxRow = { operation_id:string; organization_id:string; device_id:string; operation_type:string; entity_id:string; schema_version:number; local_sequence:number; payload:string; created_at:string; attempt_count:number };
type Ack = { operationId:string; status:'acknowledged'|'rejected'|'review'; canonicalResult?:unknown; conflict?:unknown; message?:string };

/** Foreground sync. The caller supplies a short-lived bearer token from secure storage. */
export async function synchronize(context:CatalogContext,apiBaseUrl:string,accessToken:string,fetcher:typeof fetch=fetch,now=new Date()) {
  const db=await getDatabase(),timestamp=now.toISOString();
  await db.runAsync('INSERT INTO sync_health(organization_id,device_id,last_attempt_at,last_error) VALUES (?,?,?,NULL) ON CONFLICT(organization_id,device_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_error=NULL',context.organizationId,context.deviceId,timestamp);
  let sent=0,received=0;
  try {
    const rows=await db.getAllAsync<OutboxRow>(`SELECT o.operation_id,o.organization_id,o.device_id,o.operation_type,o.entity_id,o.schema_version,o.local_sequence,o.payload,o.created_at,o.attempt_count FROM outbox o
      WHERE o.organization_id=? AND o.device_id=? AND o.status IN ('pending','retry') AND (o.next_attempt_at IS NULL OR o.next_attempt_at<=?)
      AND NOT EXISTS(SELECT 1 FROM outbox_dependencies d JOIN outbox p ON p.operation_id=d.depends_on_operation_id WHERE d.operation_id=o.operation_id AND p.status<>'acknowledged')
      ORDER BY o.local_sequence LIMIT 100`,context.organizationId,context.deviceId,timestamp);
    for(const row of rows) {
      if(row.schema_version!==SCHEMA_VERSION) { await markReview(db,row.operation_id,'UNSUPPORTED_LOCAL_SCHEMA'); continue; }
      await db.runAsync("UPDATE outbox SET status='syncing' WHERE operation_id=? AND status IN ('pending','retry')",row.operation_id);
      try {
        const response=await fetcher(`${apiBaseUrl.replace(/\/$/,'')}/sync/push`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({operations:[JSON.parse(row.payload)]})});
        if(!response.ok) throw new Error(`HTTP_${response.status}`);
        const body=await response.json() as { acknowledgements?:Ack[] };
        const ack=body.acknowledgements?.find(item=>item.operationId===row.operation_id);
        if(!ack||!['acknowledged','rejected','review'].includes(ack.status)|| (ack.status==='acknowledged'&&!Object.prototype.hasOwnProperty.call(ack,'canonicalResult'))) throw new Error('INVALID_ACKNOWLEDGEMENT');
        await db.withTransactionAsync(async()=>{
          await db.runAsync('UPDATE outbox SET status=?,last_error=?,conflict_details=?,canonical_result=?,server_acknowledged_at=?,next_attempt_at=NULL WHERE operation_id=?',ack.status,ack.message??null,ack.conflict===undefined?null:JSON.stringify(ack.conflict),ack.canonicalResult===undefined?null:JSON.stringify(ack.canonicalResult),timestamp,row.operation_id);
          if(ack.status==='review'||ack.status==='rejected') await db.runAsync('INSERT INTO sync_conflicts(operation_id,conflict_type,details,created_at) VALUES (?,?,?,?)',row.operation_id,ack.status,JSON.stringify(ack.conflict??{message:ack.message??'Server rejected operation'}),timestamp);
        });
        sent++;
      } catch(error) { await scheduleRetry(db,row,error instanceof Error?error.message:'NETWORK_ERROR',timestamp); }
    }
    received=await pullChanges(db,context,apiBaseUrl,accessToken,fetcher,timestamp);
    await db.runAsync('UPDATE sync_health SET last_success_at=?,last_error=NULL WHERE organization_id=? AND device_id=?',timestamp,context.organizationId,context.deviceId);
    return {sent,received};
  } catch(error) {
    await db.runAsync('UPDATE sync_health SET last_error=? WHERE organization_id=? AND device_id=?',error instanceof Error?error.message:'SYNC_ERROR',context.organizationId,context.deviceId);
    throw error;
  }
}

async function pullChanges(db:Awaited<ReturnType<typeof getDatabase>>,context:CatalogContext,base:string,token:string,fetcher:typeof fetch,now:string) {
  const stream='organization',cursor=await db.getFirstAsync<{cursor:string|null}>('SELECT cursor FROM sync_cursors WHERE organization_id=? AND device_id=? AND stream=?',context.organizationId,context.deviceId,stream);
  let next=cursor?.cursor??'',total=0,hasMore=true;
  while(hasMore) {
    const url=new URL(`${base.replace(/\/$/,'')}/sync/pull`);url.searchParams.set('cursor',next);url.searchParams.set('limit','500');
    const response=await fetcher(url.toString(),{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error(`PULL_HTTP_${response.status}`);
    const page=await response.json() as {events?:Array<{eventId:string;cursor:string;schemaVersion:number;payload:unknown}>;nextCursor?:string;hasMore?:boolean};
    if(!Array.isArray(page.events)||typeof page.nextCursor!=='string')throw new Error('INVALID_SYNC_PAGE');
    await db.withTransactionAsync(async()=>{for(const event of page.events!){if(!event.eventId||!event.cursor||event.schemaVersion!==SCHEMA_VERSION)throw new Error('INVALID_SYNC_EVENT');await db.runAsync('INSERT OR IGNORE INTO sync_inbox(server_event_id,organization_id,stream,cursor,schema_version,payload,received_at) VALUES (?,?,?,?,?,?,?)',event.eventId,context.organizationId,stream,event.cursor,event.schemaVersion,JSON.stringify(event.payload),now);}await db.runAsync('INSERT INTO sync_cursors(organization_id,device_id,stream,cursor,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(organization_id,device_id,stream) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at',context.organizationId,context.deviceId,stream,page.nextCursor,now);});
    total+=page.events.length;next=page.nextCursor;hasMore=page.hasMore===true;
  }
  return total;
}

async function scheduleRetry(db:Awaited<ReturnType<typeof getDatabase>>,row:OutboxRow,message:string,now:string){const attempt=row.attempt_count+1;if(attempt>=MAX_ATTEMPTS){await db.runAsync("UPDATE outbox SET status='failed',attempt_count=?,last_error=?,next_attempt_at=NULL WHERE operation_id=?",attempt,message,row.operation_id);return;}const cap=Math.min(MAX_DELAY_MS,BASE_DELAY_MS*2**(attempt-1)),delay=Math.floor(cap*(0.5+Math.random()));await db.runAsync("UPDATE outbox SET status='retry',attempt_count=?,last_error=?,next_attempt_at=? WHERE operation_id=?",attempt,message,new Date(Date.parse(now)+delay).toISOString(),row.operation_id);}
async function markReview(db:Awaited<ReturnType<typeof getDatabase>>,id:string,reason:string){await db.runAsync("UPDATE outbox SET status='review',last_error=? WHERE operation_id=?",reason,id);}

export async function getSyncDiagnostics(context:CatalogContext){const db=await getDatabase();const counts=await db.getFirstAsync<{pending:number;failed:number;conflicted:number}>('SELECT SUM(status IN (\'pending\',\'retry\',\'syncing\')) AS pending,SUM(status=\'failed\') AS failed,SUM(status IN (\'review\',\'rejected\')) AS conflicted FROM outbox WHERE organization_id=? AND device_id=?',context.organizationId,context.deviceId);const health=await db.getFirstAsync<{last_attempt_at:string|null;last_success_at:string|null;last_error:string|null}>('SELECT last_attempt_at,last_success_at,last_error FROM sync_health WHERE organization_id=? AND device_id=?',context.organizationId,context.deviceId);return {pending:counts?.pending??0,failed:counts?.failed??0,conflicted:counts?.conflicted??0,...health};}
