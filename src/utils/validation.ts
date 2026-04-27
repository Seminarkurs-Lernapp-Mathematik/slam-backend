/**
 * Composable Validation Middleware for Hono
 * Provides type-safe, reusable validation rules
 */

import type { Context, MiddlewareHandler } from 'hono';

export class ValidationError extends Error {
  constructor(message: string, public field: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

type ValidationRule = (value: any, field: string) => void;

export const Rules = {
  required: (): ValidationRule => (value, field) => {
    if (value === undefined || value === null || value === '') {
      throw new ValidationError(`${field} is required`, field);
    }
  },

  string: (): ValidationRule => (value, field) => {
    if (typeof value !== 'string') {
      throw new ValidationError(`${field} must be a string`, field);
    }
  },

  number: (): ValidationRule => (value, field) => {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new ValidationError(`${field} must be a number`, field);
    }
  },

  integer: (): ValidationRule => (value, field) => {
    if (!Number.isInteger(value)) {
      throw new ValidationError(`${field} must be an integer`, field);
    }
  },

  email: (): ValidationRule => (value, field) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      throw new ValidationError(`${field} must be a valid email`, field);
    }
  },

  minLength: (min: number): ValidationRule => (value, field) => {
    if (value.length < min) {
      throw new ValidationError(`${field} must be at least ${min} characters`, field);
    }
  },

  maxLength: (max: number): ValidationRule => (value, field) => {
    if (value.length > max) {
      throw new ValidationError(`${field} must be at most ${max} characters`, field);
    }
  },

  min: (min: number): ValidationRule => (value, field) => {
    if (value < min) {
      throw new ValidationError(`${field} must be at least ${min}`, field);
    }
  },

  max: (max: number): ValidationRule => (value, field) => {
    if (value > max) {
      throw new ValidationError(`${field} must be at most ${max}`, field);
    }
  },

  array: (): ValidationRule => (value, field) => {
    if (!Array.isArray(value)) {
      throw new ValidationError(`${field} must be an array`, field);
    }
  },

  nonEmptyArray: (): ValidationRule => (value, field) => {
    if (!Array.isArray(value) || value.length === 0) {
      throw new ValidationError(`${field} must be a non-empty array`, field);
    }
  },

  oneOf: <T>(allowed: T[]): ValidationRule => (value, field) => {
    if (!allowed.includes(value)) {
      throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`, field);
    }
  },
};

export class Schema {
  private fields: Map<string, ValidationRule[]> = new Map();

  field(name: string, ...rules: ValidationRule[]): this {
    this.fields.set(name, rules);
    return this;
  }

  validate(data: any): void {
    for (const [field, rules] of this.fields.entries()) {
      const value = data[field];
      for (const rule of rules) {
        rule(value, field);
      }
    }
  }
}

export function validateBody(schema: Schema): MiddlewareHandler {
  return async (c: Context, next) => {
    try {
      const body = await c.req.json();
      schema.validate(body);
      await next();
    } catch (error) {
      if (error instanceof ValidationError) {
        return c.json({
          success: false,
          error: 'Validation Error',
          message: error.message,
          field: error.field,
        }, 400);
      }
      throw error;
    }
  };
}

export function validateQuery(schema: Schema): MiddlewareHandler {
  return async (c: Context, next) => {
    try {
      const query = c.req.query();
      schema.validate(query);
      await next();
    } catch (error) {
      if (error instanceof ValidationError) {
        return c.json({
          success: false,
          error: 'Validation Error',
          message: error.message,
          field: error.field,
        }, 400);
      }
      throw error;
    }
  };
}
