import type { ReviewAssistantContext, ReviewAssistantProvider } from "@shared/assistants/provider";

export class NoopAssistantProvider implements ReviewAssistantProvider {
  readonly id = "noop";
  readonly label = "No assistant";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async summarizeReview(_context: ReviewAssistantContext): Promise<string | null> {
    return null;
  }
}
