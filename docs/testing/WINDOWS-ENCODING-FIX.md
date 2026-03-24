# Windows 中文编码问题解决方案

## 🔧 已应用的修复

所有测试脚本已包含中文编码支持：

### PowerShell 脚本 (`.ps1`)
```powershell
# 设置控制台编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 设置代码页为 65001 (UTF-8)
chcp 65001 | Out-Null
```

### 批处理文件 (`.bat`)
```batch
REM 设置控制台代码页为 UTF-8
chcp 65001 >nul 2>&1
```

---

## 🐛 如果仍然看到乱码

### 问题 1: PowerShell 脚本显示乱码

**解决方案 A：在 PowerShell 中设置执行策略**
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
.\test-quick-verify.ps1
```

**解决方案 B：使用 UTF-8 BOM 保存脚本**
1. 用记事本打开 `test-quick-verify.ps1`
2. "另存为"
3. 编码选择：**UTF-8 with BOM**
4. 保存

**解决方案 C：在 PowerShell ISE 中运行**
```powershell
# 打开 PowerShell ISE
# File → Open → 选择 test-quick-verify.ps1
# 点击绿色运行按钮
```

---

### 问题 2: 批处理文件显示乱码

**解决方案 A：修改代码页**
```cmd
chcp 936
test-quick-verify.bat
```

**解决方案 B：使用 legacy encoding**
编辑 `test-quick-verify.bat`，将第一行改为：
```batch
@echo off
REM 使用 GBK 编码以支持中文
chcp 936 >nul 2>&1
```

**解决方案 C：保存为 ANSI 编码**
1. 用记事本打开 `test-quick-verify.bat`
2. "另存为"
3. 编码选择：**ANSI**
4. 保存

---

### 问题 3: Bridge 服务器日志乱码

**解决方案：修改 bridge 服务器启动命令**

创建 `start-bridge.bat`：
```batch
@echo off
chcp 65001
cd packages\bridge
node dist\cli.js
pause
```

或者使用 PowerShell：
```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
cd packages\bridge
node dist\cli.js
```

---

## 📝 完整的编码设置指南

### 方法 1：临时设置（每次打开新窗口都需要）

**PowerShell:**
```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"
```

**CMD (命令提示符):**
```cmd
chcp 65001
set PYTHONIOENCODING=utf-8
```

### 方法 2：永久设置 PowerShell

创建 PowerShell 配置文件（如果不存在）：
```powershell
Test-Path $PROFILE
# 如果返回 False，创建它：
New-Item -Path $PROFILE -Type File -Force
```

编辑 `$PROFILE`，添加：
```powershell
# 设置编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
```

### 方法 3：永久设置 CMD

添加到注册表（需要管理员权限）：
```cmd
reg add HKCU\Console /v CodePage /t REG_DWORD /d 65001
```

或者创建快捷方式：
1. 右键桌面 → 新建 → 快捷方式
2. 位置输入：`cmd.exe`
3. 右键快捷方式 → 属性
4. 在"目标"末尾添加：` /K chcp 65001`
5. 使用此快捷方式打开命令提示符

---

## 🔍 检查当前编码

**PowerShell:**
```powershell
[Console]::OutputEncoding
# 应该显示：System.Text.UTF8Encoding
```

**CMD:**
```cmd
chcp
# 应该显示：Active code page: 65001
```

---

## 💡 推荐的工作流

### 选项 A：使用 PowerShell（推荐）

```powershell
# 1. 打开 PowerShell
# 2. 设置编码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 3. 运行预检查
.\test-quick-verify.ps1

# 4. 启动 bridge
cd packages\bridge
node dist\cli.js
```

### 选项 B：使用 VS Code 集成终端

1. 在 VS Code 中打开项目
2. 设置 VS Code 终端编码（settings.json）：
   ```json
   {
     "terminal.integrated.defaultProfile.windows": "PowerShell",
     "terminal.integrated.profiles.windows": {
       "PowerShell": {
         "source": "PowerShell",
         "args": ["-NoExit", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8"]
       }
     }
   }
   ```
3. 使用 VS Code 的终端（`Ctrl + ` `）

### 选项 C：使用 Git Bash（如果已安装）

Git Bash 默认支持 UTF-8，不需要额外配置：
```bash
bash test-quick-verify.sh
```

---

## 🛠️ 编码问题诊断工具

创建 `check-encoding.ps1`：
```powershell
Write-Host "=== Encoding Check ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Console Output Encoding: $([Console]::OutputEncoding)"
Write-Host "Console Input Encoding: $([Console]::InputEncoding)"
Write-Host "Default Output Encoding: $($OutputEncoding)"
Write-Host ""
Write-Host "Test Chinese: 测试中文" -ForegroundColor Green
Write-Host ""
Write-Host "If you see '测试中文' correctly, encoding is OK!"
Write-Host "If you see garbled text, try: chcp 65001"
```

运行测试：
```powershell
.\check-encoding.ps1
```

---

## 📊 不同编码方案对比

| 编码 | 代码页 | 优点 | 缺点 | 推荐度 |
|------|--------|------|------|--------|
| UTF-8 | 65001 | 国际标准，跨平台 | Windows 旧版支持差 | ⭐⭐⭐⭐⭐ |
| GBK | 936 | 中文兼容性好 | 不支持其他语言 | ⭐⭐⭐ |
| ANSI | - | 最兼容 | 编码问题多 | ⭐⭐ |

**推荐：UTF-8 (65001)**

---

## ✅ 验证编码修复

运行此命令测试：

```powershell
Write-Host "中文测试：你好世界 ✓" -ForegroundColor Green
```

**预期输出：**
```
中文测试：你好世界 ✓
```

**如果看到乱码或方框：**
- 尝试安装中文字体
- 检查终端字体设置
- 尝试不同的终端（Windows Terminal, VS Code, Git Bash）

---

## 🎯 最终建议

对于 Overleaf CC 项目：

1. **开发时**：使用 VS Code 集成终端（自动 UTF-8）
2. **测试时**：使用 PowerShell 或 Windows Terminal
3. **脚本**：已配置好 UTF-8，直接运行即可
4. **有问题**：运行 `check-encoding.ps1` 诊断

---

**需要进一步帮助？** 告诉我：
1. 你使用的终端（PowerShell/CMD/Git Bash）
2. 看到的具体乱码样子（截图）
3. Windows 版本

我会提供更具体的解决方案！
