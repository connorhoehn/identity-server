// Data provider interfaces for supporting multiple databases
export interface UserPoolData {
  poolId: string;
  clientId: string;
  poolName: string;
  customAttributes: Record<string, string>; // attribute_name -> attribute_type
  settings: {
    passwordPolicy?: {
      minLength?: number;
      requireUppercase?: boolean;
      requireLowercase?: boolean;
      requireNumbers?: boolean;
      requireSymbols?: boolean;
    };
    mfaConfiguration?: 'OFF' | 'OPTIONAL' | 'REQUIRED';
    accountRecovery?: {
      email?: boolean;
      sms?: boolean;
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface UserData {
  userId: string;
  poolId: string;
  email: string;
  emailVerified: boolean;
  passwordHash: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  nickname?: string;
  picture?: string;
  website?: string;
  customAttributes: Record<string, any>; // custom attribute values
  groups: string[];
  status: 'CONFIRMED' | 'UNCONFIRMED' | 'ARCHIVED' | 'COMPROMISED' | 'RESET_REQUIRED';
  mfaEnabled: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientData {
  clientId: string;
  clientSecret: string;
  clientName: string;
  poolId: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  responseTypes: string[];
  grantTypes: string[];
  scope: string;
  tokenEndpointAuthMethod: string;
  applicationType: string;
  settings: {
    accessTokenValidity?: number;
    idTokenValidity?: number;
    refreshTokenValidity?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupData {
  groupId: string;
  poolId: string;
  groupName: string;
  description?: string;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MfaDeviceData {
  deviceId: string;
  poolId: string;
  userId: string;
  deviceName: string;
  deviceType: 'TOTP' | 'SMS'; // For future support
  secretKey: string; // Encrypted/hashed secret for TOTP
  isVerified: boolean;
  backupCodes?: string[]; // Optional backup codes
  createdAt: Date;
  updatedAt: Date;
  lastUsed?: Date;
}

// Data provider interface
export interface IDataProvider {
  // Connection management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // User Pool operations
  createUserPool(pool: Omit<UserPoolData, 'createdAt' | 'updatedAt'>): Promise<UserPoolData>;
  getUserPool(poolId: string): Promise<UserPoolData | null>;
  getUserPoolByClientId(clientId: string): Promise<UserPoolData | null>;
  listUserPools(): Promise<UserPoolData[]>;
  updateUserPool(poolId: string, updates: Partial<UserPoolData>): Promise<UserPoolData>;
  deleteUserPool(poolId: string): Promise<void>;
  
  // User operations (pool-scoped)
  createUser(user: Omit<UserData, 'userId' | 'createdAt' | 'updatedAt'>): Promise<UserData>;
  getUser(poolId: string, userId: string): Promise<UserData | null>;
  getUserByEmail(poolId: string, email: string): Promise<UserData | null>;
  listUsers(poolId: string, limit?: number, nextToken?: string): Promise<{ users: UserData[], nextToken?: string }>;
  updateUser(poolId: string, userId: string, updates: Partial<UserData>): Promise<UserData>;
  deleteUser(poolId: string, userId: string): Promise<void>;
  
  // Client operations
  createClient(client: Omit<ClientData, 'createdAt' | 'updatedAt'>): Promise<ClientData>;
  getClient(clientId: string): Promise<ClientData | null>;
  listClients(poolId?: string): Promise<ClientData[]>;
  updateClient(clientId: string, updates: Partial<ClientData>): Promise<ClientData>;
  deleteClient(clientId: string): Promise<void>;
  
  // Group operations (pool-scoped)
  createGroup(group: Omit<GroupData, 'groupId' | 'createdAt' | 'updatedAt'>): Promise<GroupData>;
  getGroup(poolId: string, groupId: string): Promise<GroupData | null>;
  listGroups(poolId: string): Promise<GroupData[]>;
  updateGroup(poolId: string, groupId: string, updates: Partial<GroupData>): Promise<GroupData>;
  deleteGroup(poolId: string, groupId: string): Promise<void>;
  
  // User-Group operations
  addUserToGroup(poolId: string, userId: string, groupId: string): Promise<void>;
  removeUserFromGroup(poolId: string, userId: string, groupId: string): Promise<void>;
  getUserGroups(poolId: string, userId: string): Promise<GroupData[]>;
  getGroupUsers(poolId: string, groupId: string): Promise<UserData[]>;
  
  // MFA Device operations
  createMfaDevice(device: Omit<MfaDeviceData, 'deviceId' | 'createdAt' | 'updatedAt'>): Promise<MfaDeviceData>;
  getMfaDevice(poolId: string, userId: string, deviceId: string): Promise<MfaDeviceData | null>;
  listUserMfaDevices(poolId: string, userId: string): Promise<MfaDeviceData[]>;
  updateMfaDevice(poolId: string, userId: string, deviceId: string, updates: Partial<MfaDeviceData>): Promise<MfaDeviceData>;
  deleteMfaDevice(poolId: string, userId: string, deviceId: string): Promise<void>;
  verifyMfaDevice(poolId: string, userId: string, deviceId: string): Promise<void>;
  updateUserMfaStatus(poolId: string, userId: string, enabled: boolean): Promise<void>;
}
