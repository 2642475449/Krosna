<#
.SYNOPSIS
只读采样指定应用进程树的内存，写入新的 CSV 文件。
.EXAMPLE
pwsh -NoProfile -File scripts/diagnose-webview-memory.ps1 -ParentProcessId 1234 -DurationSeconds 60 -IntervalMilliseconds 1000 -OutputPath C:/Temp/krosna-memory.csv
.NOTES
不读取进程命令行、网页内容或凭据，不结束进程，也不修改应用配置。
CSV 包含 PID、父 PID、进程名、启动时间、Working Set、Private Bytes 和系统提交量。
输出文件必须不存在；脚本不会覆盖已有诊断文件。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [Alias('ParentPid')]
    [ValidateRange(1, 2147483647)]
    [int]$ParentProcessId,

    [ValidateRange(1, 86400)]
    [int]$DurationSeconds = 60,

    [ValidateRange(100, 60000)]
    [int]$IntervalMilliseconds = 1000,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'This diagnostic script requires Windows.'
}

$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if (-not [System.IO.Directory]::Exists([System.IO.Path]::GetDirectoryName($resolvedOutputPath))) {
    throw 'The output directory must already exist.'
}
if ([System.IO.File]::Exists($resolvedOutputPath)) {
    throw 'The output file already exists; choose a new CSV path.'
}

$rootProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ParentProcessId" `
    -Property ProcessId, ParentProcessId, Name, CreationDate
if (-not $rootProcess) {
    throw "Parent process $ParentProcessId was not found."
}
$rootCreationTime = $rootProcess.CreationDate.ToUniversalTime()

# GetPerformanceInfo 直接读取系统计数器，避免启动性能计数器提供程序拖慢采样。
if (-not ('KrosnaMemoryDiagnostics.Native' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace KrosnaMemoryDiagnostics {
    public static class Native {
        [StructLayout(LayoutKind.Sequential)]
        private struct PerformanceInformation {
            public uint Size;
            public UIntPtr CommitTotal, CommitLimit, CommitPeak;
            public UIntPtr PhysicalTotal, PhysicalAvailable, SystemCache;
            public UIntPtr KernelTotal, KernelPaged, KernelNonpaged, PageSize;
            public uint HandleCount, ProcessCount, ThreadCount;
        }

        [DllImport("psapi.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetPerformanceInfo(
            out PerformanceInformation info, uint size);

        public static ulong[] ReadSystemMemory() {
            PerformanceInformation info;
            if (!GetPerformanceInfo(out info, (uint)Marshal.SizeOf(typeof(PerformanceInformation)))) {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            ulong pageSize = info.PageSize.ToUInt64();
            return new ulong[] {
                info.PhysicalAvailable.ToUInt64() * pageSize,
                info.PhysicalTotal.ToUInt64() * pageSize,
                info.CommitTotal.ToUInt64() * pageSize,
                info.CommitLimit.ToUInt64() * pageSize
            };
        }
    }
}
'@
}

# CreateNew 防止检查后出现同名文件时被覆盖。
$outputStream = [System.IO.File]::Open(
    $resolvedOutputPath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::Read
)
$writer = [System.IO.StreamWriter]::new($outputStream, [System.Text.UTF8Encoding]::new($false))
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$headerWritten = $false
$sampleCount = 0

try {
    do {
        $sampleStartedAt = $stopwatch.ElapsedMilliseconds
        $timestamp = [DateTime]::UtcNow.ToString('o')
        $processes = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CreationDate)
        $sameRoot = $processes | Where-Object {
            $_.ProcessId -eq $ParentProcessId -and $_.CreationDate.ToUniversalTime() -eq $rootCreationTime
        }
        if (-not $sameRoot) {
            Write-Warning 'The parent process exited or its PID was reused; sampling stopped.'
            break
        }

        # 按实际父子关系找子进程，不依赖包含路径或敏感参数的 CommandLine。
        $treeIds = [System.Collections.Generic.HashSet[uint32]]::new()
        [void]$treeIds.Add([uint32]$ParentProcessId)
        do {
            $added = $false
            foreach ($entry in $processes) {
                if ($treeIds.Contains([uint32]$entry.ParentProcessId) -and
                    $entry.CreationDate.ToUniversalTime() -ge $rootCreationTime) {
                    if ($treeIds.Add([uint32]$entry.ProcessId)) { $added = $true }
                }
            }
        } while ($added)

        $systemMemory = [KrosnaMemoryDiagnostics.Native]::ReadSystemMemory()
        foreach ($entry in $processes) {
            if (-not $treeIds.Contains([uint32]$entry.ProcessId)) { continue }
            $liveProcess = $null
            try {
                $liveProcess = [System.Diagnostics.Process]::GetProcessById([int]$entry.ProcessId)
                # CIM 快照和内存读取之间进程可能退出，校验启动时间避免记录复用的 PID。
                if ([Math]::Abs(($liveProcess.StartTime.ToUniversalTime() -
                    $entry.CreationDate.ToUniversalTime()).TotalMilliseconds) -gt 1) { continue }
                $row = [pscustomobject][ordered]@{
                    TimestampUtc = $timestamp
                    ElapsedMilliseconds = $sampleStartedAt
                    ProcessId = $entry.ProcessId
                    ParentProcessId = $entry.ParentProcessId
                    ProcessName = $entry.Name
                    ProcessStartedUtc = $entry.CreationDate.ToUniversalTime().ToString('o')
                    WorkingSetBytes = $liveProcess.WorkingSet64
                    PrivateBytes = $liveProcess.PrivateMemorySize64
                    SystemPhysicalAvailableBytes = $systemMemory[0]
                    SystemPhysicalTotalBytes = $systemMemory[1]
                    SystemCommittedBytes = $systemMemory[2]
                    SystemCommitLimitBytes = $systemMemory[3]
                }
                $csv = @($row | ConvertTo-Csv -NoTypeInformation)
                if (-not $headerWritten) {
                    $writer.WriteLine($csv[0])
                    $headerWritten = $true
                }
                $writer.WriteLine($csv[1])
            } catch [System.ArgumentException] {
                # 采样时退出的短命进程在下一次快照中自然消失。
            } catch [System.ComponentModel.Win32Exception] {
                # 无权读取内存的进程不影响其余进程采样。
            } catch [System.InvalidOperationException] {
                # 进程可能恰好在读取属性时退出。
            } finally {
                if ($null -ne $liveProcess) { $liveProcess.Dispose() }
            }
        }
        $writer.Flush()
        $sampleCount++
        $remaining = $DurationSeconds * 1000 - $stopwatch.ElapsedMilliseconds
        $sleepTime = [Math]::Min(
            $IntervalMilliseconds - ($stopwatch.ElapsedMilliseconds - $sampleStartedAt),
            $remaining
        )
        if ($sleepTime -gt 0) { Start-Sleep -Milliseconds ([int]$sleepTime) }
    } while ($stopwatch.Elapsed.TotalSeconds -lt $DurationSeconds)
} finally {
    $writer.Dispose()
    $stopwatch.Stop()
}

Write-Output "Saved $sampleCount samples to $resolvedOutputPath"
