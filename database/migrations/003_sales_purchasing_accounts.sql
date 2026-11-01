CREATE TABLE business_parties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 party_type text NOT NULL CHECK(party_type IN ('customer','supplier')), name text NOT NULL, phone text, email text, address text, notes text,
 credit_limit numeric(18,4) CHECK(credit_limit IS NULL OR credit_limit>=0), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,party_type,name)
);
CREATE INDEX business_parties_search_idx ON business_parties(organization_id,party_type,name);
CREATE TABLE sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 operation_id uuid NOT NULL, invoice_number text NOT NULL, branch_id uuid NOT NULL, warehouse_id uuid NOT NULL, customer_id uuid,
 created_by uuid REFERENCES users ON DELETE SET NULL, status text NOT NULL CHECK(status IN ('posted','returned','cancelled')),
 subtotal numeric(18,4) NOT NULL CHECK(subtotal>=0), discount numeric(18,4) NOT NULL CHECK(discount>=0), tax numeric(18,4) NOT NULL CHECK(tax>=0), total numeric(18,4) NOT NULL CHECK(total>=0), paid numeric(18,4) NOT NULL CHECK(paid>=0 AND paid<=total), currency text NOT NULL DEFAULT 'EGP',
 occurred_at timestamptz NOT NULL DEFAULT now(), note text,
 FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,warehouse_id) REFERENCES warehouses(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,customer_id) REFERENCES business_parties(organization_id,id) ON DELETE RESTRICT,
 UNIQUE(organization_id,id), UNIQUE(organization_id,operation_id), UNIQUE(organization_id,invoice_number)
);
CREATE TABLE sale_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, sale_id uuid NOT NULL, product_id uuid NOT NULL, variant_id uuid,
 product_name text NOT NULL, sku text NOT NULL, quantity numeric(24,10) NOT NULL CHECK(quantity>0), unit_id uuid NOT NULL,
 conversion_factor numeric(24,10) NOT NULL CHECK(conversion_factor>0), normalized_quantity numeric(24,10) NOT NULL CHECK(normalized_quantity>0),
 unit_price numeric(18,4) NOT NULL CHECK(unit_price>=0), discount numeric(18,4) NOT NULL DEFAULT 0 CHECK(discount>=0), tax numeric(18,4) NOT NULL DEFAULT 0 CHECK(tax>=0), line_total numeric(18,4) NOT NULL CHECK(line_total>=0),
 FOREIGN KEY(organization_id,sale_id) REFERENCES sales(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,product_id) REFERENCES products(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,variant_id) REFERENCES product_variants(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT, UNIQUE(organization_id,id)
);
CREATE TABLE cashboxes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE, branch_id uuid NOT NULL, device_id uuid,
 name text NOT NULL, currency text NOT NULL DEFAULT 'EGP', active boolean NOT NULL DEFAULT true,
 FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,device_id) REFERENCES registered_devices(organization_id,id) ON DELETE RESTRICT, UNIQUE(organization_id,id)
);
CREATE TABLE business_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE, operation_id uuid NOT NULL,
 party_id uuid, sale_id uuid, purchase_id uuid, cashbox_id uuid, direction text NOT NULL CHECK(direction IN ('in','out')),
 amount numeric(18,4) NOT NULL CHECK(amount>0), method text NOT NULL CHECK(method IN ('cash','card','transfer','other')), reference text,
 occurred_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users ON DELETE SET NULL,
 FOREIGN KEY(organization_id,party_id) REFERENCES business_parties(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,sale_id) REFERENCES sales(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,cashbox_id) REFERENCES cashboxes(organization_id,id) ON DELETE RESTRICT,
 UNIQUE(organization_id,id), UNIQUE(organization_id,operation_id)
);
CREATE TABLE account_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, party_id uuid NOT NULL,
 source_type text NOT NULL CHECK(source_type IN ('opening','sale','sale_payment','sale_return','purchase','purchase_payment','purchase_return','adjustment')),
 source_id uuid NOT NULL, debit numeric(18,4) NOT NULL DEFAULT 0 CHECK(debit>=0), credit numeric(18,4) NOT NULL DEFAULT 0 CHECK(credit>=0),
 occurred_at timestamptz NOT NULL DEFAULT now(), notes text,
 FOREIGN KEY(organization_id,party_id) REFERENCES business_parties(organization_id,id) ON DELETE RESTRICT,
 CHECK((debit=0 AND credit>0) OR (credit=0 AND debit>0)), UNIQUE(organization_id,source_type,source_id)
);
CREATE INDEX account_transactions_history_idx ON account_transactions(organization_id,party_id,occurred_at DESC);
CREATE TABLE purchases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE, operation_id uuid NOT NULL,
 invoice_number text NOT NULL, supplier_id uuid NOT NULL, branch_id uuid NOT NULL, warehouse_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('ordered','partially_received','received','returned','cancelled')),
 subtotal numeric(18,4) NOT NULL CHECK(subtotal>=0), landed_cost numeric(18,4) NOT NULL DEFAULT 0 CHECK(landed_cost>=0), total numeric(18,4) NOT NULL CHECK(total>=0), paid numeric(18,4) NOT NULL DEFAULT 0 CHECK(paid>=0 AND paid<=total),
 invoice_date date NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), note text,
 FOREIGN KEY(organization_id,supplier_id) REFERENCES business_parties(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,branch_id) REFERENCES branches(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,warehouse_id) REFERENCES warehouses(organization_id,id) ON DELETE RESTRICT,
 UNIQUE(organization_id,id), UNIQUE(organization_id,operation_id), UNIQUE(organization_id,invoice_number)
);
ALTER TABLE business_payments ADD CONSTRAINT business_payments_purchase_fk FOREIGN KEY(organization_id,purchase_id) REFERENCES purchases(organization_id,id) ON DELETE RESTRICT;
CREATE TABLE purchase_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, purchase_id uuid NOT NULL, product_id uuid NOT NULL,
 product_name text NOT NULL, sku text NOT NULL, quantity numeric(24,10) NOT NULL CHECK(quantity>0), received_quantity numeric(24,10) NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=quantity),
 unit_id uuid NOT NULL, conversion_factor numeric(24,10) NOT NULL CHECK(conversion_factor>0), normalized_quantity numeric(24,10) NOT NULL CHECK(normalized_quantity>0), unit_cost numeric(18,4) NOT NULL CHECK(unit_cost>=0), line_total numeric(18,4) NOT NULL CHECK(line_total>=0),
 FOREIGN KEY(organization_id,purchase_id) REFERENCES purchases(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,product_id) REFERENCES products(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT, UNIQUE(organization_id,id)
);
CREATE TABLE purchase_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, purchase_id uuid NOT NULL, reference text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users ON DELETE SET NULL,
 FOREIGN KEY(organization_id,purchase_id) REFERENCES purchases(organization_id,id) ON DELETE RESTRICT, UNIQUE(organization_id,id), UNIQUE(organization_id,reference)
);
CREATE TABLE purchase_receipt_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, receipt_id uuid NOT NULL, purchase_line_id uuid NOT NULL,
 quantity numeric(24,10) NOT NULL CHECK(quantity>0), normalized_quantity numeric(24,10) NOT NULL CHECK(normalized_quantity>0), unit_id uuid NOT NULL,
 FOREIGN KEY(organization_id,receipt_id) REFERENCES purchase_receipts(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,purchase_line_id) REFERENCES purchase_lines(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT, UNIQUE(organization_id,id)
);
CREATE TABLE business_returns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE, operation_id uuid NOT NULL,
 return_number text NOT NULL, source_type text NOT NULL CHECK(source_type IN ('sale','purchase')), source_id uuid NOT NULL, party_id uuid,
 warehouse_id uuid NOT NULL, reason text NOT NULL, amount numeric(18,4) NOT NULL CHECK(amount>=0), status text NOT NULL CHECK(status IN ('posted','review')), occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,party_id) REFERENCES business_parties(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,warehouse_id) REFERENCES warehouses(organization_id,id) ON DELETE RESTRICT,
 UNIQUE(organization_id,id), UNIQUE(organization_id,operation_id), UNIQUE(organization_id,return_number)
);
CREATE TABLE business_return_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, return_id uuid NOT NULL, source_line_id uuid NOT NULL, product_id uuid NOT NULL, variant_id uuid,
 quantity numeric(24,10) NOT NULL CHECK(quantity>0), normalized_quantity numeric(24,10) NOT NULL CHECK(normalized_quantity>0), unit_id uuid NOT NULL,
 amount numeric(18,4) NOT NULL CHECK(amount>=0), condition text NOT NULL,
 FOREIGN KEY(organization_id,return_id) REFERENCES business_returns(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,product_id) REFERENCES products(organization_id,id) ON DELETE RESTRICT, FOREIGN KEY(organization_id,variant_id) REFERENCES product_variants(organization_id,id) ON DELETE RESTRICT, FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE cash_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, cashbox_id uuid NOT NULL, opened_by uuid REFERENCES users ON DELETE SET NULL,
 opening_balance numeric(18,4) NOT NULL CHECK(opening_balance>=0), counted_closing numeric(18,4), expected_closing numeric(18,4), difference numeric(18,4), opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 FOREIGN KEY(organization_id,cashbox_id) REFERENCES cashboxes(organization_id,id) ON DELETE RESTRICT, UNIQUE(organization_id,id)
);
CREATE TABLE cash_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE, operation_id uuid NOT NULL, cashbox_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('in','out')), category text NOT NULL, amount numeric(18,4) NOT NULL CHECK(amount>0), occurred_at timestamptz NOT NULL DEFAULT now(), attachment_uri text, notes text,
 FOREIGN KEY(organization_id,cashbox_id) REFERENCES cashboxes(organization_id,id) ON DELETE RESTRICT, UNIQUE(organization_id,id), UNIQUE(organization_id,operation_id)
);
CREATE TRIGGER account_transactions_immutable BEFORE UPDATE OR DELETE ON account_transactions FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_mutation();
CREATE TRIGGER business_payments_immutable BEFORE UPDATE OR DELETE ON business_payments FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_mutation();
CREATE TRIGGER sale_lines_immutable BEFORE UPDATE OR DELETE ON sale_lines FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_mutation();
CREATE TRIGGER business_return_lines_immutable BEFORE UPDATE OR DELETE ON business_return_lines FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_mutation();
CREATE TRIGGER cash_documents_immutable BEFORE UPDATE OR DELETE ON cash_documents FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_mutation();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['business_parties','sales','sale_lines','cashboxes','business_payments','account_transactions','purchases','purchase_lines','purchase_receipts','purchase_receipt_lines','business_returns','business_return_lines','cash_sessions','cash_documents'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid)',t); END LOOP; END $$;
