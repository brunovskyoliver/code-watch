import { z } from "zod";

export const keybindingSchema = z.object({
  key: z.string().trim().min(1),
  command: z.string().trim().min(1)
});

export const keybindingsSchema = z.array(keybindingSchema);

export type Keybinding = z.infer<typeof keybindingSchema>;

export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  { key: "escape", command: "project-context.close" },
  { key: "escape", command: "base-branch-menu.close" },
  { key: "mod+w", command: "file.close" },
  { key: "mod+/", command: "command-menu.open" },
  { key: "/", command: "file-search.open" },
  { key: "escape", command: "command-menu.close-or-back" },
  { key: "arrowdown", command: "command-menu.next" },
  { key: "arrowup", command: "command-menu.previous" },
  { key: "enter", command: "command-menu.select" },
  { key: "escape", command: "file-search.close" },
  { key: "arrowdown", command: "file-search.next" },
  { key: "arrowup", command: "file-search.previous" },
  { key: "enter", command: "file-search.select" }
];
