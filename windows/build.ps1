param([ValidateSet('win-x64', 'win-arm64')][string]$Runtime = 'win-x64')
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'OpenRouterUsage.csproj'
$output = Join-Path $PSScriptRoot "dist/$Runtime"
dotnet publish $project -c Release -r $Runtime --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -o $output
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
Copy-Item (Join-Path $PSScriptRoot 'README.md') $output
Copy-Item (Join-Path $PSScriptRoot 'LICENSE') $output
Copy-Item (Join-Path $PSScriptRoot 'Assets/LUCIDE-LICENSE') $output
$cacheInfo = dotnet nuget locals global-packages --list
if ($LASTEXITCODE -ne 0) { throw 'Could not locate runtime license files.' }
$cache = $cacheInfo.Substring($cacheInfo.IndexOf(':') + 1).Trim()
foreach ($package in @("microsoft.netcore.app.runtime.$Runtime", "microsoft.windowsdesktop.app.runtime.$Runtime")) {
    Get-ChildItem (Join-Path $cache $package) -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|THIRD-PARTY-NOTICES)' } | ForEach-Object {
        $notices = Join-Path $output "runtime-notices/$package/$($_.Directory.Name)"
        New-Item -ItemType Directory -Path $notices -Force | Out-Null
        Copy-Item $_.FullName $notices
    }
}
Compress-Archive -Path "$output/*" -DestinationPath (Join-Path $PSScriptRoot "dist/OpenRouterUsage-$Runtime.zip") -Force
Write-Host "Ready: $output/OpenRouterUsage.exe"
