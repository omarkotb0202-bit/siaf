import { schema, SCHEMA_VERSION } from './schema';
describe('local schema contract',()=>{
 it('has explicit schema version and durable outbox retry fields',()=>{
  expect(SCHEMA_VERSION).toBeGreaterThan(0);
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS outbox');
  expect(schema).toContain('attempt_count INTEGER NOT NULL DEFAULT 0');
  expect(schema).toContain('server_acknowledged_at TEXT');
  expect(schema).toContain('actor_user_id TEXT');
  expect(schema).toContain('local_sequence INTEGER NOT NULL DEFAULT 0');
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS sync_inbox');
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS sync_cursors');
  expect(schema).toContain("'failed'" );
 });
 it('keeps product and branch records organization scoped',()=>{
  expect(schema).toContain('organization_id TEXT NOT NULL REFERENCES organizations');
  expect(schema).toContain('UNIQUE(organization_id,sku)');
 });
});
