interface FingerprintAgent {
  get(): Promise<{ visitorId: string }>;
}

declare global {
  interface Window {
    fpPromise?: Promise<FingerprintAgent>;
  }
}

export {};
