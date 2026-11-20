export const IMAGE_SIZES = ["1328x1328", "1472x1104", "1104x1472", "1584x1056", "1056x1584", "1664x936", "936x1664", "2016x864"] as const;
export const IMAGE_PROMPT_LIMIT = 800;
export interface GeneratedImagePreview { taskId: string; dataUrl: string; }
export interface EditImageUpload { id: string; fileName: string; thumbnailDataUrl: string; }
export interface GenerateImageRequest {
  mode: "generate" | "edit";
  prompt: string;
  size: string;
  imageId?: string;
  uploadId?: string;
  scale?: number;
}
