; Per-user install. Generated payload lists contain only verified literal paths.
Unicode true
RequestExecutionLevel user
SetCompressor /SOLID zlib
SetDatablockOptimize on
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "metadata.nsh"
Name "${APP_NAME}"
OutFile "${INSTALLER_OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
BrandingText "Workspace Observatory"
ShowInstDetails show
ShowUninstDetails show
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${APP_LICENSE}"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Var SetupMutex

; Refuse linked directories, including ancestors. This does not attempt to
; defend against an adversary concurrently changing this user's own filesystem.
!macro SafetyFunctions PREFIX
Function ${PREFIX}NoLinkedPath
  Exch $0
  Push $1
  Push $2
  linked_loop:
    System::Call 'kernel32::GetFileAttributesW(w r0) i .r1'
    IntCmp $1 -1 linked_parent
    IntOp $2 $1 & 0x400
    IntCmp $2 0 linked_parent
      MessageBox MB_OK|MB_ICONSTOP "Linked install directories are not supported. No linked directory will be removed." /SD IDOK
      SetErrorLevel 12
      Quit
    linked_parent:
    ${GetParent} "$0" $1
    StrCmp $1 "" linked_done
    StrCmp $1 $0 linked_done
    StrCpy $0 $1
    Goto linked_loop
  linked_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function ${PREFIX}CheckRunning
  System::Call 'kernel32::OpenMutexW(i 0x100000, i 0, w "Local\WorkspaceObservatory") p .r0'
  IntPtrCmp $0 0 not_running
    System::Call 'kernel32::CloseHandle(p r0)'
    MessageBox MB_OK|MB_ICONSTOP "Quit Workspace Observatory from its tray menu, then try again." /SD IDOK
    SetErrorLevel 10
    Quit
  not_running:
FunctionEnd

Function ${PREFIX}AcquireSetupLock
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\${SETUP_ID}") p .r0 ?e'
  Pop $1
  IntPtrCmp $0 0 setup_busy
  IntCmp $1 183 setup_busy
  StrCpy $SetupMutex $0
  Return
  setup_busy:
    MessageBox MB_OK|MB_ICONSTOP "Another install or uninstall is running." /SD IDOK
    SetErrorLevel 11
    Quit
FunctionEnd
!macroend

!include "FileFunc.nsh"
!insertmacro SafetyFunctions ""
!insertmacro SafetyFunctions "un."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "This package requires 64-bit Windows." /SD IDOK
    SetErrorLevel 13
    Quit
  ${EndIf}
  SetRegView 64
  SetShellVarContext current
  ; Ignore /D overrides: this installer owns only its fixed per-user location.
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_NAME}"
  Call AcquireSetupLock
  Call CheckRunning
  Push "$INSTDIR"
  Call NoLinkedPath
  Push "$SMPROGRAMS\${APP_NAME}"
  Call NoLinkedPath
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .r0'
  IntCmp $0 -1 check_shortcuts existing_install existing_install
  check_shortcuts:
  System::Call 'kernel32::GetFileAttributesW(w "$SMPROGRAMS\${APP_NAME}") i .r0'
  IntCmp $0 -1 check_registration existing_install existing_install
  check_registration:
  ClearErrors
  EnumRegValue $0 HKCU "${UNINSTALL_KEY}" 0
  IfErrors registration_subkeys existing_install
  registration_subkeys:
  ClearErrors
  EnumRegKey $0 HKCU "${UNINSTALL_KEY}" 0
  IfErrors new_install existing_install
  existing_install:
    MessageBox MB_OK|MB_ICONSTOP "An install folder, shortcut folder or registration already exists. Uninstall the previous version first. Saved collection data is preserved. If unrelated files remain in an install folder, move that folder aside before reinstalling." /SD IDOK
    SetErrorLevel 14
    Quit
  new_install:
FunctionEnd

Section "Install"
  SetOverwrite off
  SetOutPath "$INSTDIR"
  IfErrors install_failed
  ClearErrors
  WriteINIStr "$INSTDIR\installer-owner.ini" "Owner" "Product" "${SETUP_ID}"
  WriteINIStr "$INSTDIR\installer-owner.ini" "Owner" "Revision" "${SOURCE_REVISION}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  IfErrors install_failed
  !include "install-files.nsh"
  IfErrors install_failed
  !ifdef UPDATE_ENVELOPE
    ; Generated from a signature-checked receipt matching this package. Runtime
    ; verification still checks its embedded key, build and installed inventory.
    Push "$LOCALAPPDATA\${UPDATE_DATA_NAME}\updates\installed-envelope.json"
    Call NoLinkedPath
    CreateDirectory "$LOCALAPPDATA\${UPDATE_DATA_NAME}\updates"
    IfErrors install_failed
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File "/oname=installed-envelope.json" "${UPDATE_ENVELOPE}"
    IfErrors install_failed
    GetTempFileName $0 "$LOCALAPPDATA\${UPDATE_DATA_NAME}\updates"
    IfErrors install_failed
    System::Call 'kernel32::CopyFileW(w "$PLUGINSDIR\installed-envelope.json", w r0, i 0) i.r2'
    IntCmp $2 0 install_failed
    System::Call 'kernel32::GetFileAttributesW(w "$LOCALAPPDATA\${UPDATE_DATA_NAME}\updates\installed-envelope.json") i.r2'
    IntCmp $2 -1 first_receipt
    IntOp $2 $2 & 0x410
    IntCmp $2 0 replace_receipt install_failed install_failed
    replace_receipt:
      GetTempFileName $1 "$LOCALAPPDATA\${UPDATE_DATA_NAME}\updates"
      IfErrors install_failed
      Delete "$1"
      IfErrors install_failed
      System::Call 'kernel32::ReplaceFileW(w "$LOCALAPPDATA\${UPDATE_DATA_NAME}\updates\installed-envelope.json", w r0, w r1, i 0, p 0, p 0) i.r2'
      IntCmp $2 0 install_failed receipt_done receipt_done
    first_receipt:
      System::Call 'kernel32::MoveFileExW(w r0, w "$LOCALAPPDATA\${UPDATE_DATA_NAME}\updates\installed-envelope.json", i 8) i.r2'
      IntCmp $2 0 install_failed
    receipt_done:
  !endif
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\WorkspaceObservatory.exe"
  IfErrors install_failed
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Workspace Observatory contributors"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\WorkspaceObservatory.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  IfErrors install_failed
  DetailPrint "Installed for the current user. Open it from the Start menu."
  DetailPrint "Login startup and source collection remain opt-in in the tray menu."
  SetErrorLevel 0
  Goto install_done
  install_failed:
    DetailPrint "Installation did not complete. Existing saved collection data was not changed."
    MessageBox MB_OK|MB_ICONSTOP "Installation did not complete. Close programs using the install folder and remove this incomplete install before trying again. Saved collection data was not changed." /SD IDOK
    SetErrorLevel 20
    Abort
  install_done:
SectionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext current
  Call un.AcquireSetupLock
  Call un.CheckRunning
  StrCpy $1 "$LOCALAPPDATA\Programs\${APP_NAME}"
  StrCmp $INSTDIR $1 0 wrong_owner
  Push "$INSTDIR"
  Call un.NoLinkedPath
  ReadINIStr $0 "$INSTDIR\installer-owner.ini" "Owner" "Product"
  StrCmp $0 "${SETUP_ID}" 0 wrong_owner
  ReadINIStr $0 "$INSTDIR\installer-owner.ini" "Owner" "Revision"
  StrCmp $0 "${SOURCE_REVISION}" 0 wrong_owner
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  StrCmp $0 "" owner_ok
  StrCmp $0 "$INSTDIR" owner_ok
  wrong_owner:
    MessageBox MB_OK|MB_ICONSTOP "This uninstaller cannot verify ownership of the install folder. Nothing was removed." /SD IDOK
    SetErrorLevel 15
    Quit
  owner_ok:
  !include "check-uninstall-paths.nsh"
  Push "$SMPROGRAMS\${APP_NAME}"
  Call un.NoLinkedPath
FunctionEnd

Section "Uninstall"
  ; Exact owned files only. Never recursively remove install or saved-data roots.
  ClearErrors
  !include "uninstall-files.nsh"
  IfErrors uninstall_failed
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  IfErrors uninstall_failed
  RMDir "$SMPROGRAMS\${APP_NAME}"
  ClearErrors
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${STARTUP_NAME}"
  ClearErrors
  StrCmp $0 '"$INSTDIR\WorkspaceObservatory.exe"' remove_startup
  StrCmp $0 '"$INSTDIR\WorkspaceObservatory.exe" --background' 0 preserve_startup
  remove_startup:
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${STARTUP_NAME}"
  preserve_startup:
  !include "remove-registration.nsh"
  IfErrors uninstall_failed
  Delete "$INSTDIR\installer-owner.ini"
  Delete "$INSTDIR\Uninstall.exe"
  IfErrors uninstall_failed
  !include "remove-empty-folders.nsh"
  SetOutPath "$TEMP"
  RMDir "$INSTDIR"
  DetailPrint "Application removed. Saved collection data and unrelated files were preserved."
  SetErrorLevel 0
  Goto uninstall_done
  uninstall_failed:
    MessageBox MB_OK|MB_ICONSTOP "Some application files could not be removed. Close programs using the install folder, then run this uninstaller again. Saved collection data was not changed." /SD IDOK
    SetErrorLevel 21
    Abort
  uninstall_done:
SectionEnd
