$ErrorActionPreference = "SilentlyContinue"

$ports = @(3001, 5173)
$stopped = @()

foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            $procId = $conn.OwningProcess
            if ($procId -and $procId -gt 4) {
                $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
                if ($proc -and $proc.ProcessName -like "*node*") {
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                    $stopped += $procId
                }
            }
        }
    }
}

if ($stopped.Count -gt 0) {
    Write-Output "Berhasil menghentikan server Math Adventure (PID: $($stopped -join ', '))."
} else {
    Write-Output "Tidak ada server Math Adventure yang sedang berjalan."
}
