const isMacPlatform = navigator.platform.toLowerCase().includes("mac");

const aliasMap: Record<string, string> = {
  cmd: "meta",
  command: "meta",
  option: "alt",
  esc: "escape",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  space: " ",
  slash: "/"
};

export function matchesKeybinding(event: KeyboardEvent, rawBinding: string): boolean {
  const parsed = parseKeybinding(rawBinding);
  if (!parsed) {
    return false;
  }

  const eventKey = normalizeToken(event.key);
  if (eventKey !== parsed.key) {
    return false;
  }

  const expectedMeta = parsed.meta || (parsed.mod && isMacPlatform);
  const expectedCtrl = parsed.ctrl || (parsed.mod && !isMacPlatform);
  const expectedAlt = parsed.alt;
  const expectedShift = parsed.shift;

  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.altKey === expectedAlt &&
    event.shiftKey === expectedShift
  );
}

function parseKeybinding(rawBinding: string): ParsedKeybinding | null {
  const tokens = rawBinding
    .split("+")
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  const parsed: ParsedKeybinding = {
    key: "",
    mod: false,
    meta: false,
    ctrl: false,
    alt: false,
    shift: false
  };

  for (const token of tokens) {
    if (token === "mod") {
      parsed.mod = true;
      continue;
    }
    if (token === "meta") {
      parsed.meta = true;
      continue;
    }
    if (token === "ctrl") {
      parsed.ctrl = true;
      continue;
    }
    if (token === "alt") {
      parsed.alt = true;
      continue;
    }
    if (token === "shift") {
      parsed.shift = true;
      continue;
    }

    if (parsed.key.length > 0) {
      return null;
    }
    parsed.key = token;
  }

  if (!parsed.key) {
    return null;
  }

  return parsed;
}

function normalizeToken(value: string): string {
  const normalized = value.trim().toLowerCase();
  return aliasMap[normalized] ?? normalized;
}

interface ParsedKeybinding {
  key: string;
  mod: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}
