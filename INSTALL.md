# Install and package Pi Legal Workbench

This directory is already a Pi package. Its `package.json` declares four extensions (ten tools), six skills, and four prompt templates. Pi loads the TypeScript directly; no compilation step is needed for installation.

## Requirements

- Node.js 22 or later and npm.
- Pi installed and available as `pi` in your terminal. The development dependency is Pi 0.84.4; archive installation and resource loading were also verified with Pi 0.85.1.
- Google Chrome (default), Microsoft Edge, or Opera for browser-based case research. `legal_jurisdictions` reports installed/not-installed status; browser tools accept `browser: "chrome" | "edge" | "opera"`. See [browser configuration](extensions/legal-case-research/README.md#configuration).
- A configured Pi model/provider for summaries, case chat, and model-assisted verification.
- Python and [the Python dependencies](python/README.md) only if you want to use the DOCX helper. Python is not required to load the Pi package.

## Use the existing checkout on this Windows computer

Run in PowerShell:

```powershell
Set-Location "C:\Users\bacon21\Workspace\PiAgent-LegalTools"
npm ci
pi install "C:\Users\bacon21\Workspace\PiAgent-LegalTools"
pi list
```

This installs the package in the active Pi profile so it is available across projects. Pi keeps a reference to this folder; keep it in place. Later source edits are picked up after restarting Pi or running `/reload`.

For one project only, open that project's directory and run:

```powershell
pi install -l "C:\Users\bacon21\Workspace\PiAgent-LegalTools"
```

The `PiAgent-LegalTools` workspace already has this project-local entry in `.pi/settings.json`, so running `pi` there is sufficient once dependencies are installed. Trust the project when Pi prompts.

Use the combined workbench package by itself. Loading the standalone CaseLawSearch package as well registers duplicate research tools.

If you previously registered the old nested folder, remove that entry with `pi remove "C:\Users\bacon21\Workspace\PiAgent-LegalTools\pi-legal-workbench"` and install the repository root using the command above. Use `-l` on both commands for a project-local entry. The repository's own `.pi/settings.json` has already been updated.

## Build a portable archive

From the repository root (the directory containing `package.json`):

```powershell
npm ci
npm run check
npm run pack:release
```

This creates `dist/pi-legal-workbench-0.1.0.tgz`. The version in `package.json` determines the filename. The archive includes the extensions, skills, prompts, Python helpers, assets, documentation, and tests. It excludes `node_modules`, local Pi settings, case data outside those package directories, and Python bytecode caches. Runtime dependencies are downloaded during installation, so this is not an offline dependency bundle.

When Python is installed, also run `npm run python:check` to check the DOCX helper's syntax.

If Python is available only in the virtual environment described in the Python guide, use `.\.venv\Scripts\python.exe -m py_compile python\render_docx.py` on Windows instead.

`"private": true` can stay in `package.json` for this workflow. Creating or sharing an archive does not publish it to npm.

## Install the archive on another Windows computer

Copy the `.tgz` file to the destination computer. In PowerShell, adjust the archive path on the second line:

```powershell
$installDir = Join-Path $env:USERPROFILE "PiPackages\pi-legal-workbench-0.1.0"
$archive = Join-Path $env:USERPROFILE "Downloads\pi-legal-workbench-0.1.0.tgz"
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
tar -xzf $archive -C $installDir --strip-components=1
Set-Location $installDir
npm install --omit=dev --ignore-scripts
pi install $installDir
pi list
```

The archive's top-level folder is named `package`; `--strip-components=1` extracts its contents directly into `$installDir`. Run the commands in order and stop if one reports an error. Keep the extracted directory after installation because Pi references it without copying it. For a later version, extract to a new versioned directory and remove the old Pi package entry with `pi remove "<old-install-directory>"` before installing the new one.

For a project-local install, replace `pi install $installDir` with `pi install -l $installDir` after changing to your target project's directory.

On macOS or Linux, the same flow works with your shell's directory commands: extract the archive, run `npm install --omit=dev --ignore-scripts` inside it, and run `pi install /absolute/path/to/extracted-package`.

## Verify it is available

Restart Pi or run `/reload`. Use `/skill:case-law-research` to invoke the research skill. The prompt templates include `/research-memo`, `/treatment-report`, `/adversarial-analysis`, and `/hearing-simulation`.

`pi list` should show the package path. If the package appears there but resources are disabled, check `pi config` (or `pi config -l` for project settings).

## Distribution through npm or Git later

An npm installation such as `pi install npm:pi-legal-workbench` requires publishing that name to a registry first; this package has not been published as part of these instructions. Publishing requires removing `"private": true` and choosing an available package name and appropriate distribution metadata.

The package now lives at the repository root, so it can be installed directly from Git once these changes have been committed and pushed. Replace the owner and repository below with your published repository:

```bash
pi install git:github.com/OWNER/REPOSITORY
```

For a fixed release, create and push a version tag, then install with a matching suffix such as `@v0.1.0`.

Reference: [Pi's package documentation](https://pi.dev/docs/latest/packages).
