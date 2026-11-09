; Krosna NSIS installer hooks.
; Register classic Explorer verbs for the current user only. HKCU\Software\Classes
; is merged into HKCR by Explorer without requiring administrator privileges.

!define KROSNA_FOLDER_MENU_KEY "Software\Classes\Directory\shell\Krosna.OpenFolder"
!define KROSNA_FOLDER_COMMAND_KEY "${KROSNA_FOLDER_MENU_KEY}\command"
!define KROSNA_BACKGROUND_MENU_KEY "Software\Classes\Directory\Background\shell\Krosna.OpenFolder"
!define KROSNA_BACKGROUND_COMMAND_KEY "${KROSNA_BACKGROUND_MENU_KEY}\command"
!define KROSNA_PREFERENCES_KEY "Software\Krosna"
!define KROSNA_CONTEXT_MENU_ENABLED_VALUE "ExplorerContextMenuEnabled"
!define KROSNA_OWNER_VALUE_NAME "KrosnaOwner"
!define KROSNA_OWNER_MARKER "com.krosna.desktop"

; Compatibility inputs for the product rename. New installs write Krosna keys.
!define LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Termflow"

!macro NSIS_HOOK_PREINSTALL
  ; Preserve the old Explorer opt-out before uninstalling the previous product.
  ReadRegStr $0 HKCU "${KROSNA_PREFERENCES_KEY}" "${KROSNA_CONTEXT_MENU_ENABLED_VALUE}"
  ${If} $0 == ""
    ReadRegStr $1 HKCU "Software\Termflow" "ExplorerContextMenuEnabled"
    ${If} $1 != ""
      WriteRegStr HKCU "${KROSNA_PREFERENCES_KEY}" "${KROSNA_CONTEXT_MENU_ENABLED_VALUE}" "$1"
    ${EndIf}
  ${EndIf}

  ; Use the old uninstaller to retire the old executable, shortcuts and verbs.
  ; App data is intentionally preserved for the first Krosna launch to migrate.
  ReadRegStr $0 HKCU "${LEGACY_UNINSTALL_KEY}" "InstallLocation"
  ReadRegStr $1 HKCU "${LEGACY_UNINSTALL_KEY}" "MainBinaryName"
  ReadRegStr $2 HKCU "${LEGACY_UNINSTALL_KEY}" "DisplayName"
  ${If} $2 == "Termflow"
  ${AndIf} $1 == "termflow.exe"
  ${AndIf} $0 != ""
    StrCpy $2 $0 1
    ${If} $2 == '$\"'
      StrCpy $0 $0 -1 1
    ${EndIf}
    ${If} ${FileExists} "$0\uninstall.exe"
      ClearErrors
      ExecWait '$\"$0\uninstall.exe$\" /S _?=$0' $2
      ${If} ${Errors}
        Abort "Unable to migrate the previous installation. Close it and retry."
      ${EndIf}
      ${If} $2 != 0
        Abort "The previous installation could not be uninstalled. User data was preserved."
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; Newer verbs carry a stable owner marker, which lets an upgrade or uninstall
; clean an entry created at an older executable path. For legacy marker-less
; entries, retain the exact current-install command check as a safe fallback.
!macro KROSNA_REMOVE_OWNED_CONTEXT_MENUS
  ReadRegStr $0 HKCU "${KROSNA_FOLDER_MENU_KEY}" "${KROSNA_OWNER_VALUE_NAME}"
  ${If} $0 == "${KROSNA_OWNER_MARKER}"
    DeleteRegKey HKCU "${KROSNA_FOLDER_MENU_KEY}"
  ${ElseIf} $0 == ""
    ReadRegStr $0 HKCU "${KROSNA_FOLDER_COMMAND_KEY}" ""
    ${If} $0 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey HKCU "${KROSNA_FOLDER_MENU_KEY}"
    ${EndIf}
  ${EndIf}

  ReadRegStr $0 HKCU "${KROSNA_BACKGROUND_MENU_KEY}" "${KROSNA_OWNER_VALUE_NAME}"
  ${If} $0 == "${KROSNA_OWNER_MARKER}"
    DeleteRegKey HKCU "${KROSNA_BACKGROUND_MENU_KEY}"
  ${ElseIf} $0 == ""
    ReadRegStr $0 HKCU "${KROSNA_BACKGROUND_COMMAND_KEY}" ""
    ${If} $0 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%V$\""
      DeleteRegKey HKCU "${KROSNA_BACKGROUND_MENU_KEY}"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Settings writes this sentinel before changing the verbs. Respect a prior
  ; opt-out even when an update/reinstall finishes before Krosna starts.
  ReadRegStr $0 HKCU "${KROSNA_PREFERENCES_KEY}" "${KROSNA_CONTEXT_MENU_ENABLED_VALUE}"
  ${If} $0 == "0"
    ; Clean entries we can prove Krosna owns, but never claim a foreign verb.
    !insertmacro KROSNA_REMOVE_OWNED_CONTEXT_MENUS
  ${Else}
    ; The selected folder uses %1. The background verb uses %V, which resolves
    ; to the folder whose empty area the user clicked.
    WriteRegStr HKCU "${KROSNA_FOLDER_MENU_KEY}" "" "Open with Krosna"
    WriteRegStr HKCU "${KROSNA_FOLDER_MENU_KEY}" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr HKCU "${KROSNA_FOLDER_MENU_KEY}" "${KROSNA_OWNER_VALUE_NAME}" "${KROSNA_OWNER_MARKER}"
    WriteRegStr HKCU "${KROSNA_FOLDER_COMMAND_KEY}" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

    WriteRegStr HKCU "${KROSNA_BACKGROUND_MENU_KEY}" "" "Open with Krosna"
    WriteRegStr HKCU "${KROSNA_BACKGROUND_MENU_KEY}" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr HKCU "${KROSNA_BACKGROUND_MENU_KEY}" "${KROSNA_OWNER_VALUE_NAME}" "${KROSNA_OWNER_MARKER}"
    WriteRegStr HKCU "${KROSNA_BACKGROUND_COMMAND_KEY}" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%V$\""

    ; First-time installs default to enabled; keep an existing "1" unchanged.
    WriteRegStr HKCU "${KROSNA_PREFERENCES_KEY}" "${KROSNA_CONTEXT_MENU_ENABLED_VALUE}" "1"
  ${EndIf}

  ; Tell Explorer to refresh its class association cache without requiring a
  ; restart. SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro KROSNA_REMOVE_OWNED_CONTEXT_MENUS

  ; Keep the per-user sentinel. Tauri's update path runs this uninstaller with
  ; /UPDATE, and retaining the opt-out also makes a later reinstall honour it.

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
