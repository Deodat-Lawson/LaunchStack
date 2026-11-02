param([int]$Port = 3177, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1 -or $Port -gt 65535 -or $Port -in @(3104, 3111)) { Write-Error 'Choose a port from 1 to 65535 other than 3104 or 3111.'; exit 1 }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'recorded'))
$index = Join-Path $root 'index.html'
if (-not (Test-Path -LiteralPath $index -PathType Leaf)) { Write-Error "Recorded demo bundle missing: $index. Obtain or build the complete package."; exit 1 }
$manifestFile = Join-Path $root 'bundle-manifest.json'
$allowed = @{}
try {
    if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) { throw 'Bundle manifest missing.' }
    $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 'vantage-portable-bundle/v1' -or -not $manifest.files) { throw 'Invalid bundle manifest.' }
    $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    foreach ($entry in $manifest.files) {
        $name = [string]$entry.path
        if (-not $name -or $name.StartsWith('/') -or $name.Contains('\') -or $name.Contains(':') -or ($name -split '/' | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' }) -or $name -notmatch '^[a-zA-Z0-9_./-]+$') { throw 'Invalid manifest path.' }
        $file = [IO.Path]::GetFullPath((Join-Path $root $name.Replace('/', [IO.Path]::DirectorySeparatorChar)))
        if (-not $file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $allowed.ContainsKey($file)) { throw 'Invalid or duplicate manifest path.' }
        $current = $file
        while ($current -and $current.Length -ge $root.Length) {
            if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked files are not permitted.' }
            if ($current -eq $root) { break }
            $current = [IO.Path]::GetDirectoryName($current)
        }
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -ne $entry.bytes -or $entry.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Bundle file missing or changed: $name" }
        $allowed[$file] = $true
    }
    if (-not $allowed.ContainsKey($index)) { throw 'Bundle index is not listed.' }
} catch {
    Write-Error "Recorded demo package could not be verified. Obtain the complete package or rebuild it. $($_.Exception.Message)"
    exit 1
}
$mime = @{'.html'='text/html; charset=utf-8';'.js'='text/javascript; charset=utf-8';'.mjs'='text/javascript; charset=utf-8';'.css'='text/css; charset=utf-8';'.json'='application/json; charset=utf-8';'.svg'='image/svg+xml';'.png'='image/png';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.webp'='image/webp';'.ico'='image/x-icon';'.woff'='font/woff';'.woff2'='font/woff2';'.ttf'='font/ttf';'.otf'='font/otf'}
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$url = "http://127.0.0.1:$Port/"
try { $listener.Start() } catch { Write-Error "Cannot start $url. Choose another -Port. $($_.Exception.Message)"; exit 1 }
try {
    Write-Host "Recorded synthetic Vantage demo: $url"
    Write-Host 'Preview edits reset on reload. Press Ctrl+C or close this window to stop.'
    if (-not $NoBrowser) { Start-Process $url }
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 5000; $client.SendTimeout = 5000
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $request = $reader.ReadLine(); $headerChars = 0
            do {
                $line = $reader.ReadLine()
                if ($null -eq $line) { break }
                $headerChars += $line.Length
                if ($headerChars -gt 16384) { throw 'Headers too large' }
            } while ($line.Length -gt 0)
            $status = 200; $method = ''; $contentType = 'text/plain; charset=utf-8'; $bytes = [byte[]]@()
            if ($null -eq $request -or $request.Length -gt 4096 -or $request -notmatch '^(GET|HEAD) (/[^ ]*) HTTP/1\.[01]$') { $status = 400 }
            else {
                $method = $Matches[1]; $path = [Uri]::UnescapeDataString($Matches[2].Split('?')[0])
                if ($path -eq '/__demo_health') { $bytes = [Text.Encoding]::UTF8.GetBytes('recorded-vantage-demo') }
                elseif ($path.Contains('\') -or $path.Contains([char]0) -or ($path -split '/' | Where-Object { $_ -eq '..' -or $_ -eq '.' })) { $status = 400 }
                else {
                    $relative = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
                    $file = [IO.Path]::GetFullPath((Join-Path $root $relative))
                    $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
                    if ($file -ne $root -and -not $file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $status = 403 }
                    else {
                        if ($path -eq '/' -or (-not [IO.Path]::HasExtension($file) -and -not (Test-Path -LiteralPath $file -PathType Leaf))) { $file = $index }
                        $current = $file; $unsafe = $false
                        while ($current -and $current.Length -ge $root.Length) {
                            if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { $unsafe = $true; break }
                            if ($current -eq $root) { break }
                            $current = [IO.Path]::GetDirectoryName($current)
                        }
                        $extension = [IO.Path]::GetExtension($file).ToLowerInvariant()
                        if ($unsafe) { $status = 403 }
                        elseif (-not $allowed.ContainsKey($file) -or -not $mime.ContainsKey($extension) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { $status = 404 }
                        else { $contentType = $mime[$extension]; $bytes = [IO.File]::ReadAllBytes($file) }
                    }
                }
            }
            $reason = @{200='OK';400='Bad Request';403='Forbidden';404='Not Found'}[$status]
            if ($status -ne 200) { $bytes = [Text.Encoding]::UTF8.GetBytes($reason) }
            $header = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`nX-Content-Type-Options: nosniff`r`n`r`n"
            $headers = [Text.Encoding]::ASCII.GetBytes($header); $stream.Write($headers, 0, $headers.Length)
            if ($method -ne 'HEAD') { $stream.Write($bytes, 0, $bytes.Length) }
        } catch { } finally { $client.Close() }
    }
} finally { $listener.Stop() }
