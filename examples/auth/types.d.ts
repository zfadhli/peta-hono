import "hono";

declare module "hono" {
  interface ContextVariableMap {
    session: {
      userId?: string;
      email?: string;
      userRole?: string;
      save(): Promise<void>;
      destroy(): void;
      [key: string]: unknown;
    };
  }
}
