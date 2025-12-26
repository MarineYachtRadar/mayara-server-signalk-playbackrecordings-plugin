#!/usr/bin/env node
/**
 * Build script for mayara-server-signalk-playbackrecordings-plugin
 *
 * Copies @marineyachtradar/mayara-gui from npm to public/
 * The plugin adds its own playback.html for file upload/control.
 *
 * Usage: node build.js [options]
 *   --local-gui  Use local mayara-gui instead of npm (for development)
 *   --pack       Create a .tgz tarball with public/ included (for manual install)
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const args = process.argv.slice(2)
const useLocalGui = args.includes('--local-gui')
const createPack = args.includes('--pack')

const scriptDir = __dirname
const publicDest = path.join(scriptDir, 'public')

/**
 * Recursively copy directory contents
 */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Source directory not found: ${src}`)
    process.exit(1)
  }

  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true })
  }

  fs.mkdirSync(dest, { recursive: true })

  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Find mayara-gui in node_modules (handles npm hoisting)
 */
function findGuiPackage() {
  // Possible locations for mayara-gui:
  // 1. Nested in plugin's own node_modules (npm nested install)
  // 2. Hoisted to parent node_modules (SignalK App Store installs to ~/.signalk/node_modules/)
  //    Structure: ~/.signalk/node_modules/@marineyachtradar/signalk-playback-plugin/
  //               ~/.signalk/node_modules/@marineyachtradar/mayara-gui/
  // 3. Local development (sibling directory)
  const candidates = [
    // Nested: <plugin>/node_modules/@marineyachtradar/mayara-gui
    path.join(scriptDir, 'node_modules', '@marineyachtradar', 'mayara-gui'),
    // Hoisted (scoped): <node_modules>/@marineyachtradar/<plugin> -> <node_modules>/@marineyachtradar/mayara-gui
    path.join(scriptDir, '..', 'mayara-gui'),
    // Hoisted (top-level): <node_modules>/@marineyachtradar/<plugin> -> <node_modules>/@marineyachtradar/mayara-gui
    path.join(scriptDir, '..', '..', '@marineyachtradar', 'mayara-gui'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * Copy GUI from npm package
 */
function setupGuiFromNpm() {
  console.log('Copying GUI from node_modules...\n')

  // Find mayara-gui (handles npm hoisting where deps may be in parent node_modules)
  const guiSource = findGuiPackage()

  if (!guiSource) {
    console.error('Error: @marineyachtradar/mayara-gui not found')
    console.error('Searched locations:')
    console.error('  - ' + path.join(scriptDir, 'node_modules', '@marineyachtradar', 'mayara-gui'))
    console.error('  - ' + path.join(scriptDir, '..', 'mayara-gui'))
    console.error('  - ' + path.join(scriptDir, '..', '..', '@marineyachtradar', 'mayara-gui'))
    console.error('Make sure @marineyachtradar/mayara-gui is listed in package.json dependencies')
    process.exit(1)
  }

  console.log('Found mayara-gui at: ' + guiSource)

  if (fs.existsSync(publicDest)) {
    fs.rmSync(publicDest, { recursive: true })
  }
  fs.mkdirSync(publicDest, { recursive: true })

  // Copy GUI files (exclude package.json, node_modules, etc.)
  const guiPatterns = [
    { ext: '.html' },
    { ext: '.js' },
    { ext: '.css' },
    { ext: '.ico' },
    { ext: '.svg' },
    { dir: 'assets' },
    { dir: 'proto' },
    { dir: 'protobuf' }
  ]

  // Exclude recordings.html since we have our own playback UI
  const excludeFiles = ['recordings.html', 'recordings.js', 'recordings.css']

  const entries = fs.readdirSync(guiSource, { withFileTypes: true })
  for (const entry of entries) {
    if (excludeFiles.includes(entry.name)) continue

    const srcPath = path.join(guiSource, entry.name)
    const destPath = path.join(publicDest, entry.name)

    if (entry.isDirectory()) {
      if (guiPatterns.some(p => p.dir === entry.name)) {
        copyDir(srcPath, destPath)
      }
    } else {
      if (guiPatterns.some(p => p.ext && entry.name.endsWith(p.ext))) {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  // Copy our custom files from plugin/public/ (overrides GUI files)
  const pluginPublic = path.join(scriptDir, 'plugin', 'public')
  if (fs.existsSync(pluginPublic)) {
    const customEntries = fs.readdirSync(pluginPublic, { withFileTypes: true })
    let customCount = 0
    for (const entry of customEntries) {
      const srcPath = path.join(pluginPublic, entry.name)
      const destPath = path.join(publicDest, entry.name)
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath)
        customCount++
      } else {
        fs.copyFileSync(srcPath, destPath)
        customCount++
      }
    }
    console.log(`Added ${customCount} custom files from plugin/public/`)
  }

  const fileCount = fs.readdirSync(publicDest, { recursive: true }).length
  console.log(`Copied ${fileCount} GUI files to public/\n`)
}

/**
 * Copy GUI from local sibling directory (for development)
 */
function setupGuiFromLocal() {
  const localGuiPath = path.join(scriptDir, '..', 'mayara-gui')
  console.log(`Copying GUI from local ${localGuiPath}...\n`)

  if (fs.existsSync(publicDest)) {
    fs.rmSync(publicDest, { recursive: true })
  }
  fs.mkdirSync(publicDest, { recursive: true })

  const guiPatterns = [
    { ext: '.html' },
    { ext: '.js' },
    { ext: '.css' },
    { ext: '.ico' },
    { ext: '.svg' },
    { dir: 'assets' },
    { dir: 'proto' },
    { dir: 'protobuf' }
  ]

  // Exclude recordings files since we have our own playback UI
  const excludeFiles = ['recordings.html', 'recordings.js', 'recordings.css']

  const entries = fs.readdirSync(localGuiPath, { withFileTypes: true })
  for (const entry of entries) {
    if (excludeFiles.includes(entry.name)) continue

    const srcPath = path.join(localGuiPath, entry.name)
    const destPath = path.join(publicDest, entry.name)

    if (entry.isDirectory()) {
      if (guiPatterns.some(p => p.dir === entry.name)) {
        copyDir(srcPath, destPath)
      }
    } else {
      if (guiPatterns.some(p => p.ext && entry.name.endsWith(p.ext))) {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  // Copy our custom files from plugin/public/ (overrides GUI files)
  const pluginPublic = path.join(scriptDir, 'plugin', 'public')
  if (fs.existsSync(pluginPublic)) {
    const customEntries = fs.readdirSync(pluginPublic, { withFileTypes: true })
    let customCount = 0
    for (const entry of customEntries) {
      const srcPath = path.join(pluginPublic, entry.name)
      const destPath = path.join(publicDest, entry.name)
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath)
        customCount++
      } else {
        fs.copyFileSync(srcPath, destPath)
        customCount++
      }
    }
    console.log(`Added ${customCount} custom files from plugin/public/`)
  }

  const fileCount = fs.readdirSync(publicDest, { recursive: true }).length
  console.log(`Copied ${fileCount} files from local mayara-gui/ to public/\n`)
}

function main() {
  console.log('=== MaYaRa SignalK Playback Plugin Build ===\n')

  if (useLocalGui) {
    setupGuiFromLocal()
  } else {
    setupGuiFromNpm()
  }

  // Create tarball if --pack flag is set
  if (createPack) {
    console.log('Creating tarball with public/ included...\n')

    // Temporarily remove public/ from .npmignore
    const npmignorePath = path.join(scriptDir, '.npmignore')
    const npmignoreContent = fs.readFileSync(npmignorePath, 'utf8')
    const npmignoreWithoutPublic = npmignoreContent.replace(/^public\/\n?/m, '')
    fs.writeFileSync(npmignorePath, npmignoreWithoutPublic)

    // Also temporarily add public/ to files in package.json
    const pkgPath = path.join(scriptDir, 'package.json')
    const pkgContent = fs.readFileSync(pkgPath, 'utf8')
    const pkg = JSON.parse(pkgContent)
    const originalFiles = [...pkg.files]
    pkg.files.push('public/**/*')
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

    try {
      // Run npm pack
      execSync('npm pack', { stdio: 'inherit', cwd: scriptDir })
      console.log('\nTarball created successfully!')
    } finally {
      // Restore .npmignore
      fs.writeFileSync(npmignorePath, npmignoreContent)
      // Restore package.json
      pkg.files = originalFiles
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    }
  }

  console.log('\n=== Build complete ===')
}

main()
