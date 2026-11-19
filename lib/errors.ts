/** A user-facing, expected error. Message is Norwegian and safe to show. */
export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'DomainError';
  }
}
export const forbidden = (msg = 'Du har ikke tilgang til dette.') => new DomainError('forbidden', msg, 403);
export const notFound = (msg = 'Fant ikke det du lette etter.') => new DomainError('not_found', msg, 404);
