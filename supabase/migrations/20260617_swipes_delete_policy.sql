DROP POLICY IF EXISTS "swipes_delete_anon" ON swipes;
CREATE POLICY "swipes_delete_anon"
ON swipes FOR DELETE
TO anon
USING (true);
