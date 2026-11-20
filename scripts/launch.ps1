$ErrorActionPreference = "Stop"

$projectDir = "D:\Hermes Project\math-adventure"
$nodeExe = "C:\Users\MAI-PC\AppData\Local\Programs\node-v24.21.0\node.exe"
$logsDir = Join-Path $projectDir "logs"

if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

function Test-PortListening($port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        $wait = $iar.AsyncWaitHandle.WaitOne(400, $false)
        if ($wait -and $client.Connected) {
            $client.EndConnect($iar)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

# 1. Start Backend if not already running
if (-not (Test-PortListening 3001)) {
    $backendOut = Join-Path $logsDir "backend.log"
    $backendErr = Join-Path $logsDir "backend-err.log"
    $apiServer = Join-Path $projectDir "server\api-server.js"
    Start-Process -FilePath $nodeExe `
        -ArgumentList "`"$apiServer`"" `
        -WorkingDirectory $projectDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $backendOut `
        -RedirectStandardError $backendErr
}

# 2. Start Frontend (Vite) if not already running
if (-not (Test-PortListening 5173)) {
    $frontendOut = Join-Path $logsDir "frontend.log"
    $frontendErr = Join-Path $logsDir "frontend-err.log"
    $viteScript = Join-Path $projectDir "node_modules\vite\bin\vite.js"
    Start-Process -FilePath $nodeExe `
        -ArgumentList "`"$viteScript`" --host" `
        -WorkingDirectory $projectDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $frontendOut `
        -RedirectStandardError $frontendErr
}

# 3. Wait until Frontend is ready (up to 15 seconds)
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    if (Test-PortListening 5173) {
        $ready = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

# 4. Open default browser
Start-Process "http://localhost:5173"
