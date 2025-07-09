// Type definitions for oidc-provider
declare module 'oidc-provider' {
  export interface Configuration {
    adapter?: any;
    clients?: any[];
    interactions?: {
      url?: (ctx: any, interaction: any) => string;
    };
    cookies?: {
      keys?: string[];
    };
    claims?: {
      [key: string]: string[];
    };
    features?: {
      [key: string]: any;
    };
    findAccount?: (ctx: any, id: string, token?: any) => Promise<any>;
    jwks?: {
      keys?: any[];
    };
    ttl?: {
      [key: string]: number;
    };
  }

  export class Provider {
    constructor(issuer: string, configuration: Configuration);
    callback(): any;
    interactionDetails(req: any, res: any): Promise<any>;
    interactionFinished(req: any, res: any, result: any, options?: any): Promise<void>;
    Session: {
      get(req: any): Promise<any>;
    };
    Grant: any;
  }
}
