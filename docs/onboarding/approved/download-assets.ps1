# Recreate approved external assets. Run only when intentionally refreshing the archive.
$ErrorActionPreference = 'Stop'
$archiveAssets = Join-Path $PSScriptRoot 'assets'
$archiveHeaders = @{'User-Agent'='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'}
$archiveDownloads = @{
  'fonts-google.css' = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Instrument+Sans:wght@400;500;600&display=swap'
  'fraunces-latin.woff2' = 'https://fonts.gstatic.com/s/fraunces/v38/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxC9TeA.woff2'
  'fraunces-latin-ext.woff2' = 'https://fonts.gstatic.com/s/fraunces/v38/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxCFTeO-U.woff2'
  'fraunces-vietnamese.woff2' = 'https://fonts.gstatic.com/s/fraunces/v38/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxCBTeO-U.woff2'
  'instrument-sans-latin.woff2' = 'https://fonts.gstatic.com/s/instrumentsans/v4/pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1Q.woff2'
  'instrument-sans-latin-ext.woff2' = 'https://fonts.gstatic.com/s/instrumentsans/v4/pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0She1YmV.woff2'
  'Fraunces-OFL.txt' = 'https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/OFL.txt'
  'InstrumentSans-OFL.txt' = 'https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentsans/OFL.txt'
  'floating-ui.core.umd.min.js' = 'https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js'
  'floating-ui.dom.umd.min.js' = 'https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js'
  'lucide.js' = 'https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js'
  'FloatingUI-LICENSE' = 'https://unpkg.com/@floating-ui/core@1.7.3/LICENSE'
  'Lucide-LICENSE' = 'https://unpkg.com/lucide@1.17.0/LICENSE'
}
foreach ($archiveEntry in $archiveDownloads.GetEnumerator()) {
  Invoke-WebRequest -Uri $archiveEntry.Value -Headers $archiveHeaders -OutFile (Join-Path $archiveAssets $archiveEntry.Key)
  Write-Output $archiveEntry.Key
}
