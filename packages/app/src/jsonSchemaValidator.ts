import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv'

/** Schemas from separate tools are separate authorities even when their $id matches. */
export class ToolJsonSchemaValidator {
  getValidator<T>(schema: Parameters<AjvJsonSchemaValidator['getValidator']>[0]) {
    return new AjvJsonSchemaValidator().getValidator<T>(schema)
  }
}
