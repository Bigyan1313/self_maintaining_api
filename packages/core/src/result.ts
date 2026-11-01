/** Successful outcome carrying a value of type `T`. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** Failed outcome carrying an error of type `E`. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * Outcome of an operation that can fail in an expected way.
 *
 * Domain functions return a `Result` instead of throwing, so callers must
 * handle the failure branch explicitly.
 */
export type Result<T, E> = Ok<T> | Err<E>;

/**
 * Builds a successful {@link Result}.
 * @param value - The success value.
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Builds a failed {@link Result}.
 * @param error - The error value.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Type guard: `true` when the result is a success.
 * @param result - The result to inspect.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Type guard: `true` when the result is a failure.
 * @param result - The result to inspect.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}
