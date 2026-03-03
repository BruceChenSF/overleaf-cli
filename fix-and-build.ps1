# Overleaf CC - 一键修复和构建脚本
# 自动安装依赖、构建所有组件、运行验证

# 设置控制台编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Overleaf CC - 一键修复和构建" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorOccurred = $false

# 函数：执行步骤并显示结果
function Invoke-Step {
    param(
        [string]$Message,
        [ScriptBlock]$ScriptBlock
    )

    Write-Host ""
    Write-Host "▶ $Message..." -ForegroundColor Cyan

    try {
        & $ScriptBlock
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ 完成" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  ✗ 失败 (退出码: $LASTEXITCODE)" -ForegroundColor Red
            $script:ErrorOccurred = $true
            return $false
        }
    } catch {
        Write-Host "  ✗ 错误: $($_.Exception.Message)" -ForegroundColor Red
        $script:ErrorOccurred = $true
        return $false
    }
}

# Step 1: 安装根目录依赖
Invoke-Step "安装扩展依赖" {
    npm install
}

# Step 2: 构建扩展
Invoke-Step "构建 Chrome 扩展" {
    npm run build
}

# Step 3: 安装 bridge 依赖
Invoke-Step "安装 Bridge 依赖" {
    cd packages\bridge
    npm install
    cd ..\
}

# Step 4: 构建 bridge
Invoke-Step "构建 Bridge CLI" {
    cd packages\bridge
    npm run build
    cd ..\
}

# Step 5: 运行验证
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "运行验证测试..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

& .\test-quick-verify.ps1

# 总结
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "修复完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($ErrorOccurred) {
    Write-Host "⚠ 部分步骤失败，请检查上面的错误信息" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "常见问题解决：" -ForegroundColor Cyan
    Write-Host "1. Node.js 未安装：从 https://nodejs.org/ 下载安装"
    Write-Host "2. 网络问题：尝试使用 npm 镜像（见 docs/INSTALLATION.md）"
    Write-Host "3. 权限问题：以管理员身份运行 PowerShell"
} else {
    Write-Host "✓ 所有步骤成功完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "下一步：" -ForegroundColor Cyan
    Write-Host "1. 启动 Bridge 服务器："
    Write-Host "   cd packages\bridge" -ForegroundColor Gray
    Write-Host "   node dist\cli.js" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. 加载扩展到 Chrome："
    Write-Host "   打开 chrome://extensions/" -ForegroundColor Gray
    Write-Host "   启用"开发者模式"" -ForegroundColor Gray
    Write-Host "   点击"加载已解压的扩展程序"" -ForegroundColor Gray
    Write-Host "   选择 dist 目录" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. 在 Overleaf 中点击 Terminal 按钮"
}

Write-Host ""
Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
