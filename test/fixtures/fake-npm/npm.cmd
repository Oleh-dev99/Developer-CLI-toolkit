@echo off
rem The fake npm for the tests on Windows; see the file npm next to this one.
echo fake npm %*
>fake-npm.txt echo %*
>package-lock.json echo { "fake": true }
if defined FAKE_NPM_EXIT_CODE (
  1>&2 echo fake npm failed
  exit /b %FAKE_NPM_EXIT_CODE%
)
exit /b 0
