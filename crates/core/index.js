/* napi loader — loads the correct platform binary */
const { existsSync } = require('fs')
const { join } = require('path')

const { platform, arch } = process

const platformMap = {
  darwin: { arm64: 'darwin-arm64', x64: 'darwin-x64' },
  linux: { x64: 'linux-x64-gnu', arm64: 'linux-arm64-gnu' },
  win32: { x64: 'win32-x64-msvc' },
}

const triple = platformMap[platform]?.[arch]
if (!triple) {
  throw new Error(`Unsupported platform: ${platform}-${arch}`)
}

const localPath = join(__dirname, `rayuela-core.${triple}.node`)
let nativeBinding

if (existsSync(localPath)) {
  nativeBinding = require(localPath)
} else {
  nativeBinding = require(`@rayuela/core-${triple}`)
}

exports.parseFile = nativeBinding.parseFile
exports.parseSource = nativeBinding.parseSource
exports.queryTree = nativeBinding.queryTree
exports.getLanguageName = nativeBinding.getLanguageName
exports.validateSpec = nativeBinding.validateSpec
exports.ParseResult = nativeBinding.ParseResult
exports.AppGraph = nativeBinding.AppGraph
