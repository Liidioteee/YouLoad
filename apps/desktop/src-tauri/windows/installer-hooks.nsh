; YouLoad installer hooks: manage the "YouLoad Bypass" service and clean up 0.1.0.

!macro NSIS_HOOK_PREINSTALL
  ; YouLoad 0.1.0 was installed per user into %LOCALAPPDATA%. Its shortcuts would keep
  ; opening the old copy, so remove it silently. Settings and history are separate and stay.
  ReadRegStr $R9 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\YouLoad" "UninstallString"
  StrCmp $R9 "" youload_no_old
    DetailPrint "Removing YouLoad 0.1.0 installed for the current user"
    ExecWait '$R9 /S'
    ; The NSIS uninstaller re-launches itself from %TEMP%; give it time to finish.
    Sleep 3000
  youload_no_old:

  ; Stop the running service so its executable can be replaced on update.
  nsExec::Exec 'sc.exe stop YouLoadBypass'
  Sleep 1500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Register and start the service (replaces an older registration).
  nsExec::ExecToLog '"$INSTDIR\${MAINBINARYNAME}.exe" --install-service'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-service'
!macroend
