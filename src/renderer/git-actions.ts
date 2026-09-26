import type { ChangedFile, ProjectSummary, ReviewSessionDetail } from "@shared/types";

export function canPushCurrentBranch(input: {
  project: ProjectSummary | null;
  session: ReviewSessionDetail | null;
  files: ChangedFile[];
}): boolean {
  if ((input.project?.aheadCount ?? 0) > 0) {
    return true;
  }

  if (!input.project || !input.session || !input.project.currentBranch) {
    return false;
  }

  if (input.session.session.branchName !== input.project.currentBranch) {
    return false;
  }

  return input.files.some((file) => file.source === "committed");
}
