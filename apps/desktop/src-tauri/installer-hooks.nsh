; Removes the Electron-era Quiro (<= 1.3.0) when installing the Tauri build.
;
; That version was packaged by electron-builder into
; $LOCALAPPDATA\Programs\@quirodesktop, with its own uninstaller and its own
; Add/Remove Programs entry. As far as Windows is concerned the Tauri build is
; an unrelated product — different registry key, different uninstaller — so
; nothing would ever clear the old one and users end up with two Quiros
; installed side by side.
;
; Two deliberate choices:
;
; * This removes the directory and registry entry directly instead of shelling
;   out to the old uninstaller. electron-builder's uninstaller copies itself to
;   temp and relaunches, so ExecWait can return while it's still working — and
;   any dialog it decides to show (an "app is still running" prompt, say) would
;   block a silent auto-update forever, since the updater runs this installer
;   with /S. Deleting directly is deterministic and cannot hang.
;
; * It runs POST-install rather than pre-install. Nothing about the new install
;   depends on the old one being gone — different directory, different key — so
;   doing it afterwards means a failed install can never leave someone with
;   neither version.
;
; Everyone who never had the Electron build pays one FileExists check.

!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5

  StrCpy $R0 "$LOCALAPPDATA\Programs\@quirodesktop"

  ${If} ${FileExists} "$R0\*.*"
    DetailPrint "Removing the previous Electron-based Quiro..."
    RMDir /r "$R0"
  ${EndIf}

  ; Drop its Add/Remove Programs entry too. Left behind, it offers an uninstall
  ; that points at a binary this just deleted — which fails silently and is
  ; exactly the dead end this hook exists to clear.
  ;
  ; Matched by UninstallString prefix rather than a hardcoded key name: the key
  ; is a GUID derived from the old app id, and guessing it from one machine is
  ; not something to ship. The leading quote is part of the stored value.
  StrCpy $R1 '"$R0\'
  StrLen $R2 $R1
  StrCpy $R3 0

  quiro_legacy_enum:
    EnumRegKey $R4 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R3
    StrCmp $R4 "" quiro_legacy_done
    ReadRegStr $R5 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4" "UninstallString"
    StrCpy $R5 $R5 $R2
    ${If} $R5 == $R1
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R4"
      ; Stop at the first match. There is only ever one such entry, and
      ; re-scanning after a delete would spin forever if the delete ever
      ; failed — the same key would keep matching. An installer that hangs is
      ; far worse than a stale entry, and worst of all during a silent
      ; auto-update, where there's no window to even see it.
      Goto quiro_legacy_done
    ${EndIf}
    IntOp $R3 $R3 + 1
    Goto quiro_legacy_enum
  quiro_legacy_done:

  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
