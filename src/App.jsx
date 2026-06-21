CREATE TABLE IF NOT EXISTS credit_notes (
  id text PRIMARY KEY,
  party_type text DEFAULT 'jobber',
  party text DEFAULT '',
  cn_no text DEFAULT '',
  cn_date text DEFAULT '',
  reason text DEFAULT '',
  lines jsonb DEFAULT '[]',
  total numeric DEFAULT 0,
  created_by text DEFAULT '',
  created_at_str text DEFAULT ''
);
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all credit_notes" ON credit_notes FOR ALL USING (true) WITH CHECK (true);
