-- Migration: Add post_logout_redirect_uris column to clients table
-- This column stores the allowed redirect URIs after logout

ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS post_logout_redirect_uris TEXT[] DEFAULT '{}';

-- Update existing clients to have default post-logout redirect URIs
UPDATE clients 
SET post_logout_redirect_uris = ARRAY['http://localhost:3006/', 'http://localhost:3006/logout-callback']
WHERE client_id = 'local-test-client' 
AND (post_logout_redirect_uris IS NULL OR post_logout_redirect_uris = '{}');

-- Update any other existing clients to have at least one post-logout redirect URI
UPDATE clients 
SET post_logout_redirect_uris = ARRAY['http://localhost:3006/']
WHERE (post_logout_redirect_uris IS NULL OR post_logout_redirect_uris = '{}');
