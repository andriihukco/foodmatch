ALTER TABLE foods ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS ingredients TEXT;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_source_external_id
ON foods(source, external_id)
WHERE source IS NOT NULL AND external_id IS NOT NULL;

DROP POLICY IF EXISTS "foods_insert_anon" ON foods;
CREATE POLICY "foods_insert_anon"
ON foods FOR INSERT
TO anon
WITH CHECK (true);

DROP POLICY IF EXISTS "foods_delete_imported_anon" ON foods;
CREATE POLICY "foods_delete_imported_anon"
ON foods FOR DELETE
TO anon
USING (source IS NOT NULL);
