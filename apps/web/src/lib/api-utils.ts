import { NextResponse } from "next/server";
import { HTTP_STATUS, ERROR_TYPES, type ErrorType } from "./constants";

/**
 * Utility functions for API responses
 */

export interface SuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
  timestamp?: string;
}

export interface ErrorResponse {
  success: false;
  error?: string;
  message: string;
  errorType: ErrorType;
  timestamp: string;
}

/**
 * Create a successful API response
 */
export function createSuccessResponse<T>(
  data?: T,
  message?: string,
  status = HTTP_STATUS.OK
): NextResponse<SuccessResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      ...(data && { data }),
      ...(message && { message }),
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}

/**
 * Create an error API response
 */
export function createErrorResponse(
  message: string,
  errorType: ErrorType = ERROR_TYPES.UNKNOWN,
  status: number = HTTP_STATUS.BAD_REQUEST,
  error?: Error | string
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      message,
      errorType,
      ...(error && { error: String(error) ?? "Unknown error" }),
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}

/**
 * Create a validation error response
 */
export function createValidationError(
  message: string,
  error?: Error | string
): NextResponse<ErrorResponse> {
  return createErrorResponse(
    message,
    ERROR_TYPES.VALIDATION,
    HTTP_STATUS.BAD_REQUEST,
    error
  );
}

/**
 * Create a not found error response
 */
export function createNotFoundError(
  message = "Resource not found",
  error?: Error | string
): NextResponse<ErrorResponse> {
  return createErrorResponse(
    message,
    ERROR_TYPES.VALIDATION,
    HTTP_STATUS.NOT_FOUND,
    error
  );
}

/**
 * Create an unauthorized error response (401)
 */
export function createUnauthorizedError(
  message = "Authentication required",
  error?: Error | string
): NextResponse<ErrorResponse> {
  return createErrorResponse(
    message,
    ERROR_TYPES.VALIDATION,
    HTTP_STATUS.UNAUTHORIZED,
    error
  );
}

/**
 * Create a forbidden error response (403)
 */
export function createForbiddenError(
  message = "Access forbidden",
  error?: Error | string
): NextResponse<ErrorResponse> {
  return createErrorResponse(
    message,
    ERROR_TYPES.VALIDATION,
    HTTP_STATUS.FORBIDDEN,
    error
  );
}

/**
 * Create a timeout error response
 */
export function createTimeoutError(
  message = "Request timed out",
  error?: Error | string
): NextResponse<ErrorResponse> {
  return createErrorResponse(
    message,
    ERROR_TYPES.TIMEOUT,
    HTTP_STATUS.TIMEOUT,
    error
  );
}

/**
 * Create a database error response
 */
export function createDatabaseError(
  message = "Database error occurred",
  error?: Error | string
): NextResponse<ErrorResponse> {
  return createErrorResponse(
    message,
    ERROR_TYPES.DATABASE,
    HTTP_STATUS.SERVICE_UNAVAILABLE,
    error
  );
}

/**
 * Create an external service error response
 */
export function createExternalServiceError(
  message = "External service error",
  error?: Error | string
): NextResponse<ErrorResponse> {
  return createErrorResponse(
    message,
    ERROR_TYPES.EXTERNAL_SERVICE,
    HTTP_STATUS.BAD_GATEWAY,
    error
  );
}

/**
 * Handle API errors with appropriate response
 */
export function handleApiError(error: unknown): NextResponse<ErrorResponse> {
  console.error("API Error:", error);

  if (error instanceof Error) {
    if (error.message.includes('timed out') || error.message.includes('timeout')) {
      return createTimeoutError(
        "The request took too long to complete. Please try again.",
        error
      );
    }

    if (error.message.includes('database') || error.message.includes('connection')) {
      return createDatabaseError(
        "Database connection error. Please try again later.",
        error
      );
    }

    if (error.message.includes('search') || error.message.includes('fetch')) {
      return createExternalServiceError(
        "External service error. Please try again later.",
        error
      );
    }

    if (error.message.includes('openai') || error.message.includes('api')) {
      return createExternalServiceError(
        "AI service temporarily unavailable. Please try again later.",
        error
      );
    }

    if (error.message.includes('validation') || error.message.includes('invalid')) {
      return createValidationError(
        "Invalid request data provided.",
        error
      );
    }
  }

  return createErrorResponse(
    "An unexpected error occurred. Please try again.",
    ERROR_TYPES.UNKNOWN,
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    error instanceof Error ? error : new Error("An unexpected error occurred")
  );
}

/**
 * Validate request body with Zod-like interface
 */
export function validateRequest<T>(
  data: unknown,
  validator: (data: unknown) => T
): { success: true; data: T } | { success: false; error: string } {
  try {
    const validatedData = validator(data);
    return { success: true, data: validatedData };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Validation failed"
    };
  }
}