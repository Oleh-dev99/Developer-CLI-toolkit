@echo off
rem The fake npm for the tests on Windows; see the file npm next to this one.
if "%~1"=="outdated" goto doctor
if "%~1"=="audit" goto doctor
echo fake npm %*
>fake-npm.txt echo %*
>package-lock.json echo { "fake": true }
if defined FAKE_NPM_EXIT_CODE (
  1>&2 echo fake npm failed
  exit /b %FAKE_NPM_EXIT_CODE%
)
exit /b 0

:doctor
set "FAKE_NPM_RUN=node"
if defined FAKE_NPM_NODE set "FAKE_NPM_RUN=%FAKE_NPM_NODE%"
"%FAKE_NPM_RUN%" "%~dp0doctor-npm.mjs" %*
exit /b %ERRORLEVEL%
