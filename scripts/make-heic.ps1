# Generates test-fixtures/sample.heic with the Windows built-in HEIF encoder (WinRT).
# Needed because x265 cannot run inside the single-threaded FFmpeg WASM build and
# libheif-js ships without encoders. The image is synthetic (gradient + text).
# Usage (Windows PowerShell 5.1):  powershell -ExecutionPolicy Bypass -File scripts/make-heic.ps1
$ErrorActionPreference = 'Stop'
$dir = (Resolve-Path (Join-Path $PSScriptRoot '..\test-fixtures')).Path

Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 320, 240
$g = [System.Drawing.Graphics]::FromImage($bmp)
$rect = New-Object System.Drawing.Rectangle 0, 0, 320, 240
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(11, 131, 120)), ([System.Drawing.Color]::FromArgb(244, 183, 64)), 45
$g.FillRectangle($brush, 0, 0, 320, 240)
$g.FillRectangle([System.Drawing.Brushes]::Crimson, 0, 0, 30, 30) # top-left orientation marker
$g.DrawString('HEIC', (New-Object System.Drawing.Font 'Arial', 40, ([System.Drawing.FontStyle]::Bold)), [System.Drawing.Brushes]::White, 90, 90)
$g.Dispose()
$src = Join-Path $env:TEMP 'convertly-heic-src.png'
$bmp.Save($src, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTaskGeneric.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function AwaitAction($a) { $task = $asTaskAction.Invoke($null, @($a)); $task.Wait(-1) | Out-Null }
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

$inFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($src)) ([Windows.Storage.StorageFile])
$inStream = Await ($inFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($inStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Ignore)) ([Windows.Graphics.Imaging.SoftwareBitmap])
$folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($dir)) ([Windows.Storage.StorageFolder])
$outFile = Await ($folder.CreateFileAsync('sample.heic', [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
$outStream = Await ($outFile.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
$encoder = Await ([Windows.Graphics.Imaging.BitmapEncoder]::CreateAsync([Windows.Graphics.Imaging.BitmapEncoder]::HeifEncoderId, $outStream)) ([Windows.Graphics.Imaging.BitmapEncoder])
$encoder.SetSoftwareBitmap($bitmap)
AwaitAction ($encoder.FlushAsync())
$outStream.Dispose()
$inStream.Dispose()
Remove-Item $src
Write-Output "sample.heic written to $dir"
