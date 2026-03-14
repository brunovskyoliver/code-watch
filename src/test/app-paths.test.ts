import { describe, expect, it } from "vitest";
import { CODE_WATCH_HOME_DIRECTORY, getCodeWatchPaths } from "@main/app-paths";

describe("app-paths", () => {
  it("stores app data under the home-level .code-watch directory", () => {
    const paths = getCodeWatchPaths("/Users/tester");

    expect(paths.userDataPath).toBe(`/Users/tester/${CODE_WATCH_HOME_DIRECTORY}`);
    expect(paths.sessionDataPath).toBe(`/Users/tester/${CODE_WATCH_HOME_DIRECTORY}/session`);
  });
});
