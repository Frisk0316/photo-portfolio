export function safeError(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}
