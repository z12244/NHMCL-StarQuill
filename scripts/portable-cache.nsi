Unicode true
Name "NHMCL-StarQuill"
OutFile "${ARTIFACT}"
Icon "${ICON}"
VIProductVersion "${NUMERIC_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "NHMCL-StarQuill"
VIAddVersionKey /LANG=1033 "FileDescription" "NHMCL-StarQuill"
VIAddVersionKey /LANG=1033 "FileVersion" "${DISPLAY_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "StarQuill_z12244"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
SetCompressor zlib
SetCompress auto
CRCCheck off
!include "LogicLib.nsh"
!include "${STD_UTILS}"

Var mutex
Var slot
Var stamp
Var record
Var valid
Var transient

; On first extraction hash every file before marking the cache complete. On
; reuse check file sizes and modification times without rereading the payload.
!macro CheckFile file size digest
  ClearErrors
  FileOpen $1 "$INSTDIR\${file}" r
  IfErrors invalidCache
  FileSeek $1 0 END $2
  FileClose $1
  StrCmp $2 "${size}" 0 invalidCache
  ClearErrors
  GetFileTime "$INSTDIR\${file}" $3 $4
  IfErrors invalidCache
  ${If} $record == "yes"
    ${StdUtils.HashFile} $5 "SHA2-256" "$INSTDIR\${file}"
    StrCmp $5 "${digest}" 0 invalidCache
    FileWrite $stamp "$3:$4$\r$\n"
    IfErrors invalidCache
  ${Else}
    FileRead $stamp $5
    StrCmp $5 "$3:$4$\r$\n" 0 invalidCache
  ${EndIf}
!macroend

Function CheckCache
  StrCpy $valid 0
  ClearErrors
  ${If} $record == "yes"
    FileOpen $stamp "$INSTDIR\.building" w
  ${Else}
    FileOpen $stamp "$INSTDIR\.ready" r
  ${EndIf}
  IfErrors noStamp
  !include "${CHECK_FILES}"
  StrCpy $valid 1
  invalidCache:
  FileClose $stamp
  noStamp:
FunctionEnd

Function UnlockCache
  ${If} $mutex != 0
    System::Call 'kernel32::ReleaseMutex(p $mutex)'
    System::Call 'kernel32::CloseHandle(p $mutex)'
    StrCpy $mutex 0
  ${EndIf}
FunctionEnd

Section
  StrCpy $transient 0
  StrCpy $slot 0
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\NHMCL-StarQuill-${CACHE_ID}")p.r0'
  StrCpy $mutex $0
  StrCmp $mutex 0 privateCopy
  System::Call 'kernel32::WaitForSingleObject(p $mutex, i 45000)i.r0'
  StrCmp $0 0 chooseSlot
  StrCmp $0 128 chooseSlot
  System::Call 'kernel32::CloseHandle(p $mutex)'
  StrCpy $mutex 0
  Goto privateCopy

  chooseSlot:
  StrCpy $INSTDIR "$LOCALAPPDATA\NHMCL-StarQuill\engine\${CACHE_ID}-$slot"
  ; Never overwrite or recursively delete an existing or in-use cache. A
  ; partial/corrupt cache has no valid stamp and can be repaired in a new slot.
  IfFileExists "$INSTDIR\." checkSlot 0
  ClearErrors
  CreateDirectory "$INSTDIR"
  IfErrors privateCopy
  Goto extract
  checkSlot:
    StrCpy $record "no"
    Call CheckCache
    StrCmp $valid 1 launch
    IntOp $slot $slot + 1
    IntCmp $slot 16 privateCopy chooseSlot privateCopy

  privateCopy:
    Call UnlockCache
    InitPluginsDir
    StrCpy $transient 1
    StrCpy $INSTDIR "$PLUGINSDIR\app"
  extract:
    ClearErrors
    SetOutPath "$INSTDIR"
    IfErrors extractionFailed
    File /r "${APP_DIR}\*.*"
    IfErrors extractionFailed
    StrCpy $record "yes"
    Call CheckCache
    StrCmp $valid 1 0 extractionFailed
    ClearErrors
    Rename "$INSTDIR\.building" "$INSTDIR\.ready"
    IfErrors extractionFailed
  launch:
    Call UnlockCache
    SetOutPath "$EXEDIR"
    System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_DIR", w "$EXEDIR")'
    System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_FILE", w "$EXEPATH")'
    System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_APP_FILENAME", w "NHMCL-StarQuill")'
    ${StdUtils.GetAllParameters} $R0 0
    ClearErrors
    ExecWait '"$INSTDIR\NHMCL-StarQuill.exe" $R0' $0
    IfErrors launchFailed
    SetErrorLevel $0
    Goto done
  extractionFailed:
    StrCmp $transient 0 privateCopy
  launchFailed:
    Call UnlockCache
    MessageBox MB_OK|MB_ICONSTOP "NHMCL-StarQuill 无法读取或展开启动文件。请检查剩余磁盘空间，或重新下载启动器。"
    SetErrorLevel 1
  done:
SectionEnd
