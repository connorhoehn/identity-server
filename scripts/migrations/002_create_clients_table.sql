-- Migration: Create clients table
-- This table stores OIDC client applications

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id VARCHAR(255) UNIQUE NOT NULL,
    client_secret VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    redirect_uris TEXT[] NOT NULL DEFAULT '{}',
    grant_types TEXT[] NOT NULL DEFAULT '{"authorization_code", "refresh_token"}',
    response_types TEXT[] NOT NULL DEFAULT '{"code"}',
    scope VARCHAR(255) NOT NULL DEFAULT 'openid profile email',
    token_endpoint_auth_method VARCHAR(50) NOT NULL DEFAULT 'client_secret_basic',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index on client_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_clients_client_id ON clients(client_id);

-- Insert the default test client
INSERT INTO clients (
    client_id, 
    client_secret, 
    client_name, 
    redirect_uris, 
    grant_types, 
    response_types, 
    scope, 
    token_endpoint_auth_method
) VALUES (
    'local-test-client',
    'local-test-client-secret',
    'Local Test Client',
    ARRAY['http://localhost:3006/callback', 'http://localhost:3007/callback'],
    ARRAY['authorization_code', 'refresh_token'],
    ARRAY['code'],
    'openid profile email',
    'client_secret_basic'
) ON CONFLICT (client_id) DO NOTHING;

-- Add trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clients_updated_at 
    BEFORE UPDATE ON clients 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
