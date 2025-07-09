# OIDC Client Provisioning Scripts

This directory contains scripts for managing OIDC clients in the identity server database.

## provision-client.ts

A comprehensive script for creating, deleting, and listing OIDC clients programmatically.

### Usage

#### Using npm script (recommended):
```bash
npm run provision-client <command> [options]
```

#### Using tsx directly:
```bash
tsx scripts/provision-client.ts <command> [options]
```

### Commands

#### Provision a predefined client
```bash
npm run provision-client provision test-client
npm run provision-client provision dev-app
npm run provision-client provision mobile-app
```

#### List all existing clients
```bash
npm run provision-client list
```

#### Delete a client
```bash
npm run provision-client delete test-client
npm run provision-client delete dev-app-client
```

#### Provision clients from a custom config file
```bash
npm run provision-client provision-custom ./scripts/clients-config.example.json
```

#### Show help
```bash
npm run provision-client help
```

### Predefined Clients

The script includes several predefined client configurations:

1. **test-client** - Basic test client for the included test application
   - Client ID: `test-client`
   - Redirect URI: `http://localhost:3001/callback`
   - Auth Method: `client_secret_basic`

2. **dev-app** - Development application with multiple redirect URIs
   - Client ID: `dev-app-client`
   - Redirect URIs: `http://localhost:3000/auth/callback`, `http://localhost:8080/callback`
   - Auth Method: `client_secret_basic`

3. **mobile-app** - Mobile application using PKCE
   - Client ID: `mobile-app-client`
   - Redirect URIs: `myapp://callback`, `http://localhost/callback`
   - Auth Method: `none` (PKCE only)

### Custom Configuration

You can create custom client configurations using a JSON file. See `clients-config.example.json` for the format.

#### Configuration Format

```json
{
  "client-key": {
    "client_name": "Human-readable client name",
    "client_id": "unique-client-identifier",
    "client_secret": "optional-secret-for-confidential-clients",
    "redirect_uris": ["http://localhost:3000/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "scope": "openid profile email",
    "token_endpoint_auth_method": "client_secret_basic"
  }
}
```

#### Field Descriptions

- **client_name**: Human-readable name for the client application
- **client_id**: Unique identifier for the client (auto-generated if not provided)
- **client_secret**: Secret for confidential clients (auto-generated if not provided)
- **redirect_uris**: Array of allowed redirect URIs after authentication
- **grant_types**: OAuth2/OIDC grant types supported by the client
- **response_types**: OAuth2/OIDC response types supported by the client
- **scope**: Space-separated list of scopes the client can request
- **token_endpoint_auth_method**: How the client authenticates to the token endpoint

#### Common Auth Methods

- **client_secret_basic**: Client ID and secret via HTTP Basic auth (confidential clients)
- **client_secret_post**: Client ID and secret in POST body (confidential clients)
- **none**: No authentication, used with PKCE (public clients like SPAs and mobile apps)

#### Common Grant Types

- **authorization_code**: Standard authorization code flow
- **refresh_token**: Allows refreshing access tokens
- **client_credentials**: Server-to-server authentication
- **implicit**: Legacy flow for SPAs (not recommended)

### Examples

#### Create a new SPA client
```json
{
  "my-spa": {
    "client_name": "My Single Page Application",
    "client_id": "my-spa-client",
    "redirect_uris": ["http://localhost:3000", "https://myapp.com"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "scope": "openid profile email",
    "token_endpoint_auth_method": "none"
  }
}
```

#### Create a server-to-server API client
```json
{
  "api-service": {
    "client_name": "API Service Client",
    "client_id": "api-service-client",
    "redirect_uris": [],
    "grant_types": ["client_credentials"],
    "response_types": [],
    "scope": "api:read api:write",
    "token_endpoint_auth_method": "client_secret_basic"
  }
}
```

### Environment Variables

The script uses the same database connection configuration as the main application:

- `DB_HOST` (default: localhost)
- `DB_PORT` (default: 5432)
- `DB_NAME` (default: identity_server)
- `DB_USER` (default: postgres)
- `DB_PASSWORD` (default: postgres)

### Notes

- The script will not overwrite existing clients with the same client_id
- All operations are logged to the application logs
- Client secrets are auto-generated as UUIDs if not provided
- The script validates that required fields are present before creating clients
- Use `provision-client list` to see all existing clients before making changes
