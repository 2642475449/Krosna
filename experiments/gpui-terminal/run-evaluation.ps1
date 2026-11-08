param(
    [int]$Iterations = 2,
    [int]$Duration = 8,
    [int[]]$SessionCounts = @(1, 4),
    [int[]]$Rates = @(131072, 524288),
    [string]$ResultSet = 'results'
)
$ErrorActionPreference = 'Stop'
$evaluationRoot = $PSScriptRoot
$resultsDir = Join-Path $evaluationRoot $ResultSet
New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null
$machine = [ordered]@{
    recordedAt = (Get-Date).ToString('o')
    os = @(Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, TotalVisibleMemorySize)
    cpu = @(Get-CimInstance Win32_Processor | Select-Object Name, NumberOfLogicalProcessors)
    gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion)
    rust = (& rustc --version)
    sampleIntervalMs = 500
    memoryDefinition = 'Sum of sampled process-tree private bytes; includes workload children, excludes short-lived unsampled processes; not working set'
    cpuDefinition = 'Sum of maximum sampled lifetime CPU seconds per observed process; includes workload children; not normalized CPU percent'
}
$machine | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $resultsDir 'machine.json') -Encoding utf8
$summaries = @()
foreach ($iteration in 1..$Iterations) {
    foreach ($sessions in $SessionCounts) {
        foreach ($rate in $Rates) {
            # Alternate engine order between repetitions to reduce order bias.
            $engines = if ($iteration % 2 -eq 1) { @('gpui', 'webview') } else { @('webview', 'gpui') }
            foreach ($engine in $engines) {
                $name = "$engine-s$sessions-r$rate-i$iteration"
                $report = Join-Path $resultsDir "$name.json"
                $exe = Join-Path $evaluationRoot "target/release/$engine-terminal-eval.exe"
                if (-not (Test-Path -LiteralPath $exe)) { throw "Missing binary: $exe" }
                $arguments = @('--sessions', "$sessions", '--duration', "$Duration", '--rate', "$rate", '--output', (Join-Path $ResultSet "$name.json"))
                # This is the visible application under measurement: hiding the
                # window would change frame scheduling and invalidate UI metrics.
                $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $evaluationRoot -PassThru -WindowStyle Normal -RedirectStandardError (Join-Path $resultsDir "$name.stderr.log") -RedirectStandardOutput (Join-Path $resultsDir "$name.stdout.log")
                $rootProcessId = $process.Id
                # Retain a process handle so ExitCode remains available after exit.
                $null = $process.Handle
                $seen = @{}
                $samples = @()
                $timer = [Diagnostics.Stopwatch]::StartNew()
                $timedOut = $false
                while (-not $process.HasExited) {
                    $all = @(Get-CimInstance Win32_Process)
                    $ids = [Collections.Generic.HashSet[int]]::new()
                    [void]$ids.Add($rootProcessId)
                    do {
                        $added = $false
                        foreach ($item in $all) {
                            if ($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $added = $true }
                        }
                    } while ($added)
                    $privateBytes = 0L
                    foreach ($item in $all) {
                        if ($ids.Contains([int]$item.ProcessId)) {
                            $key = "$($item.ProcessId):$($item.CreationDate)"
                            $cpu = ([double]$item.KernelModeTime + [double]$item.UserModeTime) / 10000000
                            if (-not $seen.ContainsKey($key) -or $seen[$key] -lt $cpu) { $seen[$key] = $cpu }
                            $privateBytes += [long]$item.PrivatePageCount
                        }
                    }
                    $samples += [pscustomobject]@{ seconds = $timer.Elapsed.TotalSeconds; privateMiB = $privateBytes / 1MB; processCount = $ids.Count }
                    if ($timer.Elapsed.TotalSeconds -gt ($Duration + 25)) {
                        $timedOut = $true
                        # Only terminate the process tree launched for this case.
                        foreach ($item in $all) {
                            if ($ids.Contains([int]$item.ProcessId)) { Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue }
                        }
                        break
                    }
                    Start-Sleep -Milliseconds 500
                    $process.Refresh()
                }
                $process.WaitForExit()
                $timer.Stop()
                $record = [ordered]@{
                    case = $name; engine = $engine; sessions = $sessions; rate = $rate; iteration = $iteration
                    durationSeconds = $timer.Elapsed.TotalSeconds; exitCode = $process.ExitCode; timedOut = $timedOut
                    peakPrivateMiB = ($samples | Measure-Object privateMiB -Maximum).Maximum
                    observedCpuSeconds = ($seen.Values | Measure-Object -Sum).Sum
                    samples = $samples; reportExists = (Test-Path -LiteralPath $report)
                }
                $record | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $resultsDir "$name.process.json") -Encoding utf8
                $summaries += [pscustomobject]$record
                Write-Output "$name exit=$($process.ExitCode) report=$($record.reportExists) peakPrivateMiB=$([math]::Round($record.peakPrivateMiB, 1))"
            }
        }
    }
}
$summaries | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $resultsDir 'process-summary.json') -Encoding utf8
