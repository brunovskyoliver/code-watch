import type { ChangedFile, ReviewSessionDetail, ThreadPreview } from "@shared/types";

export interface ReviewAssistantContext {
  session: ReviewSessionDetail;
  files: ChangedFile[];
  threads: ThreadPreview[];
}

export interface ReviewAssistantProvider {
  readonly id: string;
  readonly label: string;
  isAvailable(): Promise<boolean>;
  summarizeReview(context: ReviewAssistantContext): Promise<string | null>;
}
