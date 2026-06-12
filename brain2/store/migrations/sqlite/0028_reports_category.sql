-- 0028_reports_category: add an optional category for reports.
--
-- `category` is set at generate-time from the Reports catalog (e.g. 'Financial',
-- 'Operations') and powers history search. Nullable so existing rows are valid;
-- they search on title only.

ALTER TABLE reports ADD COLUMN category TEXT;
