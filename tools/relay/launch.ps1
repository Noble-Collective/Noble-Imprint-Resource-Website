# Opens a new Git Bash window that runs run-next.sh (called by next-phase.sh).
# Absolute paths only: Git Bash's login shell starts in $HOME, not --cd.
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runNext = '/' + ($repo -replace '^([A-Za-z]):', '$1').Replace('\', '/') + '/tools/relay/run-next.sh'
$runNext = $runNext.Substring(0, 2).ToLower() + $runNext.Substring(2)
Start-Process -FilePath 'C:\Program Files\Git\git-bash.exe' `
  -ArgumentList "--cd=`"$repo`" -c `"bash '$runNext'`""
