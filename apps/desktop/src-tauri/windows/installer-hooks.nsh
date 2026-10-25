; YouLoad installer hooks: manage the "YouLoad Bypass" service.

!macro NSIS_HOOK_PREINSTALL
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
