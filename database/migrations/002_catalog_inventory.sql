ALTER TABLE products ADD COLUMN description text;
ALTER TABLE products ADD COLUMN base_unit_id uuid;
ALTER TABLE products ADD COLUMN purchase_unit_id uuid;
ALTER TABLE products ADD COLUMN sales_unit_id uuid;
ALTER TABLE products ADD COLUMN cost numeric(18,4) NOT NULL DEFAULT 0 CHECK (cost >= 0);
ALTER TABLE products ADD COLUMN default_sales_price numeric(18,4) NOT NULL DEFAULT 0 CHECK (default_sales_price >= 0);
ALTER TABLE products ADD COLUMN image_uri text;
ALTER TABLE products ADD COLUMN minimum_stock numeric(18,6) NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0);
ALTER TABLE products ADD COLUMN inventory_tracked boolean NOT NULL DEFAULT true;
ALTER TABLE products ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}';
ALTER TABLE product_categories ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE units ADD COLUMN dimension text NOT NULL DEFAULT 'custom' CHECK (dimension IN ('count','mass','volume','length','custom'));
ALTER TABLE units ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE units ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE unit_conversions ADD COLUMN product_id uuid;
ALTER TABLE unit_conversions ADD COLUMN justification text;
ALTER TABLE unit_conversions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE unit_conversions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE unit_conversions ALTER COLUMN factor TYPE numeric(24,10);
ALTER TABLE unit_conversions ADD CONSTRAINT unit_conversions_product_fk FOREIGN KEY (organization_id, product_id) REFERENCES products (organization_id, id) ON DELETE CASCADE;
ALTER TABLE unit_conversions DROP CONSTRAINT unit_conversions_organization_id_from_unit_id_to_unit_id_key;
CREATE UNIQUE INDEX unit_conversion_scope_unique ON unit_conversions(organization_id, from_unit_id, to_unit_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE products ADD CONSTRAINT products_base_unit_fk FOREIGN KEY (organization_id, base_unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE products ADD CONSTRAINT products_purchase_unit_fk FOREIGN KEY (organization_id, purchase_unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE products ADD CONSTRAINT products_sales_unit_fk FOREIGN KEY (organization_id, sales_unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT;
CREATE TABLE membership_warehouses (
 organization_id uuid NOT NULL, membership_id uuid NOT NULL, warehouse_id uuid NOT NULL,
 permissions jsonb NOT NULL DEFAULT '["inventory.read"]',
 PRIMARY KEY(organization_id,membership_id,warehouse_id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES memberships(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,warehouse_id) REFERENCES warehouses(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE product_variants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 product_id uuid NOT NULL, sku text NOT NULL, attributes jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY (organization_id,product_id) REFERENCES products(organization_id,id) ON DELETE CASCADE,
 UNIQUE(organization_id,id), UNIQUE(organization_id,sku)
);
ALTER TABLE product_barcodes ADD COLUMN barcode_type text NOT NULL DEFAULT 'manufacturer' CHECK (barcode_type IN ('manufacturer','internal'));
ALTER TABLE product_barcodes ADD COLUMN variant_id uuid;
ALTER TABLE product_barcodes ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE product_barcodes ADD CONSTRAINT product_barcodes_variant_fk FOREIGN KEY (organization_id,variant_id) REFERENCES product_variants(organization_id,id) ON DELETE CASCADE;
ALTER TABLE product_barcodes ADD CONSTRAINT barcode_owner_required CHECK (product_id IS NOT NULL OR variant_id IS NOT NULL);
CREATE TABLE stock_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 document_type text NOT NULL CHECK(document_type IN ('opening','receipt','issue','transfer','count','adjustment','fabric_cut')),
 reference text NOT NULL, status text NOT NULL CHECK(status IN ('draft','approved','dispatched','partially_received','received','cancelled','posted')),
 source_warehouse_id uuid, destination_warehouse_id uuid, created_by uuid REFERENCES users ON DELETE SET NULL,
 approved_by uuid REFERENCES users ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 metadata jsonb NOT NULL DEFAULT '{}', FOREIGN KEY (organization_id,source_warehouse_id) REFERENCES warehouses(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (organization_id,destination_warehouse_id) REFERENCES warehouses(organization_id,id) ON DELETE RESTRICT,
 UNIQUE(organization_id,id), UNIQUE(organization_id,reference), CHECK(source_warehouse_id IS DISTINCT FROM destination_warehouse_id)
);
CREATE TABLE stock_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 document_id uuid NOT NULL, product_id uuid NOT NULL, variant_id uuid, warehouse_id uuid, transfer_id uuid,
 movement_type text NOT NULL CHECK(movement_type IN ('opening','receipt','issue','transfer_out','transfer_in','transit_in','transit_out','adjustment','fabric_cut_out','fabric_cut_in')),
 entered_quantity numeric(24,10) NOT NULL CHECK(entered_quantity > 0), entered_unit_id uuid NOT NULL,
 conversion_factor numeric(24,10) NOT NULL CHECK(conversion_factor > 0), normalized_quantity numeric(24,10) NOT NULL CHECK(normalized_quantity > 0),
 occurred_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users ON DELETE SET NULL, metadata jsonb NOT NULL DEFAULT '{}',
 FOREIGN KEY (organization_id,document_id) REFERENCES stock_documents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (organization_id,product_id) REFERENCES products(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (organization_id,variant_id) REFERENCES product_variants(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (organization_id,warehouse_id) REFERENCES warehouses(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (organization_id,transfer_id) REFERENCES stock_documents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (organization_id,entered_unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT,
 CHECK ((movement_type IN ('transit_in','transit_out') AND warehouse_id IS NULL AND transfer_id IS NOT NULL) OR (movement_type NOT IN ('transit_in','transit_out') AND warehouse_id IS NOT NULL))
);
CREATE TABLE stock_document_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 document_id uuid NOT NULL, product_id uuid NOT NULL, variant_id uuid, entered_quantity numeric(24,10) NOT NULL CHECK(entered_quantity > 0),
 entered_unit_id uuid NOT NULL, conversion_factor numeric(24,10) NOT NULL CHECK(conversion_factor > 0), normalized_quantity numeric(24,10) NOT NULL CHECK(normalized_quantity > 0),
 received_quantity numeric(24,10) NOT NULL DEFAULT 0 CHECK(received_quantity >= 0),
 FOREIGN KEY(organization_id,document_id) REFERENCES stock_documents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,product_id) REFERENCES products(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,variant_id) REFERENCES product_variants(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,entered_unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT,
 UNIQUE(organization_id,id)
);
CREATE INDEX stock_movements_balance_idx ON stock_movements(organization_id,warehouse_id,product_id,occurred_at);
CREATE OR REPLACE FUNCTION reject_stock_movement_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stock movements are immutable'; END $$;
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_mutation();
CREATE TABLE fabric_rolls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 product_id uuid NOT NULL, lot_code text, roll_code text NOT NULL, parent_roll_id uuid, warehouse_id uuid NOT NULL,
 original_length numeric(24,10) NOT NULL CHECK(original_length > 0), remaining_length numeric(24,10) NOT NULL CHECK(remaining_length >= 0 AND remaining_length <= original_length),
 unit_id uuid NOT NULL, status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','depleted','quarantined','archived')),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,product_id) REFERENCES products(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,parent_roll_id) REFERENCES fabric_rolls(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,warehouse_id) REFERENCES warehouses(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT, UNIQUE(organization_id,roll_code), UNIQUE(organization_id,id)
);
ALTER TABLE stock_movements ADD COLUMN roll_id uuid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_roll_fk FOREIGN KEY (organization_id,roll_id) REFERENCES fabric_rolls(organization_id,id) ON DELETE RESTRICT;
CREATE TABLE fabric_cuts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 document_id uuid NOT NULL, source_roll_id uuid NOT NULL, result_roll_id uuid NOT NULL, cut_length numeric(24,10) NOT NULL CHECK(cut_length > 0),
 unit_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,document_id) REFERENCES stock_documents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,source_roll_id) REFERENCES fabric_rolls(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,result_roll_id) REFERENCES fabric_rolls(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE stock_counts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 document_id uuid NOT NULL, warehouse_id uuid NOT NULL, product_id uuid NOT NULL, counted_quantity numeric(24,10) NOT NULL CHECK(counted_quantity >= 0),
 unit_id uuid NOT NULL, approved_by uuid REFERENCES users ON DELETE SET NULL, approved_at timestamptz,
 FOREIGN KEY(organization_id,document_id) REFERENCES stock_documents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,warehouse_id) REFERENCES warehouses(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,product_id) REFERENCES products(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,unit_id) REFERENCES units(organization_id,id) ON DELETE RESTRICT
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['membership_warehouses','product_variants','stock_documents','stock_document_lines','stock_movements','fabric_rolls','fabric_cuts','stock_counts'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid)', t); END LOOP; END $$;
