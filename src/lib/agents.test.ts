import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAgentCommandPreview,
  applyGlobalPermissionPreset,
  getGlobalPermissionPreset,
  isAgentYoloEnabled,
  getAgentCommandShell,
  getAgentIdsWithCapability,
  getAgentTerminalBehavior,
  formatAgentVersion,
  getAgentStartupCommand,
  getDefaultAgentLaunchOptions,
  getPermissionDefaultsForLaunch,
  prepareAgentInitialPrompt,
  supportsAgentCapability,
} from "./agents";

describe("getDefaultAgentLaunchOptions", () => {
  it("migrates legacy approvals at both launch and persistence boundaries", () => {
    const legacy = { yolo: false, approvalMode: "untrusted", sandboxMode: "read-only", effort: "inherit" } as const;
    expect(getDefaultAgentLaunchOptions("codex", { codex: legacy })).toMatchObject({ approvalMode: "on-request", sandboxMode: "read-only" });
    expect(getPermissionDefaultsForLaunch("codex", legacy).codex?.approvalMode).toBe("on-request");
    expect(getAgentStartupCommand("codex", undefined, null, null, legacy)).toContain("--ask-for-approval on-request --sandbox read-only");
    expect(getAgentStartupCommand("codex", undefined, null, null, { ...legacy, approvalMode: "never" })).toContain("--ask-for-approval never --sandbox read-only");
  });
  it("uses the saved Claude permission mode", () => {
    expect(getDefaultAgentLaunchOptions("claude", {})).toEqual({
      skipPermissions: false,
      effort: "inherit",
    });
    expect(getDefaultAgentLaunchOptions("claude", { claude: { skipPermissions: true } })).toEqual({
      skipPermissions: true,
      effort: "inherit",
    });
  });

  it("keeps conservative defaults for the other agents", () => {
    expect(getDefaultAgentLaunchOptions("codex", {})).toEqual({
      yolo: false,
      approvalMode: "on-request",
      sandboxMode: "workspace-write",
      effort: "inherit",
    });
    expect(getDefaultAgentLaunchOptions("antigravity", {})).toEqual({
      dangerouslySkipPermissions: false,
      sandbox: false,
      mode: "inherit",
    });
    expect(getDefaultAgentLaunchOptions("opencode", {})).toBeUndefined();
    expect(getDefaultAgentLaunchOptions("pi", {})).toBeUndefined();
    expect(getDefaultAgentLaunchOptions("qoder", {})).toEqual({
      permissionMode: "inherit",
    });
  });
  it("uses the saved permission mode for each supported agent type", () => {
    expect(getDefaultAgentLaunchOptions("codex", {
      codex: { yolo: true, approvalMode: "never", sandboxMode: "read-only" },
    })).toEqual({
      yolo: true,
      approvalMode: "never",
      sandboxMode: "read-only",
      effort: "inherit",
    });
    expect(getDefaultAgentLaunchOptions("antigravity", {
      antigravity: { dangerouslySkipPermissions: true, sandbox: true, mode: "plan" },
    })).toEqual({
      dangerouslySkipPermissions: true,
      sandbox: true,
      mode: "plan",
    });
    expect(getDefaultAgentLaunchOptions("qoder", {
      qoder: { permissionMode: "bypass_permissions" },
    })).toEqual({ permissionMode: "bypass_permissions" });
  });

  it("stores effort alongside explicitly saved permission defaults", () => {
    expect(getPermissionDefaultsForLaunch("codex", {
      yolo: false,
      approvalMode: "on-request",
      sandboxMode: "workspace-write",
      effort: "high",
    })).toEqual({
      codex: {
        yolo: false,
        approvalMode: "on-request",
        sandboxMode: "workspace-write",
        effort: "high",
      },
    });
  });

});

describe("getAgentCommandShell", () => {
  it("uses the shell that matches absolute Windows agent command syntax", () => {
    expect(getAgentCommandShell("qoder")).toBe("powershell");
    expect(getAgentCommandShell("codex")).toBe("powershell");
  });
});

describe("agent capability registry", () => {
  it("keeps unsupported and partial integrations explicit", () => {
    expect(supportsAgentCapability("antigravity", "usageTelemetry")).toBe(true);
    expect(supportsAgentCapability("qoder", "interactiveTerminal")).toBe(true);
    expect(supportsAgentCapability("qoder", "skills")).toBe(true);
    expect(supportsAgentCapability("qoder", "mcpManagement")).toBe(true);
    expect(supportsAgentCapability("qoder", "usageTelemetry")).toBe(true);
    expect(supportsAgentCapability("pi", "interactiveTerminal")).toBe(true);
    expect(supportsAgentCapability("pi", "resume")).toBe(true);
    expect(supportsAgentCapability("pi", "skills")).toBe(true);
    expect(supportsAgentCapability("pi", "statusEvents")).toBe(true);
    expect(supportsAgentCapability("pi", "usageTelemetry")).toBe(true);
    expect(supportsAgentCapability("pi", "mcpManagement")).toBe(false);
    expect(getAgentIdsWithCapability("mcpManagement")).toEqual([
      "claude",
      "codex",
      "antigravity",
      "opencode",
      "qoder",
    ]);
    expect(getAgentIdsWithCapability("statusEvents")).toContain("qoder");
  });
});

describe("agent terminal behavior registry", () => {
  it("keeps provider-specific terminal workarounds in the typed registry", () => {
    expect(getAgentTerminalBehavior("codex").forceStableCursor).toBe(true);
    expect(getAgentTerminalBehavior("qoder").forceStableCursor).toBeUndefined();
    expect(getAgentTerminalBehavior("powershell").forceStableCursor).toBeUndefined();
    expect(getAgentTerminalBehavior(undefined).forceStableCursor).toBeUndefined();
  });
});

describe("formatAgentVersion", () => {
  it("removes a redundant trailing agent name", () => {
    expect(formatAgentVersion("2.1.199 (Claude Code)", "Claude Code")).toBe("2.1.199");
    expect(formatAgentVersion("2.1.199 (claude code)", "Claude Code")).toBe("2.1.199");
  });

  it("preserves meaningful version text", () => {
    expect(formatAgentVersion("codex-cli 1.2.3", "Codex")).toBe("codex-cli 1.2.3");
    expect(formatAgentVersion(null, "Claude Code")).toBeNull();
  });
});

describe("getAgentStartupCommand", () => {
  beforeEach(() => vi.stubGlobal("navigator", { platform: "Linux x86_64" }));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps Windows Codex sessions off the shared daemon", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(getAgentStartupCommand("codex")).toBe("codex --no-daemon");
    expect(getAgentStartupCommand("codex", undefined, "019f1e67-8ab6-7b02-b0c2-275ca68979fa"))
      .toBe('codex --no-daemon resume "019f1e67-8ab6-7b02-b0c2-275ca68979fa"');
    expect(getAgentStartupCommand("codex", undefined, null, "Explain this"))
      .toBe("$__krosna_prompt=$env:KROSNA_INITIAL_PROMPT; Remove-Item Env:KROSNA_INITIAL_PROMPT; codex --no-daemon $__krosna_prompt");
    expect(getAgentStartupCommand("codex", undefined, null, null, {
      yolo: true, approvalMode: "untrusted", sandboxMode: "workspace-write", effort: "inherit",
    })).toBe("codex --no-daemon --dangerously-bypass-approvals-and-sandbox");
  });
  it("keeps Claude on the native session startup path", () => {
    expect(getAgentStartupCommand("claude")).toBeUndefined();
    expect(getAgentStartupCommand()).toBeUndefined();
  });

  it("returns the installed CLI command for other agents", () => {
    expect(getAgentStartupCommand("codex")).toBe("codex");
    expect(getAgentStartupCommand("antigravity")).toBe("agy");
    expect(getAgentStartupCommand("opencode")).toBe("opencode");
    expect(getAgentStartupCommand("qoder")).toBe("qoderclicn");
    expect(getAgentStartupCommand("pi")).toBe("pi");
  });

  it("passes quick-command prompts without reusing the Krosna session id", () => {
    expect(getAgentStartupCommand("codex", undefined, null, "/release-publish"))
      .toBe("$__krosna_prompt=$env:KROSNA_INITIAL_PROMPT; Remove-Item Env:KROSNA_INITIAL_PROMPT; codex $__krosna_prompt");
    expect(getAgentStartupCommand("antigravity", undefined, null, "/release-publish"))
      .toBe("$__krosna_prompt=$env:KROSNA_INITIAL_PROMPT; Remove-Item Env:KROSNA_INITIAL_PROMPT; agy -i $__krosna_prompt");
    expect(getAgentStartupCommand("opencode", undefined, null, "/release-publish"))
      .toBe("opencode");
    expect(getAgentStartupCommand("qoder", undefined, null, "/release-publish"))
      .toBe("$__krosna_prompt=$env:KROSNA_INITIAL_PROMPT; Remove-Item Env:KROSNA_INITIAL_PROMPT; qoderclicn --prompt-interactive $__krosna_prompt");
    expect(getAgentStartupCommand("pi", undefined, null, "/release-publish"))
      .toBe("$__krosna_prompt=$env:KROSNA_INITIAL_PROMPT; Remove-Item Env:KROSNA_INITIAL_PROMPT; pi -- $__krosna_prompt");
  });

  it("defers an OpenCode side question to the authenticated session API", () => {
    expect(
      getAgentStartupCommand(
        "opencode",
        "C:\\Users\\tester\\.local\\bin\\opencode.cmd",
        null,
        "来源会话：会话 13:31:22\n用户问题：解释这段输出",
      ),
    ).toBe(
      "opencode",
    );
  });

  it("uses codex resume when a codex session id is available", () => {
    expect(getAgentStartupCommand("codex", undefined, "019f1e67-8ab6-7b02-b0c2-275ca68979fa"))
      .toBe('codex resume "019f1e67-8ab6-7b02-b0c2-275ca68979fa"');
  });

  it("uses the codex command name when resuming despite a detected executable path", () => {
    expect(
      getAgentStartupCommand(
        "codex",
        "C:\\Users\\26424\\.local\\bin\\node-v20.14.0-win-x64\\codex.cmd",
        "019f1e67-8ab6-7b02-b0c2-275ca68979fa",
      ),
    ).toBe('codex resume "019f1e67-8ab6-7b02-b0c2-275ca68979fa"');
  });

  it("uses the native Antigravity conversation id and legacy continue fallback", () => {
    expect(
      getAgentStartupCommand(
        "antigravity",
        "C:\\Users\\tester\\.local\\bin\\agy.cmd",
        "9a8b7c6d-5e4f-3a2b-1c0d-ef1234567890",
        null,
        undefined,
        true,
      ),
    ).toBe('agy --conversation "9a8b7c6d-5e4f-3a2b-1c0d-ef1234567890"');
    expect(
      getAgentStartupCommand("antigravity", undefined, null, null, undefined, true),
    ).toBe("agy --continue");
  });

  it("uses Qoder's native resume id and continue fallback", () => {
    expect(
      getAgentStartupCommand(
        "qoder",
        "C:\\Users\\tester\\.local\\bin\\qoderclicn.cmd",
        "019f1e67-8ab6-7b02-b0c2-275ca68979fa",
        null,
        { permissionMode: "accept_edits" },
        true,
      ),
    ).toBe(
      'qoderclicn --permission-mode accept_edits --resume "019f1e67-8ab6-7b02-b0c2-275ca68979fa"',
    );
    expect(
      getAgentStartupCommand(
        "qoder",
        undefined,
        null,
        null,
        { permissionMode: "dont_ask" },
        true,
      ),
    ).toBe("qoderclicn --permission-mode dont_ask --continue");
    expect(
      getAgentStartupCommand(
        "qoder",
        undefined,
        null,
        null,
        { permissionMode: "plan" },
      ),
    ).toBe("qoderclicn --permission-mode plan");
  });

  it("opens the same OpenCode session when returning from chat", () => {
    expect(getAgentStartupCommand("opencode", undefined, "ses_123"))
      .toBe('opencode --session "ses_123"');
  });

  it("uses Pi's exact session id and continue fallback", () => {
    expect(
      getAgentStartupCommand(
        "pi",
        "C:\\Users\\tester\\AppData\\Roaming\\npm\\pi.cmd",
        "019f1e67-8ab6-7b02-b0c2-275ca68979fa",
        null,
        undefined,
        true,
      ),
    ).toBe('pi --session-id "019f1e67-8ab6-7b02-b0c2-275ca68979fa"');
    expect(
      getAgentStartupCommand("pi", undefined, null, null, undefined, true),
    ).toBe("pi --continue");
    expect(
      getAgentStartupCommand(
        "pi",
        undefined,
        "019f1e67-8ab6-7b02-b0c2-275ca68979fa",
        "first\nsecond; echo unsafe",
      ),
    ).toBe(
      '$__krosna_prompt=$env:KROSNA_INITIAL_PROMPT; Remove-Item Env:KROSNA_INITIAL_PROMPT; pi --session-id "019f1e67-8ab6-7b02-b0c2-275ca68979fa" -- $__krosna_prompt',
    );
  });

  it("maps Antigravity-specific permission, sandbox, and execution mode flags", () => {
    expect(
      getAgentStartupCommand("antigravity", undefined, null, "Review the diff", {
        dangerouslySkipPermissions: true,
        sandbox: true,
        mode: "plan",
      }),
    ).toBe(
      "$__krosna_prompt=$env:KROSNA_INITIAL_PROMPT; Remove-Item Env:KROSNA_INITIAL_PROMPT; agy --dangerously-skip-permissions --sandbox --mode plan -i $__krosna_prompt",
    );
  });

  it("uses registered command names even when executable wrappers are detected", () => {
    expect(
      getAgentStartupCommand(
        "codex",
        "C:\\Users\\26424\\.local\\bin\\node-v20.14.0-win-x64\\codex.cmd",
      ),
    ).toBe("codex");
    expect(getAgentStartupCommand("opencode", "/opt/open code/opencode"))
      .toBe("opencode");
    expect(
      getAgentStartupCommand(
        "qoder",
        "C:\\Users\\tester\\.local\\bin\\qoderclicn.cmd",
      ),
    ).toBe("qoderclicn");
  });

  it("uses registered command names instead of PowerShell-only wrappers", () => {
    expect(
      getAgentStartupCommand(
        "qoder",
        "C:\\Users\\tester\\.local\\bin\\qoderclicn.ps1",
      ),
    ).toBe(
      "qoderclicn",
    );
    expect(
      getAgentStartupCommand(
        "codex",
        "C:\\Users\\tester\\.local\\bin\\codex.ps1",
      ),
    ).toBe("codex");
  });

  it("appends codex options correctly", () => {
    expect(
      getAgentStartupCommand("codex", undefined, null, null, {
        yolo: false,
        approvalMode: "never",
        sandboxMode: "read-only",
        effort: "high",
      })
    ).toBe("codex --ask-for-approval never --sandbox read-only -c model_reasoning_effort=high");

    expect(
      getAgentStartupCommand("codex", undefined, null, null, {
        yolo: true,
        approvalMode: "never",
        sandboxMode: "read-only",
        effort: "inherit",
      })
    ).toBe("codex --dangerously-bypass-approvals-and-sandbox");
  });

  it("keeps a side-question prompt inside the codex read-only launch", () => {
    expect(
      getAgentStartupCommand("codex", undefined, null, "Explain 'this' output", {
        yolo: false,
        approvalMode: "never",
        sandboxMode: "read-only",
        effort: "inherit",
      }),
    ).toBe("$__krosna_prompt=$env:KROSNA_INITIAL_PROMPT; Remove-Item Env:KROSNA_INITIAL_PROMPT; codex --ask-for-approval never --sandbox read-only $__krosna_prompt");
  });

  it("never embeds multiline prompt text in the PowerShell command", () => {
    const command = getAgentStartupCommand("codex", undefined, null, "first\nsecond; echo unsafe");
    expect(command).not.toContain("first");
    expect(command).not.toContain("\n");
    expect(command).toContain("$env:KROSNA_INITIAL_PROMPT");
  });
});

describe("prepareAgentInitialPrompt", () => {
  it("preserves OpenCode multiline prompts for the JSON session API", () => {
    const prompt = "来源会话：Build\n工作目录：D:\\repo\n用户问题：\n为什么失败？";
    expect(prepareAgentInitialPrompt("opencode", prompt)).toBe(prompt);
  });

  it("encodes multiline Codex prompts into one physical argument", () => {
    expect(
      prepareAgentInitialPrompt(
        "codex",
        "来源会话：Build\r\n工作目录：D:\\repo\n用户问题：\n为什么失败？",
      ),
    ).toBe("来源会话：Build\\n工作目录：D:\\\\repo\\n用户问题：\\n为什么失败？");
  });

  it("keeps single-line Codex prompts and other agents unchanged", () => {
    expect(prepareAgentInitialPrompt("codex", "Explain this output")).toBe(
      "Explain this output",
    );
    expect(prepareAgentInitialPrompt("claude", "first\nsecond")).toBe(
      "first\nsecond",
    );
  });

  it("omits empty prompts", () => {
    expect(prepareAgentInitialPrompt("codex", "  ")).toBeUndefined();
    expect(prepareAgentInitialPrompt("codex", null)).toBeUndefined();
  });
});

describe("launch preferences and command previews", () => {
  it.each([
    ["claude", undefined, "claude"],
    ["claude", { skipPermissions: true, effort: "max" }, "claude --dangerously-skip-permissions --effort max"],
    ["codex", undefined, "codex"],
    ["codex", { yolo: true, effort: "inherit" }, "codex --dangerously-bypass-approvals-and-sandbox"],
    ["codex", { yolo: true, effort: "high", approvalMode: "never", sandboxMode: "read-only" }, "codex --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort=high"],
    ["codex", { yolo: false, approvalMode: "never", sandboxMode: "read-only", effort: "low" }, "codex --ask-for-approval never --sandbox read-only -c model_reasoning_effort=low"],
    ["codex", { yolo: false, approvalMode: "on-request", sandboxMode: "workspace-write", effort: "inherit" }, "codex"],
    ["antigravity", { dangerouslySkipPermissions: true, sandbox: true, mode: "plan" }, "agy --dangerously-skip-permissions --sandbox --mode plan"],
    ["antigravity", { dangerouslySkipPermissions: false, sandbox: false, mode: "inherit" }, "agy"],
    ["qoder", { permissionMode: "plan" }, "qoderclicn --permission-mode plan"],
    ["qoder", { permissionMode: "inherit" }, "qoderclicn"],
    ["opencode", undefined, "opencode"],
    ["pi", undefined, "pi"],
  ])("previews %s options %j", (agent, options, expected) => {
    expect(getAgentCommandPreview(agent as import("@/types").AiAgentId, options as import("@/types").SessionLaunchOptions | undefined)).toBe(expected);
  });
  it("switches all permissions atomically without losing effort, mode or sandbox", () => {
    const defaults: import("@/types").AgentPermissionDefaults = {
      claude: { skipPermissions: false, effort: "max" },
      codex: { yolo: false, approvalMode: "never", sandboxMode: "read-only", effort: "high" },
      antigravity: { dangerouslySkipPermissions: false, sandbox: true, mode: "plan" },
      qoder: { permissionMode: "plan" },
    };
    const yolo = applyGlobalPermissionPreset(defaults, "yolo");
    expect(getGlobalPermissionPreset(yolo)).toBe("yolo");
    for (const id of ["claude", "codex", "antigravity", "qoder"] as const) expect(isAgentYoloEnabled(id, yolo)).toBe(true);
    expect(yolo.codex).toEqual({ ...defaults.codex, yolo: true });
    expect(yolo.claude?.effort).toBe("max");
    const manual = applyGlobalPermissionPreset(yolo, "manual");
    expect(getGlobalPermissionPreset(manual)).toBe("manual");
    expect(manual.codex).toEqual(defaults.codex);
    expect(manual.antigravity).toEqual(defaults.antigravity);
    expect(manual.qoder?.permissionMode).toBe("inherit");
    expect(defaults.qoder?.permissionMode).toBe("plan");
    expect(applyGlobalPermissionPreset(defaults, "manual").qoder?.permissionMode).toBe("plan");
    expect(getGlobalPermissionPreset({ claude: { skipPermissions: true } })).toBe("custom");
    expect(getGlobalPermissionPreset({ claude: { skipPermissions: true } }, ["claude", "pi"])).toBe("yolo");
    expect(getGlobalPermissionPreset({}, ["pi", "opencode"])).toBe("manual");
    expect(getGlobalPermissionPreset({}, [])).toBe("manual");
  });
  it("reads persisted effort and retains it when saving defaults", () => {
    expect(getDefaultAgentLaunchOptions("claude", { claude: { skipPermissions: true, effort: "xhigh" } })).toEqual({ skipPermissions: true, effort: "xhigh" });
    expect(getDefaultAgentLaunchOptions("codex", { codex: { yolo: true, approvalMode: "on-request", sandboxMode: "workspace-write", effort: "high" } })).toMatchObject({ effort: "high" });
    expect(getPermissionDefaultsForLaunch("claude", { skipPermissions: true, effort: "max" }).claude?.effort).toBe("max");
  });
});
