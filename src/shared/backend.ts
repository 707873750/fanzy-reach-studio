export interface CaptionPreviewInput {
  action: "variants" | "translate" | "shorten";
  text: string;
  language?: string;
  maxLength?: number;
}
export interface CaptionRequest {
  action?: CaptionPreviewInput["action"];
  text?: string;
  language?: string;
  maxLength?: number;
 style?: import("./types").ContentStyle;
  images: string[];
  platforms: import('./types').Platform[];
  shared: boolean;
  hasVideo: boolean;
}

export interface CaptionResult {
  candidates?: string[];
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
