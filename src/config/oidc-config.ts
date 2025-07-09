import { Configuration } from 'oidc-provider';
import { RedisAdapter } from '../adapters/redis-adapter.js';
import { Account } from '../models/account-multi-tenant.js';
import { ClientStore } from '../models/client-store-multi-tenant.js';

export const configuration: Configuration = {
  adapter: RedisAdapter,
  // Dynamic client loading - will be replaced with actual clients during startup
  clients: [], // This will be populated by initializeOidcClients()
  interactions: {
    url(ctx: any, interaction: any) {
      return `/interaction/${interaction.uid}`;
    },
  },
  cookies: {
    keys: (process.env.COOKIE_KEYS || 'some-secret-key-here,another-secret-key').split(','),
  },
  claims: {
    openid: ['sub'],
    email: ['email', 'email_verified'],
    profile: ['name', 'family_name', 'given_name', 'middle_name', 'nickname', 'preferred_username', 'picture', 'website', 'gender', 'birthdate', 'zoneinfo', 'locale', 'updated_at'],
  },
  features: {
    devInteractions: { enabled: false },
    resourceIndicators: { enabled: false }
  },
  findAccount: Account.findAccount,
  ttl: {
    AuthorizationCode: 10 * 60, // 10 minutes
    AccessToken: 1 * 60 * 60, // 1 hour
    IdToken: 1 * 60 * 60, // 1 hour
    RefreshToken: 14 * 24 * 60 * 60, // 14 days
    Interaction: 1 * 60 * 60, // 1 hour
    Session: 14 * 24 * 60 * 60, // 14 days
    Grant: 14 * 24 * 60 * 60, // 14 days
  },
};

// Function to initialize OIDC clients from data provider
export async function initializeOidcClients(): Promise<void> {
  const clients = await ClientStore.loadClients();
  configuration.clients = clients;
}
