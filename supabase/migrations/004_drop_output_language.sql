-- Lead Radar: remove radars.output_language. It stored the visitor's browser language (e.g. fr-FR), which has not
-- been used since research-v1.1 (research writes in the website's own language) and made radars look French.
-- Run only after the code that no longer writes this column is deployed. Safe to re-run.
alter table public.radars drop column if exists output_language;
