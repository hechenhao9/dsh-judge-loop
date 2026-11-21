@echo off
rem dsh-judge-loop gate wrapper. ASCII only (non-ASCII breaks %~dp0 on GBK consoles).
setlocal
set "SELF=%~dp0"
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE if exist "%ProgramFiles%\HONOR\MagicClaw\PresetEnv\node-v24.14.1-win-x64\node.exe" set "NODE=%ProgramFiles%\HONOR\MagicClaw\PresetEnv\node-v24.14.1-win-x64\node.exe"
if not defined NODE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE (
  echo node not found. Install Node 22+ or run gate.cjs with a full node path.
  exit /b 90
)
"%NODE%" "%SELF%gate.cjs" %*
exit /b %ERRORLEVEL%
