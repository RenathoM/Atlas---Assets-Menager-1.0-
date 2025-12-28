const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

/**
 * Consolidate multiple .rbxm files into a single ZIP archive with manifest
 * @param {Array<string>} filePaths - Array of .rbxm file paths
 * @param {Object} metadata - Metadata for the consolidation (requesterIds, assetIds, etc.)
 * @returns {Promise<{zipPath: string, manifest: Object}>}
 */
async function consolidateRBXM(filePaths, metadata = {}) {
  if (!filePaths || filePaths.length === 0) {
    throw new Error('No .rbxm files to consolidate');
  }

  const outDir = process.env.OUT_DIR || path.join(process.cwd(), 'out');
  const consolidatedDir = path.join(outDir, 'consolidated');
  
  // Ensure consolidated directory exists
  try { fs.mkdirSync(consolidatedDir, { recursive: true }); } catch (e) { /* ignore */ }

  const timestamp = Date.now();
  const zipPath = path.join(consolidatedDir, `consolidated-${timestamp}.zip`);

  // Create manifest
  const manifest = {
    consolidatedAt: new Date().toISOString(),
    timestamp,
    fileCount: filePaths.length,
    files: [],
    metadata,
    totalSize: 0
  };

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      manifest.totalSize = archive.pointer();
      const manifestPath = path.join(consolidatedDir, `manifest-${timestamp}.json`);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      
      resolve({
        zipPath,
        manifestPath,
        manifest,
        consolidatedAt: timestamp
      });
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Add each .rbxm file to the archive
    for (const filePath of filePaths) {
      if (fs.existsSync(filePath)) {
        const filename = path.basename(filePath);
        const fileStats = fs.statSync(filePath);
        
        manifest.files.push({
          filename,
          originalPath: filePath,
          size: fileStats.size,
          addedAt: new Date().toISOString()
        });

        archive.file(filePath, { name: filename });
      }
    }

    // Finalize the archive
    archive.finalize();
  });
}

/**
 * Create a summary object for consolidated files
 * @param {Array<string>} filePaths - Array of .rbxm file paths
 * @param {Array<Number>} assetIds - Array of asset IDs
 * @param {Array<Number>} requesterIds - Array of requester IDs
 * @returns {Object}
 */
function createConsolidationSummary(filePaths, assetIds = [], requesterIds = []) {
  const files = filePaths.map(filePath => ({
    name: path.basename(filePath),
    path: filePath,
    size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
  }));

  return {
    totalFiles: filePaths.length,
    files,
    assetIds: assetIds.length > 0 ? assetIds : undefined,
    requesterIds: requesterIds.length > 0 ? requesterIds : undefined,
    consolidatedAt: new Date().toISOString(),
    description: `Consolidated ${filePaths.length} .rbxm file(s)`
  };
}

module.exports = {
  consolidateRBXM,
  createConsolidationSummary
};
