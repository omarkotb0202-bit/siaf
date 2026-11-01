import * as SQLite from 'expo-sqlite';
import { schema, SCHEMA_VERSION } from './schema';
let db: SQLite.SQLiteDatabase | undefined;
export async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) db = await SQLite.openDatabaseAsync('safa.db');
  await db.execAsync(schema);
  const current = await db.getFirstAsync<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations');
  if ((current?.version ?? 0) < 2) {
    await db.withTransactionAsync(async()=>{
      await ensureColumn(db!, 'products', 'description', 'TEXT');
      await ensureColumn(db!, 'users', 'active', 'INTEGER NOT NULL DEFAULT 1');
      await ensureColumn(db!, 'products', 'created_at', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db!, 'products', 'base_unit_id', 'TEXT');
      await ensureColumn(db!, 'products', 'purchase_unit_id', 'TEXT');
      await ensureColumn(db!, 'products', 'sales_unit_id', 'TEXT');
      await ensureColumn(db!, 'products', 'cost', "TEXT NOT NULL DEFAULT '0'");
      await ensureColumn(db!, 'products', 'default_sales_price', "TEXT NOT NULL DEFAULT '0'");
      await ensureColumn(db!, 'products', 'image_uri', 'TEXT');
      await ensureColumn(db!, 'products', 'minimum_stock', "TEXT NOT NULL DEFAULT '0'");
      await ensureColumn(db!, 'products', 'inventory_tracked', 'INTEGER NOT NULL DEFAULT 1');
      await ensureColumn(db!, 'products', 'active', 'INTEGER NOT NULL DEFAULT 1');
      await ensureColumn(db!, 'products', 'attributes', "TEXT NOT NULL DEFAULT '{}'");
      await ensureColumn(db!, 'products', 'deleted_at', 'TEXT');
      await ensureColumn(db!, 'product_categories', 'created_at', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db!, 'product_categories', 'updated_at', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db!, 'product_categories', 'active', 'INTEGER NOT NULL DEFAULT 1');
      await ensureColumn(db!, 'units', 'dimension', "TEXT NOT NULL DEFAULT 'custom'");
      await ensureColumn(db!, 'units', 'created_at', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db!, 'units', 'updated_at', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db!, 'unit_conversions', 'product_id', 'TEXT');
      await ensureColumn(db!, 'unit_conversions', 'factor_decimal', "TEXT NOT NULL DEFAULT '1'");
      await ensureColumn(db!, 'unit_conversions', 'justification', 'TEXT');
      await ensureColumn(db!, 'unit_conversions', 'created_at', "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db!, 'unit_conversions', 'updated_at', "TEXT NOT NULL DEFAULT ''");
      await db!.runAsync("UPDATE unit_conversions SET factor_decimal=CAST(factor AS TEXT) WHERE factor_decimal='1' AND CAST(factor AS REAL)<>1");
      await rebuildUnitConversions(db!);
      await ensureColumn(db!, 'product_barcodes', 'barcode_type', "TEXT NOT NULL DEFAULT 'manufacturer'");
      await ensureColumn(db!, 'product_barcodes', 'variant_id', 'TEXT');
      await ensureColumn(db!, 'product_barcodes', 'created_at', "TEXT NOT NULL DEFAULT ''");
      await rebuildProductBarcodes(db!);
      await db!.runAsync('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (?,?)', 2, new Date().toISOString());
    });
  }
  const latest = await db.getFirstAsync<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations');
  if ((latest?.version ?? 0) < 3) {
    await db.withTransactionAsync(async()=>{
      await rebuildOutbox(db!);
      await db!.runAsync('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (?,?)', 3, new Date().toISOString());
    });
  }
  const syncVersion = await db.getFirstAsync<{version:number}>('SELECT MAX(version) AS version FROM schema_migrations');
  if ((syncVersion?.version ?? 0) < 4) {
    await db.withTransactionAsync(async()=>{
      await db!.execAsync(`ALTER TABLE outbox RENAME TO outbox_v3;
        CREATE TABLE outbox(operation_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, device_id TEXT NOT NULL, actor_user_id TEXT, operation_type TEXT NOT NULL, entity_id TEXT NOT NULL, schema_version INTEGER NOT NULL, local_sequence INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, dependencies TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','retry','syncing','acknowledged','rejected','review','failed')), attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error TEXT, canonical_result TEXT, conflict_details TEXT, server_acknowledged_at TEXT, FOREIGN KEY(organization_id,device_id) REFERENCES registered_devices(organization_id,id) ON DELETE RESTRICT);
        INSERT INTO outbox(operation_id,organization_id,device_id,operation_type,entity_id,schema_version,payload,created_at,status,attempt_count,last_error,server_acknowledged_at)
          SELECT operation_id,organization_id,device_id,operation_type,entity_id,schema_version,payload,created_at,status,attempt_count,last_error,server_acknowledged_at FROM outbox_v3;
        DROP TABLE outbox_v3;
        DROP INDEX IF EXISTS outbox_pending_idx;
        CREATE INDEX outbox_pending_idx ON outbox(status,created_at);`);
      await ensureColumn(db!, 'outbox', 'actor_user_id', 'TEXT');
      await ensureColumn(db!, 'outbox', 'local_sequence', 'INTEGER NOT NULL DEFAULT 0');
      await ensureColumn(db!, 'outbox', 'dependencies', "TEXT NOT NULL DEFAULT '[]'");
      await ensureColumn(db!, 'outbox', 'next_attempt_at', 'TEXT');
      await ensureColumn(db!, 'outbox', 'canonical_result', 'TEXT');
      await ensureColumn(db!, 'outbox', 'conflict_details', 'TEXT');
      await db!.execAsync(`UPDATE outbox AS current SET local_sequence=(SELECT COUNT(*) FROM outbox AS prior WHERE prior.organization_id=current.organization_id AND prior.device_id=current.device_id AND (prior.created_at<current.created_at OR (prior.created_at=current.created_at AND prior.operation_id<=current.operation_id))) WHERE local_sequence=0;
        CREATE TABLE IF NOT EXISTS outbox_dependencies(operation_id TEXT NOT NULL REFERENCES outbox(operation_id) ON DELETE CASCADE, depends_on_operation_id TEXT NOT NULL REFERENCES outbox(operation_id) ON DELETE RESTRICT, PRIMARY KEY(operation_id,depends_on_operation_id), CHECK(operation_id<>depends_on_operation_id));
        CREATE TABLE IF NOT EXISTS sync_cursors(organization_id TEXT NOT NULL, device_id TEXT NOT NULL, stream TEXT NOT NULL, cursor TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(organization_id,device_id,stream));
        CREATE TABLE IF NOT EXISTS sync_inbox(server_event_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, stream TEXT NOT NULL, cursor TEXT NOT NULL, schema_version INTEGER NOT NULL, payload TEXT NOT NULL, received_at TEXT NOT NULL, applied_at TEXT);
        CREATE TABLE IF NOT EXISTS sync_health(organization_id TEXT NOT NULL, device_id TEXT NOT NULL, last_attempt_at TEXT, last_success_at TEXT, last_error TEXT, PRIMARY KEY(organization_id,device_id));
        CREATE TABLE IF NOT EXISTS sync_conflicts(id INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL REFERENCES outbox(operation_id), conflict_type TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);
        CREATE INDEX IF NOT EXISTS outbox_sequence_idx ON outbox(organization_id,device_id,local_sequence);
        CREATE INDEX IF NOT EXISTS outbox_retry_idx ON outbox(status,next_attempt_at);`);
      await db!.runAsync('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (?,?)', 4, new Date().toISOString());
    });
  }
  await db.runAsync("UPDATE outbox SET status='retry',last_error=COALESCE(last_error,'Recovered interrupted sync') WHERE status='syncing'");
  return db;
}

async function rebuildOutbox(database: SQLite.SQLiteDatabase) {
  await database.execAsync(`ALTER TABLE outbox RENAME TO outbox_legacy;
    CREATE TABLE outbox(operation_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, device_id TEXT NOT NULL, operation_type TEXT NOT NULL, entity_id TEXT NOT NULL, schema_version INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','retry','acknowledged','rejected','review')), attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, server_acknowledged_at TEXT, FOREIGN KEY(organization_id,device_id) REFERENCES registered_devices(organization_id,id) ON DELETE RESTRICT);
    INSERT INTO outbox(operation_id,organization_id,device_id,operation_type,entity_id,schema_version,payload,created_at,status,attempt_count,last_error,server_acknowledged_at) SELECT operation_id,organization_id,device_id,operation_type,entity_id,schema_version,payload,created_at,status,attempt_count,last_error,server_acknowledged_at FROM outbox_legacy;
    DROP TABLE outbox_legacy;
    CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox(status,created_at);`);
}
export async function getDatabase(){ return db ?? initializeDatabase(); }

async function ensureColumn(database: SQLite.SQLiteDatabase, table: string, name: string, definition: string) {
  const columns = await database.getAllAsync<{name:string}>(`PRAGMA table_info(${table})`);
  if (!columns.some((column) => column.name === name)) await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

async function rebuildUnitConversions(database: SQLite.SQLiteDatabase) {
  await database.execAsync(`DROP INDEX IF EXISTS unit_conversion_scope_unique;
    ALTER TABLE unit_conversions RENAME TO unit_conversions_legacy;
    CREATE TABLE unit_conversions(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, from_unit_id TEXT NOT NULL, to_unit_id TEXT NOT NULL, factor TEXT NOT NULL, factor_decimal TEXT NOT NULL, product_id TEXT, justification TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(organization_id,from_unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT, FOREIGN KEY(organization_id,to_unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT, FOREIGN KEY(organization_id,product_id) REFERENCES products(organization_id,id) ON DELETE CASCADE);
    INSERT INTO unit_conversions(id,organization_id,from_unit_id,to_unit_id,factor,factor_decimal,product_id,justification,created_at,updated_at) SELECT id,organization_id,from_unit_id,to_unit_id,CAST(factor AS TEXT),factor_decimal,product_id,justification,created_at,updated_at FROM unit_conversions_legacy;
    DROP TABLE unit_conversions_legacy;
    CREATE UNIQUE INDEX unit_conversion_scope_unique ON unit_conversions(organization_id,from_unit_id,to_unit_id,COALESCE(product_id,''));`);
}

async function rebuildProductBarcodes(database: SQLite.SQLiteDatabase) {
  await database.execAsync(`ALTER TABLE product_barcodes RENAME TO product_barcodes_legacy;
    CREATE TABLE product_barcodes(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, product_id TEXT, variant_id TEXT, barcode TEXT NOT NULL, barcode_type TEXT NOT NULL DEFAULT 'manufacturer' CHECK(barcode_type IN ('manufacturer','internal')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(organization_id,product_id) REFERENCES products(organization_id,id) ON DELETE CASCADE, FOREIGN KEY(organization_id,variant_id) REFERENCES product_variants(organization_id,id) ON DELETE CASCADE, CHECK(product_id IS NOT NULL OR variant_id IS NOT NULL), UNIQUE(organization_id,barcode));
    INSERT INTO product_barcodes(id,organization_id,product_id,variant_id,barcode,barcode_type,created_at) SELECT id,organization_id,product_id,variant_id,barcode,barcode_type,created_at FROM product_barcodes_legacy;
    DROP TABLE product_barcodes_legacy;`);
}
