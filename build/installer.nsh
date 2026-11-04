; Zero Launcher installer extras (electron-builder includes this file).
; On uninstall: ask "Also remove installed games?" - the default answer is NO (keep them).
; Never asks during an update or a silent uninstall (then games are always kept).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfSilent zl_keep_games
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove installed games?$\r$\n$\r$\nNo = keep them (recommended). If you install Zero Launcher again, you can play right away." /SD IDNO IDNO zl_keep_games
      ; Only the launcher's own game folder. Games moved to another folder are not touched.
      RMDir /r "$APPDATA\Zero Launcher\library\games"
      RMDir /r "$APPDATA\Zero Launcher\library\downloads"
      Delete "$APPDATA\Zero Launcher\library\installed.json"
    zl_keep_games:
  ${endIf}
!macroend
