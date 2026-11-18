import type { ReachApi } from "../../shared/types";

declare global {
  interface Window {
    reach: ReachApi;
  }
}

export {};
