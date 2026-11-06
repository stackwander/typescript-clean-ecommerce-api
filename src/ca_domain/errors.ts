export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const missing = (entity: string) => new AppError(404, 'NOT_FOUND', `${entity} not found`);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
