# serve.ps1 - tiny local web server for FlyBrain Trader (Windows PowerShell, no install needed)
# Serves the repository at http://localhost:8765/ and opens trader3d/. Close the window to stop.
# serve the repository folder (one level up) so the page can reach ../js/sim-worker.js and ../data for live mode
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$port = 8765
$prefix = "http://localhost:$port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch {
  Write-Host "Could not start the local server on port $port."
  Write-Host $_.Exception.Message
  Read-Host "Press Enter to close"
  exit 1
}
Write-Host ""
Write-Host "  FlyBrain Trader is running at ${prefix}trader3d/"
Write-Host "  Keep this window open while you use it. Close it to stop."
Write-Host ""
Start-Process ($prefix + "trader3d/")
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8';
  '.txt'='text/plain; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.png'='image/png'; '.svg'='image/svg+xml';
  '.gz'='application/gzip'; '.bin'='application/octet-stream'; '.md'='text/plain; charset=utf-8' }
$doctype = [Text.Encoding]::UTF8.GetBytes("<!doctype html>`n")
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq '/') { $path = '/trader3d/index.html' }
    if ($path.EndsWith('/')) { $path = $path + 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/')))
    if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($ext -eq '.html') {
        # the page is written without a doctype (the artifact host adds one); add it here so the browser uses standards mode
        $head = [Text.Encoding]::UTF8.GetString($bytes, 0, [Math]::Min(20, $bytes.Length)).ToLower()
        if (-not $head.StartsWith('<!doctype')) { $bytes = $doctype + $bytes }
      }
      if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $res.StatusCode = 404 }
    $res.Close()
  } catch { Write-Host $_.Exception.Message }
}
