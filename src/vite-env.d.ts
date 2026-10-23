/// <reference types="vite/client" />
import type { PrimeAPI } from '../shared/types';

declare global {
  interface Window { prime: PrimeAPI }
}
export {};
