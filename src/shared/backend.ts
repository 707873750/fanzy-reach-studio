export interface CaptionRequest {
  images: string[];
  platforms: import('./types').Platform[];
  shared: boolean;
  hasVideo: boolean;
}

export interface CaptionResult {
  caption: string;
  title?: string;
  hashtags?: string[];
  alt_text?: string;
}

export interface BackendAccount {
  user: { id: string; name: string; balance: number };
  checkedIn: boolean;
  day: string;
  config: { enabled: boolean; cost: number; checkinReward: number; providerReady: boolean; model: string; sizes: string[] };
  ledger: { delta: number; reason: string; created_at: string }[];
  activeTaskId: string | null;
}
