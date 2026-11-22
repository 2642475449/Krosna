use crate::runtime_output::TerminalKind;

pub const POWERSHELL_COMPLETION_INTEGRATION_ENV: &str = "KROSNA_POWERSHELL_COMPLETION_INTEGRATION";

pub const POWERSHELL_COMPLETION_INTEGRATION_COMMAND: &str =
    "if ($env:KROSNA_POWERSHELL_COMPLETION_INTEGRATION) { . ([scriptblock]::Create($env:KROSNA_POWERSHELL_COMPLETION_INTEGRATION)) }";

// -Command suppresses the native banner even without -NoLogo. Use the running
// engine's version and ConsoleHost's localized copyright when available.
const POWERSHELL_STARTUP_BANNER: &str = r#"
& {
  $edition = if ($PSVersionTable.PSEdition -eq 'Core') { 'PowerShell' } else { 'Windows PowerShell' }
  $Host.UI.WriteLine("$edition $($PSVersionTable.PSVersion)")
  try {
    $resources = [Resources.ResourceManager]::new('ManagedEntranceStrings', [Microsoft.PowerShell.ConsoleShell].Assembly)
    $copyright = ($resources.GetString('ShellBanner') -split '\r?\n', 3)[1]
  } catch { $copyright = $null }
  if (-not $copyright) {
    $copyright = [Diagnostics.FileVersionInfo]::GetVersionInfo([psobject].Assembly.Location).LegalCopyright
  }
  $Host.UI.WriteLine($copyright)
  $Host.UI.WriteLine()
}
"#;

pub fn powershell_integration_script(kind: Option<&TerminalKind>) -> String {
    match kind {
        None | Some(TerminalKind::Terminal) => {
            format!("{POWERSHELL_STARTUP_BANNER}{POWERSHELL_COMPLETION_INTEGRATION_SCRIPT}")
        }
        Some(_) => POWERSHELL_COMPLETION_INTEGRATION_SCRIPT.to_owned(),
    }
}

/// Loaded only for Krosna's native PowerShell terminal sessions. The script
/// emits OSC 133 lifecycle markers while preserving the user's existing prompt
/// script block and profile. PSReadLine owns the editable input line, so it is
/// the only reliable point at which to emit the command-start marker.
pub const POWERSHELL_COMPLETION_INTEGRATION_SCRIPT: &str = r#"
if (-not $global:__krosnaCompletionIntegrationLoaded) {
  $global:__krosnaCompletionIntegrationLoaded = $true
  $global:__krosnaCompletionEsc = [char]27
  $global:__krosnaCompletionBel = [char]7
  $global:__krosnaCompletionRunning = $false
  $global:__krosnaCompletionCanTrackCommands = $false
  $global:__krosnaLastExitCodeBeforeCommand = $null
  $global:__krosnaOriginalPrompt = (Get-Command prompt -CommandType Function -ErrorAction SilentlyContinue).ScriptBlock

  function global:Write-KrosnaCompletionMarker([string]$Marker) {
    [Console]::Out.Write("$global:__krosnaCompletionEsc]133;$Marker$global:__krosnaCompletionBel")
  }

  function global:prompt {
    $krosnaSucceeded = $?
    $krosnaLastExitCode = $global:LASTEXITCODE
    if ($global:__krosnaCompletionRunning) {
      $global:__krosnaCompletionRunning = $false
      $krosnaExitCode = if ($krosnaSucceeded) {
        0
      } elseif (
        $krosnaLastExitCode -is [int] -and
        $krosnaLastExitCode -ne $global:__krosnaLastExitCodeBeforeCommand
      ) {
        $krosnaLastExitCode
      } else {
        ""
      }
      Write-KrosnaCompletionMarker "D;$krosnaExitCode"
    }

    $krosnaCommandLifecycle = if ($global:__krosnaCompletionCanTrackCommands) { "enabled" } else { "disabled" }
    Write-KrosnaCompletionMarker "A;krosna=1;command-lifecycle=$krosnaCommandLifecycle"
    if ($null -ne $global:__krosnaOriginalPrompt) {
      & $global:__krosnaOriginalPrompt
    } else {
      "PS $($executionContext.SessionState.Path.CurrentLocation)> "
    }
    Write-KrosnaCompletionMarker "B"
  }

  try {
    if (Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue) {
      $krosnaEnterHandler = Get-PSReadLineKeyHandler -Bound |
        Where-Object { $_.Key -eq "Enter" } |
        Select-Object -First 1
      if ($null -eq $krosnaEnterHandler -or $krosnaEnterHandler.Function -eq "AcceptLine") {
        Set-PSReadLineKeyHandler -Key Enter -BriefDescription "KrosnaAcceptLine" -ScriptBlock {
          [string]$krosnaLine = ""
          [int]$krosnaCursor = 0
          [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$krosnaLine, [ref]$krosnaCursor)
          if (-not [string]::IsNullOrWhiteSpace($krosnaLine)) {
            $global:__krosnaLastExitCodeBeforeCommand = $global:LASTEXITCODE
            Write-KrosnaCompletionMarker "C"
            $global:__krosnaCompletionRunning = $true
          }
          [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
        }
        $global:__krosnaCompletionCanTrackCommands = $true
      }
    }
  } catch {
    # Without PSReadLine no reliable command-start hook is available. Prompt
    # markers still identify the integration, while the frontend declines to
    # infer a completion without a matching C marker.
  }
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn startup_banner_uses_the_running_powershell_version_only_for_terminal_sessions() {
        let terminal = powershell_integration_script(Some(&TerminalKind::Terminal));
        assert_eq!(powershell_integration_script(None), terminal);
        for kind in [TerminalKind::Runner, TerminalKind::Agent] {
            assert_eq!(
                powershell_integration_script(Some(&kind)),
                POWERSHELL_COMPLETION_INTEGRATION_SCRIPT
            );
        }

        let command = format!(
            "{POWERSHELL_COMPLETION_INTEGRATION_COMMAND}; Write-Output $PSVersionTable.PSVersion.ToString()"
        );
        let output = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NoLogo",
                "-NonInteractive",
                "-Command",
                &command,
            ])
            .env(POWERSHELL_COMPLETION_INTEGRATION_ENV, terminal)
            .output()
            .unwrap();
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<_> = stdout.lines().filter(|line| !line.is_empty()).collect();
        assert_eq!(lines.len(), 3, "{stdout}");
        assert_eq!(lines[0], format!("Windows PowerShell {}", lines[2]));
        assert!(lines[1].contains("Microsoft"), "{stdout}");
    }

    #[test]
    fn integration_preserves_the_prompt_and_emits_explicit_lifecycle_markers() {
        assert!(POWERSHELL_COMPLETION_INTEGRATION_SCRIPT.contains("__krosnaOriginalPrompt"));
        assert!(POWERSHELL_COMPLETION_INTEGRATION_SCRIPT.contains("\"C\""));
        assert!(POWERSHELL_COMPLETION_INTEGRATION_SCRIPT.contains("\"D;$krosnaExitCode\""));
        assert!(POWERSHELL_COMPLETION_INTEGRATION_SCRIPT.contains("Set-PSReadLineKeyHandler"));
        assert!(POWERSHELL_COMPLETION_INTEGRATION_SCRIPT.contains("$krosnaSucceeded = $?"));
        assert!(
            POWERSHELL_COMPLETION_INTEGRATION_SCRIPT.contains("$global:__krosnaCompletionRunning")
        );
        assert!(POWERSHELL_COMPLETION_INTEGRATION_SCRIPT
            .contains("command-lifecycle=$krosnaCommandLifecycle"));
        assert!(POWERSHELL_COMPLETION_INTEGRATION_SCRIPT
            .contains("$krosnaEnterHandler.Function -eq \"AcceptLine\""));
        assert!(
            POWERSHELL_COMPLETION_INTEGRATION_SCRIPT.contains("__krosnaLastExitCodeBeforeCommand")
        );
    }
}
