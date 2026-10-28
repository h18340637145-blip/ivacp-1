export type ApiObject = Record<string, unknown>;
export interface ApiOperation {
  summary: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: ApiObject[];
  requestBody?: ApiObject;
  responses: Record<string, ApiObject>;
  "x-required-role"?: string;
}
export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  security: Array<Record<string, string[]>>;
  paths: Record<string, Record<string, ApiOperation>>;
  components: {
    securitySchemes: Record<string, ApiObject>;
    parameters: Record<string, ApiObject>;
    responses: Record<string, ApiObject>;
    schemas: Record<string, ApiObject>;
  };
}
