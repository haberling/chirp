-- Dev-only fake data for client/preview.html (page_id = 'preview-page').
-- Not shipped anywhere -- run against local D1 only:
--   npm run db:seed:preview
-- Re-runnable: clears any existing preview-page rows first.
--
-- commenter_id values are deliberately fake/readable (not real salted
-- hashes) -- fine for local visual testing, since the widget only ever
-- compares them for equality, never recomputes them.

DELETE FROM comments WHERE page_id = 'preview-page';

INSERT INTO comments (id, page_id, parent_id, author_name, author_email, body, created_at, ip_hash, commenter_id) VALUES
  ('seed-1', 'preview-page', NULL, 'Alice', NULL, 'This is what a normal comment looks like.', 1787170940668, 'seed-ip', 'seed-commenter-you'),
  ('seed-2', 'preview-page', NULL, 'Bob', NULL, 'I disagree, but that is what makes discussion good.', 1787174540668, 'seed-ip', 'seed-commenter-bob'),
  ('seed-2r', 'preview-page', 'seed-2', 'Dana', NULL, 'Replying to Bob to check reply indentation.', 1787176340668, 'seed-ip', 'seed-commenter-dana'),
  ('seed-3', 'preview-page', NULL, 'Carol', NULL, 'Here is a much longer comment, just to see how the widget handles text wrapping when someone writes a few sentences instead of a short one-liner. Does it stay readable at this length?', 1787178140668, 'seed-ip', 'seed-commenter-carol'),
  ('seed-4', 'preview-page', NULL, 'Carol', NULL, 'Following up on my last comment with another one, same person.', 1787181740668, 'seed-ip', 'seed-commenter-carol');
