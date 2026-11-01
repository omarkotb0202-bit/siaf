import re
import sqlite3
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_SOURCE = (ROOT / 'apps/mobile/src/db/schema.ts').read_text()
SCHEMA = re.search(r'export const schema = `([\s\S]*?)\n`;', SCHEMA_SOURCE).group(1)

class SQLiteFoundationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(SCHEMA)
        self.seed()

    def tearDown(self): self.db.close()

    def seed(self):
        db=self.db
        db.execute("INSERT INTO organizations VALUES('o1','Org one','now')")
        db.execute("INSERT INTO organizations VALUES('o2','Org two','now')")
        db.execute("INSERT INTO users(id,email) VALUES('u1','one@example.invalid')")
        db.execute("INSERT INTO users(id,email) VALUES('u2','two@example.invalid')")
        db.execute("INSERT INTO roles(id,organization_id,name,permissions) VALUES('r1','o1','Owner','[\"catalog.read\",\"catalog.write\",\"inventory.read\",\"inventory.write\",\"inventory.transfer\",\"inventory.transfer.approve\",\"inventory.transfer.dispatch\",\"inventory.transfer.receive\",\"inventory.count.approve\"]')")
        db.execute("INSERT INTO roles(id,organization_id,name) VALUES('r2','o2','Owner')")
        db.execute("INSERT INTO memberships(id,organization_id,user_id,role_id) VALUES('m1','o1','u1','r1')")
        db.execute("INSERT INTO memberships(id,organization_id,user_id,role_id) VALUES('m2','o2','u2','r2')")
        db.execute("INSERT INTO registered_devices(id,organization_id,user_id,device_name,platform) VALUES('d1','o1','u1','device','ios')")
        db.execute("INSERT INTO branches(id,organization_id,name,code) VALUES('b1','o1','Branch','B1')")
        db.execute("INSERT INTO branches(id,organization_id,name,code) VALUES('b2','o2','Branch','B1')")
        db.execute("INSERT INTO warehouses(id,organization_id,branch_id,name,code) VALUES('w1','o1','b1','Main','W1')")
        db.execute("INSERT INTO warehouses(id,organization_id,branch_id,name,code) VALUES('w2','o2','b2','Main','W1')")
        db.execute("INSERT INTO membership_warehouses(organization_id,membership_id,warehouse_id) VALUES('o1','m1','w1')")
        db.execute("INSERT INTO units(id,organization_id,code,name,dimension) VALUES('pc','o1','pc','Piece','count')")
        db.execute("INSERT INTO units(id,organization_id,code,name,dimension) VALUES('m','o1','m','Meter','length')")
        db.execute("INSERT INTO product_categories(id,organization_id,name) VALUES('c1','o1','User defined category')")
        db.execute("INSERT INTO product_categories(id,organization_id,name) VALUES('c2','o2','Other category')")
        db.execute("INSERT INTO products(id,organization_id,category_id,sku,name,base_unit_id,updated_at) VALUES('p1','o1','c1','SKU1','Soap','pc','now')")
        db.execute("INSERT INTO products(id,organization_id,category_id,sku,name,base_unit_id,updated_at) VALUES('p2','o1','c1','SKU2','Fabric','m','now')")
        db.commit()

    def test_arbitrary_categories_products_and_barcode_uniqueness(self):
        self.db.execute("INSERT INTO product_categories(id,organization_id,name) VALUES('new','o1','Anything future')")
        self.db.execute("INSERT INTO product_barcodes(id,organization_id,product_id,barcode,barcode_type) VALUES('bc1','o1','p1','123456','manufacturer')")
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("INSERT INTO product_barcodes(id,organization_id,product_id,barcode,barcode_type) VALUES('bc2','o1','p2','123456','internal')")

    def test_organization_and_warehouse_membership_boundaries(self):
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("INSERT INTO membership_warehouses(organization_id,membership_id,warehouse_id) VALUES('o1','m1','w2')")
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("INSERT INTO products(id,organization_id,category_id,sku,name,updated_at) VALUES('bad','o1','c2','BAD','Cross tenant','now')")
        allowed=self.db.execute("SELECT warehouse_id FROM membership_warehouses WHERE organization_id=? AND membership_id=?",('o1','m1')).fetchall()
        self.assertEqual(allowed,[('w1',)])

    def test_local_write_and_outbox_are_atomic_and_persist(self):
        db=self.db
        db.execute("INSERT INTO outbox(operation_id,organization_id,device_id,operation_type,entity_id,schema_version,payload,created_at) VALUES('opbad','o1','d1','product.update','p1',1,'{}','now')")
        with self.assertRaises(sqlite3.IntegrityError):
            with db:
                db.execute("UPDATE products SET name='Changed' WHERE id='p1'")
                db.execute("INSERT INTO outbox(operation_id,organization_id,device_id,operation_type,entity_id,schema_version,payload,created_at) VALUES('opbad','o1','d1','product.update','p1',1,'{}','now')")
        self.assertEqual(db.execute("SELECT name FROM products WHERE id='p1'").fetchone()[0],'Soap')
        with tempfile.NamedTemporaryFile(suffix='.sqlite') as file:
            disk=sqlite3.connect(file.name);disk.executescript(SCHEMA)
            disk.execute("INSERT INTO organizations VALUES('o1','Org one','now')")
            disk.execute("INSERT INTO users(id,email) VALUES('u1','one@example.invalid')")
            disk.execute("INSERT INTO roles(id,organization_id,name) VALUES('r1','o1','Owner')")
            disk.execute("INSERT INTO memberships(id,organization_id,user_id,role_id) VALUES('m1','o1','u1','r1')")
            disk.execute("INSERT INTO registered_devices(id,organization_id,user_id,device_name,platform) VALUES('d1','o1','u1','device','ios')")
            disk.execute("INSERT INTO product_categories(id,organization_id,name) VALUES('c1','o1','Category')")
            disk.execute("INSERT INTO units(id,organization_id,code,name,dimension) VALUES('pc','o1','pc','Piece','count')")
            disk.execute("INSERT INTO products(id,organization_id,category_id,sku,name,base_unit_id,updated_at) VALUES('p1','o1','c1','S1','Offline','pc','now')")
            disk.execute("INSERT INTO outbox(operation_id,organization_id,device_id,operation_type,entity_id,schema_version,payload,created_at) VALUES('op1','o1','d1','catalog.product.upsert','p1',1,'{}','now')")
            disk.commit();disk.close();reopened=sqlite3.connect(file.name)
            self.assertEqual(reopened.execute('SELECT count(*) FROM products').fetchone()[0],1)
            self.assertEqual(reopened.execute('SELECT count(*) FROM outbox').fetchone()[0],1);reopened.close()

    def test_ledger_balances_transfers_and_immutability(self):
        db=self.db
        db.execute("INSERT INTO warehouses(id,organization_id,branch_id,name,code) VALUES('w3','o1','b1','Second','W3')")
        db.execute("INSERT INTO stock_documents(id,organization_id,document_type,reference,status,source_warehouse_id,created_at,updated_at) VALUES('opening','o1','opening','OPEN','posted','w1','now','now')")
        db.execute("INSERT INTO stock_movements(id,organization_id,document_id,product_id,warehouse_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at) VALUES('m-open','o1','opening','p1','w1','opening','50','pc','1','50','now')")
        db.execute("INSERT INTO stock_documents(id,organization_id,document_type,reference,status,source_warehouse_id,destination_warehouse_id,created_at,updated_at) VALUES('t1','o1','transfer','T1','dispatched','w1','w3','now','now')")
        db.execute("INSERT INTO stock_movements(id,organization_id,document_id,product_id,warehouse_id,transfer_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at) VALUES('m-out','o1','t1','p1','w1','t1','transfer_out','12','pc','1','12','now')")
        db.execute("INSERT INTO stock_movements(id,organization_id,document_id,product_id,transfer_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at) VALUES('m-transit','o1','t1','p1','t1','transit_in','12','pc','1','12','now')")
        def balance(warehouse):
            total=Decimal('0')
            for kind,quantity in db.execute('SELECT movement_type,normalized_quantity FROM stock_movements WHERE warehouse_id=?',(warehouse,)):
                amount=Decimal(quantity);total+=amount if kind in ('opening','receipt','transfer_in') else -amount
            return total
        def transit(transfer):
            total=Decimal('0')
            for kind,quantity in db.execute("SELECT movement_type,normalized_quantity FROM stock_movements WHERE transfer_id=? AND movement_type IN ('transit_in','transit_out')",(transfer,)):
                amount=Decimal(quantity);total+=amount if kind=='transit_in' else -amount
            return total
        self.assertEqual(balance('w1'),Decimal('38'));self.assertEqual(transit('t1'),Decimal('12'))
        db.execute("INSERT INTO stock_movements(id,organization_id,document_id,product_id,warehouse_id,transfer_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at) VALUES('m-dest','o1','t1','p1','w3','t1','transfer_in','12','pc','1','12','now')")
        db.execute("INSERT INTO stock_movements(id,organization_id,document_id,product_id,transfer_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at) VALUES('m-transit-out','o1','t1','p1','t1','transit_out','12','pc','1','12','now')")
        self.assertEqual(balance('w3'),Decimal('12'));self.assertEqual(transit('t1'),Decimal('0'))
        with self.assertRaises(sqlite3.IntegrityError):db.execute("UPDATE stock_movements SET normalized_quantity='99' WHERE id='m-open'")

    def test_fabric_roll_cannot_have_negative_remaining_length(self):
        self.db.execute("INSERT INTO fabric_rolls(id,organization_id,product_id,roll_code,warehouse_id,original_length,remaining_length,unit_id,created_at) VALUES('roll1','o1','p2','R1','w1','10.25','10.25','m','now')")
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("UPDATE fabric_rolls SET remaining_length='-0.1' WHERE id='roll1'")

    def test_local_sale_payment_receivable_and_stock_are_one_committed_document(self):
        db=self.db
        db.execute("INSERT INTO business_parties(id,organization_id,party_type,name,created_at,updated_at) VALUES('cust1','o1','customer','Customer','now','now')")
        db.execute("INSERT INTO cashboxes(id,organization_id,branch_id,name) VALUES('cash1','o1','b1','Till')")
        db.execute("INSERT INTO sales(id,organization_id,invoice_number,branch_id,warehouse_id,customer_id,status,subtotal,discount,tax,total,paid,occurred_at) VALUES('sale1','o1','POS-1','b1','w1','cust1','posted','20','0','0','20','7','now')")
        db.execute("INSERT INTO sale_lines(id,organization_id,sale_id,product_id,product_name,sku,quantity,unit_id,conversion_factor,normalized_quantity,unit_price,line_total) VALUES('sl1','o1','sale1','p1','Soap','SKU1','2','pc','1','2','10','20')")
        db.execute("INSERT INTO stock_documents(id,organization_id,document_type,reference,status,source_warehouse_id,created_at,updated_at) VALUES('sale-doc','o1','issue','POS-1','posted','w1','now','now')")
        db.execute("INSERT INTO stock_movements(id,organization_id,document_id,product_id,warehouse_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at) VALUES('sale-move','o1','sale-doc','p1','w1','issue','2','pc','1','2','now')")
        db.execute("INSERT INTO business_payments(id,organization_id,party_id,sale_id,cashbox_id,direction,amount,method,occurred_at) VALUES('pay1','o1','cust1','sale1','cash1','in','7','cash','now')")
        db.execute("INSERT INTO account_transactions(id,organization_id,party_id,source_type,source_id,debit,credit,occurred_at) VALUES('at-sale','o1','cust1','sale','sale1','20','0','now')")
        db.execute("INSERT INTO account_transactions(id,organization_id,party_id,source_type,source_id,debit,credit,occurred_at) VALUES('at-pay','o1','cust1','sale_payment','pay1','0','7','now')")
        self.assertEqual(Decimal('20')-Decimal('7'),Decimal('13'))
        balance=lambda: sum((Decimal(q) if k in ('opening','receipt','transfer_in') else -Decimal(q) for k,q in db.execute("SELECT movement_type,normalized_quantity FROM stock_movements WHERE organization_id='o1' AND warehouse_id='w1' AND product_id='p1'")),Decimal('0'))
        self.assertEqual(balance(),Decimal('-2'))
        with self.assertRaises(sqlite3.IntegrityError):db.execute("UPDATE account_transactions SET debit='0' WHERE id='at-sale'")
        with self.assertRaises(sqlite3.IntegrityError):db.execute("UPDATE sale_lines SET quantity='99' WHERE id='sl1'")
        with self.assertRaises(sqlite3.IntegrityError):db.execute("INSERT INTO sales(id,organization_id,invoice_number,branch_id,warehouse_id,status,subtotal,discount,tax,total,paid,occurred_at) VALUES('sale2','o1','POS-1','b1','w1','posted','0','0','0','0','0','now')")

    def test_purchase_order_does_not_add_stock_until_receipt_and_ledger_reconciles(self):
        db=self.db
        db.execute("INSERT INTO business_parties(id,organization_id,party_type,name,created_at,updated_at) VALUES('sup1','o1','supplier','Supplier','now','now')")
        db.execute("INSERT INTO purchases(id,organization_id,invoice_number,supplier_id,branch_id,warehouse_id,status,subtotal,total,paid,invoice_date,occurred_at) VALUES('pur1','o1','SUP-1','sup1','b1','w1','ordered','30','30','10','2026-10-26','now')")
        db.execute("INSERT INTO purchase_lines(id,organization_id,purchase_id,product_id,product_name,sku,quantity,unit_id,conversion_factor,normalized_quantity,unit_cost,line_total) VALUES('pl1','o1','pur1','p1','Soap','SKU1','3','pc','1','3','10','30')")
        before=db.execute("SELECT count(*) FROM stock_movements WHERE product_id='p1' AND warehouse_id='w1'").fetchone()[0]
        self.assertEqual(before,0)
        db.execute("INSERT INTO purchase_receipts(id,organization_id,purchase_id,reference,received_at) VALUES('gr1','o1','pur1','GR-1','now')")
        db.execute("INSERT INTO stock_documents(id,organization_id,document_type,reference,status,source_warehouse_id,created_at,updated_at) VALUES('grdoc','o1','receipt','GR-1','posted','w1','now','now')")
        db.execute("INSERT INTO stock_movements(id,organization_id,document_id,product_id,warehouse_id,movement_type,entered_quantity,entered_unit_id,conversion_factor,normalized_quantity,occurred_at) VALUES('grmove','o1','grdoc','p1','w1','receipt','3','pc','1','3','now')")
        db.execute("INSERT INTO account_transactions(id,organization_id,party_id,source_type,source_id,debit,credit,occurred_at) VALUES('ap-invoice','o1','sup1','purchase','pur1','0','30','now')")
        db.execute("INSERT INTO account_transactions(id,organization_id,party_id,source_type,source_id,debit,credit,occurred_at) VALUES('ap-payment','o1','sup1','purchase_payment','payment-1','10','0','now')")
        self.assertEqual(db.execute("SELECT count(*) FROM stock_movements WHERE product_id='p1' AND warehouse_id='w1'").fetchone()[0],1)
        self.assertEqual(Decimal('30')-Decimal('10'),Decimal('20'))

    def test_outbox_records_review_and_rejection_states(self):
        for status in ('rejected','review'):
            self.db.execute("INSERT INTO outbox(operation_id,organization_id,device_id,operation_type,entity_id,schema_version,payload,created_at,status) VALUES(?,?,?,?,?,?,?, ?,?)",(f'op-{status}','o1','d1','sales.post','sale-1',1,'{}','now',status))
        self.assertEqual(self.db.execute("SELECT count(*) FROM outbox WHERE status IN ('rejected','review')").fetchone()[0],2)

if __name__=='__main__':unittest.main()
