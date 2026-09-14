import { describe, expect, it } from "vitest";
import { detectOs } from "../shared/os.ts";

describe("detectOs", () => {
  it("detects mac from explicit mentions", () => {
    expect(detectOs("WinRAR 7.30 for Mac")).toBe("mac");
    expect(detectOs("Adobe Photoshop 2026 (macOS)")).toBe("mac");
    expect(detectOs("CleanMyMac X 4.14 – Mac OS X")).toBe("mac");
    expect(detectOs("Pixel Sorter Plugin Win/macOS")).toBe("mac");
    expect(detectOs("Apple Silicon build of the tool")).toBe("mac");
  });

  it("does not match mac inside longer words", () => {
    expect(detectOs("Macro Recorder for machine setup")).toBeNull();
  });

  it("detects windows from explicit mentions", () => {
    expect(detectOs("Windows 11 Manager 2.1")).toBe("windows");
    expect(detectOs("DaVinci Resolve Studio 19 Win x64")).toBe("windows");
    expect(detectOs("Ableton Live 11.0.2 Suite WIN DAW")).toBe("windows");
    expect(detectOs("Tool 5.0 (x86/x64)")).toBe("windows");
    expect(detectOs("App Win10 edition")).toBe("windows");
  });

  it("does not treat Win-prefixed names as windows evidence", () => {
    expect(detectOs("WinRAR 7.30")).toBeNull();
    expect(detectOs("WinX VideoProc Converter AI 8.11")).toBeNull();
  });

  it("returns null when the title has no OS evidence", () => {
    expect(detectOs("FliFlik UltConv 7.4.2")).toBeNull();
    expect(detectOs("")).toBeNull();
  });
});
