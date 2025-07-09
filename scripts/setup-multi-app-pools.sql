-- Example: Creating separate user pools and clients

-- Create user pools for different applications
INSERT INTO user_pools (pool_id, client_id, pool_name, custom_attributes, settings)
VALUES 
  ('ecommerce-pool', 'ecommerce-client', 'E-commerce App Pool', '{}', '{"passwordPolicy": {"minLength": 8}}'),
  ('blog-pool', 'blog-client', 'Blog App Pool', '{}', '{"passwordPolicy": {"minLength": 6}}'),
  ('admin-pool', 'admin-client', 'Admin App Pool', '{}', '{"passwordPolicy": {"minLength": 12}}');

-- Create clients for different applications
INSERT INTO clients (
  client_id, 
  client_secret, 
  client_name, 
  pool_id,
  redirect_uris, 
  post_logout_redirect_uris,
  grant_types, 
  response_types, 
  scope
) VALUES 
  (
    'ecommerce-client',
    'ecommerce-secret-123', 
    'E-commerce Application',
    'ecommerce-pool',
    ARRAY['https://shop.example.com/callback'],
    ARRAY['https://shop.example.com/logout'],
    ARRAY['authorization_code', 'refresh_token'],
    ARRAY['code'],
    'openid profile email'
  ),
  (
    'blog-client',
    'blog-secret-456',
    'Blog Application', 
    'blog-pool',
    ARRAY['https://blog.example.com/callback'],
    ARRAY['https://blog.example.com/logout'],
    ARRAY['authorization_code', 'refresh_token'],
    ARRAY['code'],
    'openid profile email'
  ),
  (
    'admin-client',
    'admin-secret-789',
    'Admin Dashboard',
    'admin-pool', 
    ARRAY['https://admin.example.com/callback'],
    ARRAY['https://admin.example.com/logout'],
    ARRAY['authorization_code', 'refresh_token'],
    ARRAY['code'],
    'openid profile email admin'
  );
