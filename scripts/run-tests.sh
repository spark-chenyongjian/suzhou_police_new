#!/bin/bash

# DeepAnalyze 测试执行脚本
# 确保服务正在运行，然后执行所有测试

set -e

echo "🚀 Starting DeepAnalyze tests..."

# 检查服务是否运行
echo "🔍 Checking if DeepAnalyze service is running..."
if ! curl --noproxy '*' -s http://localhost:21000/api/health > /dev/null; then
    echo "❌ DeepAnalyze service is not running on http://localhost:21000"
    echo "💡 Please start the service with: bun run src/main.ts"
    exit 1
fi

echo "✅ Service is running, starting tests..."

# 运行测试
cd "$(dirname "$0")/.."
bun run vitest --run

echo "🎉 All tests completed!"