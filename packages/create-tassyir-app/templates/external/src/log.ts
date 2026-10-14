// Where the server writes what happened. Never pass a token, a secret or a
// buyer's contact details to it.
export interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export const consoleLog: Log = {
  info: (message) => {
    console.log(message);
  },
  warn: (message) => {
    console.warn(message);
  },
  error: (message, error) => {
    console.error(message, error);
  },
};
