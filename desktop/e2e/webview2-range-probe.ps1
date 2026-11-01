$ErrorActionPreference = 'Stop'

# Use only preinstalled SDK components; do not restore packages or inspect credentials.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = if (Test-Path $vswhere) { & $vswhere -latest -products '*' -property installationPath } else { $null }
$roots = @("$env:USERPROFILE\.nuget\packages\microsoft.web.webview2")
if ($vs) { $roots += "$vs\Common7\IDE\CommonExtensions" }
$assembly = $null
foreach ($root in $roots) {
  if (Test-Path $root) {
    $assembly = Get-ChildItem -Path $root -Filter Microsoft.Web.WebView2.WinForms.dll -File -Recurse -Depth 8 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($assembly) { break }
  }
}
if (!$assembly) { throw 'Preinstalled managed WebView2 SDK not found in targeted paths' }
$corePath = Join-Path $assembly.DirectoryName 'Microsoft.Web.WebView2.Core.dll'
if (!(Test-Path $corePath)) { throw 'Preinstalled WebView2 Core DLL is missing' }
$loader = $null
foreach ($root in $roots) {
  if (Test-Path $root) {
    $loader = Get-ChildItem -Path $root -Filter WebView2Loader.dll -File -Recurse -Depth 8 -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '(?i)(x64|amd64)' } | Select-Object -First 1
    if ($loader) { break }
  }
}
if (!$loader) { throw 'Preinstalled x64 WebView2 loader not found in targeted paths' }
$env:PATH = "$($loader.DirectoryName);$env:PATH"
Add-Type -AssemblyName System.Windows.Forms
[void][Reflection.Assembly]::LoadFrom($corePath)
[void][Reflection.Assembly]::LoadFrom($assembly.FullName)
[Console]::WriteLine("Managed SDK version: $($assembly.VersionInfo.FileVersion)")

$html = @'
<!doctype html><meta charset="utf-8"><script>
(async () => {
 const result = {origin: location.origin, secure: isSecureContext};
 try {
  const response = await fetch('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin', {
    headers: {Range: 'bytes=4-5'}, credentials: 'omit'
  });
  result.status = response.status;
  result.range = response.headers.get('Content-Range');
  result.bytes = (await response.arrayBuffer()).byteLength;
 } catch (error) { result.error = String(error); }
 window.chrome.webview.postMessage(result);
})();
</script>
'@
$script:htmlBytes = [Text.Encoding]::UTF8.GetBytes($html)
$script:streams = @()
$script:resultCode = 1
$script:phase = 0
$script:startTime = [DateTime]::UtcNow
[Console]::WriteLine('STAGE: creating form')
$script:form = [System.Windows.Forms.Form]::new()
$script:form.Width = 640
$script:form.Height = 480
[Console]::WriteLine('STAGE: creating control')
$script:view = [Microsoft.Web.WebView2.WinForms.WebView2]::new()
[Console]::WriteLine('STAGE: control created')
$script:view.Dock = [System.Windows.Forms.DockStyle]::Fill
$script:form.Controls.Add($script:view)
$script:timer = [System.Windows.Forms.Timer]::new()
$script:timer.Interval = 100
$script:form.Add_Shown({
  [Console]::WriteLine('STAGE: form shown')
  $profile = Join-Path $env:RUNNER_TEMP 'noted-webview2-probe-profile'
  $script:environmentTask = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($null, $profile, $null)
  $script:timer.Start()
})
$script:timer.Add_Tick({
  try {
    if (([DateTime]::UtcNow - $script:startTime).TotalSeconds -gt 60) { throw 'WebView2 probe timed out' }
    if ($script:phase -eq 0 -and $script:environmentTask -and $script:environmentTask.IsCompleted) {
      if ($script:environmentTask.IsFaulted) { throw 'WebView2 environment creation failed' }
      [Console]::WriteLine('STAGE: environment ready')
      $script:initTask = $script:view.EnsureCoreWebView2Async($script:environmentTask.Result)
      $script:phase = 1
    }
    if ($script:phase -eq 1 -and $script:initTask.IsCompleted) {
      if ($script:initTask.IsFaulted) { throw 'WebView2 control initialization failed' }
      $core = $script:view.CoreWebView2
      [Console]::WriteLine("WebView2 runtime: $($core.Environment.BrowserVersionString)")
      $core.AddWebResourceRequestedFilter('http://tauri.localhost/*', [Microsoft.Web.WebView2.Core.CoreWebView2WebResourceContext]::All)
      $core.add_WebResourceRequested({
        param($sender, $eventArgs)
        $stream = [IO.MemoryStream]::new($script:htmlBytes, $false)
        $script:streams += $stream
        $eventArgs.Response = $script:view.CoreWebView2.Environment.CreateWebResourceResponse($stream, 200, 'OK', "Content-Type: text/html; charset=utf-8`r`n")
      })
      $core.add_WebMessageReceived({
        param($sender, $eventArgs)
        try {
          $result = $eventArgs.WebMessageAsJson | ConvertFrom-Json
          [Console]::WriteLine("RESULT: " + ($result | ConvertTo-Json -Compress))
          if ($result.origin -eq 'http://tauri.localhost' -and $result.status -eq 206 -and $result.range -eq 'bytes 4-5/32152673' -and $result.bytes -eq 2) { $script:resultCode = 0 }
        } catch { [Console]::WriteLine('Invalid WebView2 result') }
        $script:timer.Stop()
        $script:form.Close()
      })
      $script:phase = 2
      $core.Navigate('http://tauri.localhost/index.html')
    }
  } catch {
    [Console]::WriteLine("PROBE FAILURE: " + $_.Exception.Message)
    $script:timer.Stop()
    $script:form.Close()
  }
})
[Console]::WriteLine('STAGE: starting message loop')
[System.Windows.Forms.Application]::Run($script:form)
[Console]::WriteLine("STAGE: message loop ended, code $script:resultCode")
exit $script:resultCode
