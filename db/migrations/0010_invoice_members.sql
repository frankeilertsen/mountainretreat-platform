-- Invoice for selected members: the administrator allows it per member. The platform makes an invoice draft
-- (fakturagrunnlag) which is issued and sent from Fiken; Fiken's invoice number/KID can be noted afterwards.
ALTER TABLE users ADD COLUMN IF NOT EXISTS invoice_allowed boolean NOT NULL DEFAULT false;

ALTER TABLE invoices ALTER COLUMN kid_number DROP NOT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fiken_invoice_number text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_by_user_id uuid REFERENCES users(id);
ALTER TABLE invoices ALTER COLUMN sent_at DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN sent_at DROP DEFAULT;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft','sent','paid','overdue','cancelled'));

-- The method itself is on; who may use it is decided per member.
UPDATE payment_method_settings SET enabled = true, updated_at = now() WHERE method = 'invoice';
