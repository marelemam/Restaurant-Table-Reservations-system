# Deploys reservation-service to Floci (local AWS emulator).
# Run from backend\reservation-service:   .\deploy.ps1
# Needs: Docker Desktop running, the Floci container running,
#        and the AWS CLI with a "floci" profile.

$env:AWS_PROFILE = 'floci'

$FunctionName = 'reservation-service'
$RoleName     = 'reservation-service-role'
$ApiId        = 'reservation-api'
$Region       = 'us-east-1'
$Account      = '000000000000'
$RoleArn      = "arn:aws:iam::${Account}:role/$RoleName"
$FunctionArn  = "arn:aws:lambda:${Region}:${Account}:function:$FunctionName"
$ZipPath      = Join-Path $env:TEMP 'reservation-service.zip'
$EnvPath      = Join-Path $env:TEMP 'reservation-service-env.json'
$TrustPath    = Join-Path $env:TEMP 'reservation-service-trust.json'

Set-Location $PSScriptRoot

# Stop the script if the last AWS/tar command failed
function Check($step) {
  if ($LASTEXITCODE -ne 0) { throw "Step failed: $step" }
}

try {
  # 1. Is Floci answering?
  Write-Host '1/6 Checking Floci...'
  aws sts get-caller-identity --query Account --output text | Out-Null
  Check 'Floci is not reachable. Is Docker Desktop open and the floci container running?'

  # 2. IAM role (create once)
  Write-Host '2/6 IAM role...'
  aws iam get-role --role-name $RoleName --query Role.Arn --output text 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Set-Content -Encoding ascii $TrustPath '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
    aws iam create-role --role-name $RoleName --assume-role-policy-document "file://$TrustPath" --query Role.Arn --output text
    Check 'create IAM role'
  }

  # 3. Pack the code (every .js file, package.json, node_modules). No .env inside.
  Write-Host '3/6 Packing code...'
  Remove-Item $ZipPath -ErrorAction SilentlyContinue
  $files = @((Get-ChildItem -File -Filter *.js).Name) + 'package.json' + 'node_modules'
  tar -a -c -f $ZipPath @files
  Check 'zip the code'

  # 4. Settings for Lambda, read from .env. ALLOW_FAKE_AUTH is never sent.
  Write-Host '4/6 Preparing settings...'
  $vars = @{}
  Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $vars[$matches[1]] = $matches[2].Trim() }
  }
  $vars.Remove('ALLOW_FAKE_AUTH')
  @{ Variables = $vars } | ConvertTo-Json | Set-Content -Encoding ascii $EnvPath

  # 5. Create the Lambda, or update it if it already exists
  aws lambda get-function --function-name $FunctionName --query Configuration.FunctionArn --output text 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host '5/6 Updating Lambda...'
    aws lambda update-function-code --function-name $FunctionName --zip-file "fileb://$ZipPath" --query LastUpdateStatus --output text
    Check 'update Lambda code'
    aws lambda wait function-updated --function-name $FunctionName
    aws lambda update-function-configuration --function-name $FunctionName --environment "file://$EnvPath" --query LastUpdateStatus --output text
    Check 'update Lambda settings'
  } else {
    Write-Host '5/6 Creating Lambda...'
    aws lambda create-function --function-name $FunctionName --runtime nodejs22.x --handler app.handler --role $RoleArn --zip-file "fileb://$ZipPath" --environment "file://$EnvPath" --timeout 30 --memory-size 256 --query FunctionArn --output text
    Check 'create Lambda'
  }

  # 6. API Gateway (create once)
  Write-Host '6/6 API Gateway...'
  aws apigatewayv2 get-api --api-id $ApiId --query ApiId --output text 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    aws apigatewayv2 create-api --name $ApiId --protocol-type HTTP --target $FunctionArn --tags "floci:override-id=$ApiId" --query ApiId --output text
    Check 'create API Gateway'
  }

  $url = "http://$ApiId.execute-api.localhost.floci.io:4566"
  Write-Host ''
  Write-Host "Deployed. API: $url" -ForegroundColor Green
  Write-Host 'Health check:'
  Invoke-RestMethod "$url/health"
}
finally {
  # Never leave secrets lying around in a temp file
  Remove-Item $EnvPath, $TrustPath -ErrorAction SilentlyContinue
}